import path from 'node:path';
import {LOCAL_HOST, forbidden, fromToolbar, localHost, notFound} from './server/guard';
import {fileLog} from './server/log';
import {IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, Store} from './server/store';
import {DevbarError, type ContentAdapter, type EditContext, type Locale} from './types';

export {DevbarError} from './types';
export type {ContentAdapter, Change, DraftStatus, EditCapabilities, EditContext, EditLog, FeedbackRequest, Leaf, RequestStatus, SetInput, Target} from './types';

export type DevbarServerOptions = {
  /** Project folder. Default: `process.cwd()`. */
  root?: string;
  /** Where requests, attachments and the edit log are stored, relative to `root`. Default: `.devbar`. */
  dir?: string;
  /** Source of editable texts for edit mode. Without it, the toolbar has no "Edit" button. */
  content?: ContentAdapter;
  /**
   * Whether the endpoints answer at all. Default: only when `NODE_ENV === 'development'`. Everything else gets a 404,
   * so a production build never exposes them.
   */
  enabled?: boolean;
  /** Hosts allowed to use the toolbar. Default: 127.0.0.1, localhost, [::1] and *.localhost (any port). */
  allowedHosts?: RegExp;
};

type Handler = (req: Request) => Promise<Response>;

const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'cache-control': 'no-store'}});
const text = (body: string, status = 400) => new Response(body, {status});

/**
 * Request handler for every devbar endpoint, mounted under one path (default `/devbar`): `<base>/feedback`,
 * `<base>/file` and `<base>/edit`. Works anywhere `Request → Response` handlers do (Next.js route handlers, Hono, Remix…).
 *
 * Next.js (app/devbar/[...devbar]/route.ts):
 *   export const {GET, POST, PATCH, DELETE} = createDevbarHandler({content: jsonAdapter({files: ['messages/en.json']})});
 */
