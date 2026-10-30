import {mkdir, readFile, readdir, rename, stat, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {FeedbackRequest, RequestStatus, RequestSummary} from '../types';

// The devbar folder (default `.devbar/` in the project, keep it out of git). One JSON per request:
//   pending/      requests to do (the agent reads these)
//   done/         finished (the agent moves them here)
//   discarded/    discarded from the toolbar (kept, not deleted)
//   attachments/  reference images pasted in a request
//   notices/      "Notify the agent" leaves a file here; `devbar listen` wakes up when one shows up
//   listening     touched every few seconds by `devbar listen`: the toolbar shows "<agent> is listening"
//   edits/        edit mode log (to undo)
// The CLI (bin/devbar.mjs) reads and writes the same layout.

export const IMAGE_TYPES: Record<string, string> = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const ATTACHMENT_PATH = /^attachments\/[\w-]+\.(png|jpg|webp|gif)$/;
/** Without a heartbeat in this long, nobody is listening. */
const ALIVE_MS = 20_000;
const ID = /^[\w-]{1,80}$/;

export const statusOf = (v: unknown): RequestStatus => (v === 'notified' || v === 'in-progress' ? v : 'new');

const writeJson = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

export class Store {
  readonly pending: string;
  readonly done: string;
  readonly discarded: string;
  readonly notices: string;
  readonly attachments: string;
  readonly heartbeat: string;

  constructor(readonly dir: string) {
    this.pending = path.join(dir, 'pending');
    this.done = path.join(dir, 'done');
    this.discarded = path.join(dir, 'discarded');
    this.notices = path.join(dir, 'notices');
    this.attachments = path.join(dir, 'attachments');
    this.heartbeat = path.join(dir, 'listening');
  }

  private async files() {
    return (await readdir(this.pending).catch(() => [] as string[])).filter(f => f.endsWith('.json')).sort();
  }

  /** Open requests, oldest first, with just what the toolbar shows. */
  async list(): Promise<RequestSummary[]> {
    const items = await Promise.all((await this.files()).map(async (f): Promise<RequestSummary | null> => {
      try {
        const d = JSON.parse(await readFile(path.join(this.pending, f), 'utf8')) as Partial<FeedbackRequest>;
        const t = d.target;
        return {
          id: d.id ?? f.slice(0, -5),
          createdAt: d.createdAt ?? '',
          comment: d.comment ?? '',
          page: d.page ?? '/',
          kind: t?.kind,
          what: t?.selectedText || t?.text || (t?.tag ? `<${t.tag}>` : ''),
          status: statusOf(d.status),
          images: Array.isArray(d.images) ? d.images.filter(x => typeof x === 'string' && ATTACHMENT_PATH.test(x)) : [],
        };
      } catch {
        return null;
      }
    }));
    return items.filter((x): x is RequestSummary => !!x);
  }

  async listening() {
    const beat = await stat(this.heartbeat).catch(() => null);
    return !!beat && Date.now() - beat.mtimeMs < ALIVE_MS;
  }

  async attachment(rel: string): Promise<{data: Buffer; type: string} | null> {
    if (!ATTACHMENT_PATH.test(rel)) return null;
    const data = await readFile(path.join(this.dir, rel)).catch(() => null);
    if (!data) return null;
    const ext = rel.split('.').pop();
    return {data, type: Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream'};
  }

  async create(body: Omit<FeedbackRequest, 'id' | 'createdAt' | 'images' | 'status'>, images: {ext: string; data: Buffer}[]) {
    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
    const saved: string[] = [];
    if (images.length) {
      await mkdir(this.attachments, {recursive: true});
      for (const [i, img] of images.entries()) {
        const rel = `attachments/${id}-${i + 1}.${img.ext}`;
        await writeFile(path.join(this.dir, rel), img.data);
        saved.push(rel);
      }
    }
    await mkdir(this.pending, {recursive: true});
    const request: FeedbackRequest = {id, createdAt: now.toISOString(), status: 'new', ...body, ...(saved.length ? {images: saved} : {})};
    await writeJson(path.join(this.pending, `${id}.json`), request);
    return request;
  }

  /** "Notify the agent": new requests become `notified`, and a notice file wakes up `devbar listen`. */
  async notify(): Promise<number> {
    const ids: string[] = [];
    for (const f of await this.files()) {
      const file = path.join(this.pending, f);
      try {
        const d = JSON.parse(await readFile(file, 'utf8'));
        ids.push(d.id ?? f.slice(0, -5));
        if (statusOf(d.status) === 'new') await writeJson(file, {...d, status: 'notified', notifiedAt: new Date().toISOString()});
      } catch {}
    }
    if (!ids.length) return 0;
    await mkdir(this.notices, {recursive: true});
    const at = new Date().toISOString();
    await writeJson(path.join(this.notices, `${at.replace(/[:.]/g, '-')}.json`), {at, ids});
    return ids.length;
  }

  async discard(id: string) {
    if (!ID.test(id)) return false;
    await mkdir(this.discarded, {recursive: true});
    await rename(path.join(this.pending, `${id}.json`), path.join(this.discarded, `${id}.json`)).catch(() => {});
    return true;
  }

  async clearNotices() {
    for (const f of await readdir(this.notices).catch(() => [] as string[])) await unlink(path.join(this.notices, f)).catch(() => {});
  }
}