export function createDevbarHandler(options: DevbarServerOptions = {}): {GET: Handler; POST: Handler; PATCH: Handler; DELETE: Handler} {
  const root = options.root ?? process.cwd();
  const dir = path.resolve(root, options.dir ?? '.devbar');
  const store = new Store(dir);
  const log = fileLog(dir);
  const hosts = options.allowedHosts ?? LOCAL_HOST;
  const content = options.content;

  const handle: Handler = async req => {
    const enabled = options.enabled ?? process.env.NODE_ENV === 'development';
    if (!enabled) return notFound();
    if (!localHost(req, hosts)) return forbidden();
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, '').split('/').pop();
    const locale: Locale = req.headers.get('x-devbar-locale') === 'es' ? 'es' : 'en';
    const t = (en: string, es: string) => (locale === 'es' ? es : en);
    // Reading the list or an image only needs a local host; anything that writes must come from the toolbar itself.
    const write = req.method !== 'GET';
    if (write && !fromToolbar(req, hosts)) return forbidden();

    if (route === 'file' && req.method === 'GET') {
      const file = await store.attachment(url.searchParams.get('path') ?? '');
      return file ? new Response(new Uint8Array(file.data), {headers: {'content-type': file.type, 'cache-control': 'no-store'}}) : notFound();
    }

    if (route === 'feedback') {
      const list = async () => json({
        items: await store.list(),
        listening: await store.listening(),
        edit: {enabled: !!content, drafts: !!content?.drafts, undo: !!content?.undo},
      });
      if (req.method === 'GET') return list();
      if (req.method === 'PATCH') {
        if (!(await store.notify())) return text(t('There are no requests to notify', 'No hay pedidos para avisar'));
        return list();
      }
      if (req.method === 'DELETE') {
        if (!(await store.discard(url.searchParams.get('id') ?? ''))) return text(t('Invalid request', 'Pedido inválido'));
        return list();
      }
      if (req.method === 'POST') {
        if (!req.headers.get('content-type')?.startsWith('application/json')) return forbidden();
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || !body.target || typeof body.target !== 'object') return text(t('Invalid request', 'Pedido inválido'));
        const images = Array.isArray(body.images) ? body.images : [];
        const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
        if (!comment && !images.length) return text(t('Write what should change', 'Falta el comentario'));
        if (images.length > MAX_IMAGES) return text(t(`Up to ${MAX_IMAGES} images per request`, `Hasta ${MAX_IMAGES} imágenes por pedido`));
        // Before writing anything: every image must be png/jpg/webp/gif and up to 12 MB.
        const decoded: {ext: string; data: Buffer}[] = [];
        for (const img of images as {type?: string; data?: unknown}[]) {
          const ext = IMAGE_TYPES[img?.type ?? ''];
          if (!ext || typeof img.data !== 'string') return text(t('Only PNG, JPG, WebP or GIF images', 'Solo imágenes PNG, JPG, WebP o GIF'));
          const data = Buffer.from(img.data, 'base64');
          if (!data.length || data.length > MAX_IMAGE_BYTES) return text(t('Each image can be up to 12 MB', 'Cada imagen puede pesar hasta 12 MB'));
          decoded.push({ext, data});
        }
        const viewport = body.viewport as {w: number; h: number; dpr: number};
        await store.create({
          comment,
          page: typeof body.page === 'string' ? body.page.slice(0, 2000) : '/',
          viewport: {w: Number(viewport?.w) || 0, h: Number(viewport?.h) || 0, dpr: Number(viewport?.dpr) || 1},
          scrollY: Number(body.scrollY) || 0,
          target: body.target as never,
        }, decoded);
        return list();
      }
    }

    if (route === 'edit') {
      if (!content) return notFound();
      const ctx: EditContext = {page: url.searchParams.get('page') ?? '/', locale, t, log};
      try {
        if (req.method === 'GET') {
          const [leaves, status] = await Promise.all([content.list(ctx), content.drafts ? content.drafts.status(ctx) : []]);
          return json({leaves, status});
        }
        if (req.method === 'POST') {
          if (!req.headers.get('content-type')?.startsWith('application/json')) return forbidden();
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          if (!body || typeof body.op !== 'string') return json({error: t('Invalid request.', 'Pedido inválido.')}, 400);
          if (typeof body.page === 'string') ctx.page = body.page;
          // Publish and discard: only the drafts reviewed in the panel, at the revision that was seen (id → rev).
          const reviewed = Object.fromEntries(Object.entries(body.reviewed && typeof body.reviewed === 'object' ? body.reviewed as Record<string, unknown> : {})
            .filter((e): e is [string, string] => typeof e[1] === 'string'));
          let result: Record<string, unknown> = {};
          if (body.op === 'set') {
            if (typeof body.id !== 'string' || typeof body.value !== 'string') return json({error: t('Invalid request.', 'Pedido inválido.')}, 400);
            const r = await content.set({id: body.id, value: body.value, expected: typeof body.expected === 'string' ? body.expected : undefined}, ctx);
            result = {warnings: r.warnings ?? []};
          } else if (body.op === 'undo' && content.undo) result = {undone: await content.undo(ctx)};
          else if (body.op === 'publish' && content.drafts) result = {published: await content.drafts.publish(reviewed, ctx)};
          else if (body.op === 'discard' && content.drafts) result = {discarded: await content.drafts.discard(reviewed, ctx)};
          else return json({error: t('Invalid request.', 'Pedido inválido.')}, 400);
          return json({ok: true, ...result, status: content.drafts ? await content.drafts.status(ctx) : []});
        }
      } catch (err) {
        if (err instanceof DevbarError) return json({error: err.message}, 400);
        console.error('[devbar]', err);
        return json({error: t('Could not complete it. See the dev server log.', 'No se pudo completar. Mirá el registro del servidor.')}, 500);
      }
    }

    return notFound();
  };

  return {GET: handle, POST: handle, PATCH: handle, DELETE: handle};
}
