import type {SanityClient} from '@sanity/client';
import {DevbarError, type Change, type ContentAdapter, type DraftStatus, type EditContext, type Leaf} from '../types';
import {MdError, blockToMd, mdToBlock, plainOf} from './portable-text';

// Edit mode over Sanity. Like the Studio, saving writes a draft (drafts.<id>): nothing changes on the published site
// until "Publish". The toolbar shows the unpublished changes and can publish, discard or undo them.
//
// Your site has to show drafts while you develop (e.g. perspective: 'drafts' in development), or you won't see the edits.
// Texts: string fields, lists of strings, strings inside lists of objects (by _key) and Portable Text blocks (paragraphs,
// headings, list items) as light markdown: **bold**, *italic*, [link](https://…).

type Obj = Record<string, unknown>;
type Doc = Obj & {_id: string; _type: string; _rev?: string};
/** A step in a document path: a field, a list item by _key, or by position. */
type Seg = string | number | {_key: string};

export type SanityField = string | {
  /** Dotted path; `[]` for every item of a list: "title", "hero.intro", "nav.links[].label", "roles", "body". */
  path: string;
  label?: string;
  description?: string;
  multiline?: boolean;
  required?: boolean;
  max?: number;
  maxLevel?: 'error' | 'warning';
  /** CSS selector of the page part where it shows. */
  scope?: string;
  /** False for texts that never show on the page (SEO, emails). */
  onPage?: boolean;
};

export type SanityDocumentConfig = {
  /** Document type (`_type`). */
  type: string;
  /** One document (a singleton such as "siteSettings"). Without it: every document of the type (see `filter`). */
  id?: string;
  /** Extra GROQ condition to narrow the documents, e.g. `defined(slug.current)`. */
  filter?: string;
  /** Name shown in the toolbar. Default: the document's title or name, or its type. */
  title?: string | ((doc: Doc) => string);
  /** Editable fields. Default: every string in the document (except system fields, slugs, references and URLs). */
  fields?: SanityField[];
  /** Field prefix → CSS selector of where it shows, e.g. `{'hero.': '#hero', 'footer.': 'footer'}`. */
  scope?: Record<string, string>;
  /** Pathname of the page where the document shows (ranks its texts higher there), e.g. doc => `/blog/${doc.slug.current}`. */
  path?: (doc: Doc) => string | undefined;
};

export type SanityAdapterOptions = {
  /** A client with a token that can write (e.g. SANITY_WRITE_TOKEN). Only ever used on the server. */
  client: SanityClient;
  documents: SanityDocumentConfig[];
};

type Found = {segs: Seg[]; human: string[]; kind: 's' | 'pt'; value: unknown; field?: Exclude<SanityField, string>; missing?: boolean};

const SAFE_KEY = /^[\w-]{1,64}$/;
const SAFE_ID = /^[\w.-]{1,128}$/;
const SKIP_TYPES = new Set(['reference', 'slug', 'sanity.imageAsset', 'sanity.fileAsset', 'geopoint', 'crossDatasetReference']);
const SKIP_KEYS = new Set(['asset', 'crop', 'hotspot', 'slug', 'href', 'url', 'current']);
const SYSTEM = new Set(['_id', '_rev', '_createdAt', '_updatedAt', '_system', '_originalId']);

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBlock = (v: unknown): v is Obj => isObj(v) && v._type === 'block' && Array.isArray(v.children);
const draftOf = (id: string) => `drafts.${id}`;
const fieldOf = (f: SanityField): Exclude<SanityField, string> => (typeof f === 'string' ? {path: f} : f);
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

/** "nav.links[].label" → ["nav", "links", "[]", "label"]. */
const tokens = (p: string) => p.replace(/\[\]/g, '.[]').split('.').filter(Boolean);

/** Path in Sanity's patch syntax: nav.links[_key=="a1"].label, roles[2]. */
const sanityPath = (segs: Seg[]) =>
  segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : typeof s === 'object' ? `[_key=="${s._key}"]` : i ? `.${s}` : s)).join('');

const itemSeg = (x: unknown, i: number): Seg => (isObj(x) && typeof x._key === 'string' && SAFE_KEY.test(x._key) ? {_key: x._key} : i);

function read(doc: unknown, segs: Seg[]): unknown {
  let cur = doc;
  for (const s of segs) {
    if (typeof s === 'string') cur = isObj(cur) ? cur[s] : undefined;
    else if (typeof s === 'number') cur = Array.isArray(cur) ? cur[s] : undefined;
    else cur = Array.isArray(cur) ? cur.find(x => isObj(x) && x._key === s._key) : undefined;
  }
  return cur;
}

/** JSON with sorted keys: to compare what was written with what Sanity returns. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : isObj(v) ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
      : JSON.stringify(v ?? null);

/** Without empty markDefs/marks lists (same as not having them). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => !((k === 'markDefs' || k === 'marks') && Array.isArray(x) && !x.length)).map(([k, x]) => [k, canon(x)]));
}

/** Without system fields, to copy a document (draft ↔ published). */
function strip(doc: Obj): Obj {
  return Object.fromEntries(Object.entries(doc).filter(([k]) => !SYSTEM.has(k)));
}

/** Like the Studio on publish: references "weak until published" become normal. */
function strengthen(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strengthen);
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) if (k !== '_strengthenOnPublish') out[k] = strengthen(x);
  if (v._strengthenOnPublish) delete out._weak;
  return out;
}

const textPart = (b: unknown) => (isObj(b) ? {children: b.children, markDefs: b.markDefs} : undefined);

/** Every text a field pattern points at in a document. A path ending on a list takes its items. */
function expand(v: unknown, toks: string[], segs: Seg[], human: string[], out: Found[], field: Exclude<SanityField, string>) {
  if (!toks.length) {
    if (typeof v === 'string') out.push({segs, human, kind: 's', value: v, field});
    else if (isBlock(v)) out.push({segs, human, kind: 'pt', value: v, field});
    else if (Array.isArray(v)) v.forEach((x, i) => expand(x, [], [...segs, itemSeg(x, i)], [...human, `${i + 1}`], out, field));
    return;
  }
  const [tok, ...rest] = toks;
  if (tok === '[]') {
    if (Array.isArray(v)) v.forEach((x, i) => expand(x, rest, [...segs, itemSeg(x, i)], [...human, `${i + 1}`], out, field));
    return;
  }
  if (isObj(v)) expand(v[tok], rest, [...segs, tok], [...human, humanize(tok)], out, field);
}

/** Every text in a document, when no fields are configured. */
function walk(v: unknown, segs: Seg[], human: string[], out: Found[]) {
  if (typeof v === 'string') { if (segs.length) out.push({segs, human, kind: 's', value: v}); return; }
  if (isBlock(v)) { out.push({segs, human, kind: 'pt', value: v}); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...segs, itemSeg(x, i)], [...human, `${i + 1}`], out)); return; }
  if (!isObj(v) || SKIP_TYPES.has(String(v._type))) return;
  for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && !SKIP_KEYS.has(k)) walk(x, [...segs, k], [...human, humanize(k)], out);
}

/** Does a field pattern allow these exact path steps? (A pattern that ends on a list allows its items.) */
function allows(toks: string[], segs: Seg[]): boolean {
  let i = 0;
  for (const tok of toks) {
    const s = segs[i++];
    if (s === undefined) return false;
    if (tok === '[]' ? typeof s === 'string' : s !== tok) return false;
  }
  return i === segs.length || (i === segs.length - 1 && typeof segs[i] !== 'string');
}

const autoAllows = (segs: Seg[]) => segs.length > 0 && segs.every(s => typeof s !== 'string' || (!s.startsWith('_') && !SKIP_KEYS.has(s)));

export function sanityAdapter(options: SanityAdapterOptions): ContentAdapter {
  const configs = options.documents;
  const client = () => options.client.withConfig({perspective: 'raw', useCdn: false});

  const configOf = (doc: Doc, baseId: string) => configs.find(c => c.type === doc._type && (!c.id || c.id === baseId));

  function titleOf(doc: Doc, config: SanityDocumentConfig) {
    if (typeof config.title === 'function') return config.title(doc);
    if (typeof config.title === 'string') return config.title;
    const name = [doc.title, doc.name].find(x => typeof x === 'string' && x.trim());
    return typeof name === 'string' ? `${humanize(doc._type)} · ${name}` : humanize(doc._type);
  }

  /** Published and draft of every configured document. */
  async function loadDocs(c: SanityClient) {
    const params: Record<string, string> = {};
    const conds = configs.map((cfg, i) => {
      params[`t${i}`] = cfg.type;
      if (cfg.id) { params[`id${i}`] = cfg.id; params[`d${i}`] = draftOf(cfg.id); }
      return `(_type == $t${i}${cfg.id ? ` && _id in [$id${i}, $d${i}]` : ''}${cfg.filter ? ` && (${cfg.filter})` : ''})`;
    });
    const docs = await c.fetch<Doc[]>(`*[${conds.join(' || ')}]`, params);
    const byId = new Map<string, {published?: Doc; draft?: Doc}>();
    for (const d of docs) {
      if (d._id.startsWith('versions.')) continue;
      const isDraft = d._id.startsWith('drafts.');
      const id = isDraft ? d._id.slice(7) : d._id;
      const slot = byId.get(id) ?? {};
      slot[isDraft ? 'draft' : 'published'] = d;
      byId.set(id, slot);
    }
    return byId;
  }

  function findTexts(doc: Doc, config: SanityDocumentConfig): Found[] {
    const out: Found[] = [];
    if (!config.fields) { walk(doc, [], [], out); return out; }
    for (const f of config.fields.map(fieldOf)) {
      const toks = tokens(f.path);
      const before = out.length;
      expand(doc, toks, [], [], out, f);
      // A plain field that is still empty: offered too (under "Other texts"), so it can be filled in.
      if (out.length === before && !toks.includes('[]') && read(doc, toks) === undefined) {
        out.push({segs: toks, human: toks.map(humanize), kind: 's', value: '', field: f, missing: true});
      }
    }
    return out;
  }

  function leavesOf(id: string, doc: Doc, config: SanityDocumentConfig, t: EditContext['t']): Leaf[] {
    const docTitle = titleOf(doc, config);
    const page = config.path?.(doc);
    return findTexts(doc, config).map((x): Leaf => {
      const dottedPath = x.segs.filter((s): s is string => typeof s === 'string').join('.');
      const scope = x.field?.scope ?? Object.entries(config.scope ?? {}).find(([p]) => dottedPath.startsWith(p))?.[1];
      const base = {
        id: JSON.stringify([id, x.segs]),
        docTitle,
        group: `${id}|${JSON.stringify(x.segs.slice(0, -1))}`,
        description: x.field?.description,
        required: x.field?.required,
        max: x.field?.max,
        maxLevel: x.field?.maxLevel,
        scope,
        path: page,
      };
      const label = x.field?.label ? [x.field.label, ...x.human.slice(tokens(x.field.path).filter(s => s !== '[]').length)].join(' › ') : x.human.join(' › ');
      if (x.kind === 'pt') {
        const b = x.value as Obj;
        const e = blockToMd(b, t);
        const heading = !b.listItem && /^h[1-6]$/.test(String(b.style));
        const kind = b.listItem ? t('List item', 'Ítem de lista') : heading ? t('Heading', 'Título') : b.style === 'blockquote' ? t('Quote', 'Cita') : t('Paragraph', 'Párrafo');
        return {...base, label: `${label} › ${kind}`, value: 'value' in e ? e.value : plainOf(b), display: plainOf(b).replace(/\s+/g, ' ').trim(),
          multiline: !heading, required: true, bind: String(b._key ?? ''), locked: 'locked' in e ? e.locked : undefined,
          description: x.field?.description ?? (heading ? t('Format: **bold**, *italic*.', 'Formato: **negrita**, *itálica*.')
            : t('Format: **bold**, *italic*, [link text](https://…).', 'Formato: **negrita**, *itálica*, [texto del link](https://…).'))};
      }
      const v = String(x.value);
      return {...base, label, value: v, display: v.replace(/\s+/g, ' ').trim(), multiline: x.field?.multiline ?? (v.includes('\n') || v.length > 90),
        bind: `${id}:${sanityPath(x.segs)}`, onPage: x.field?.onPage ?? !x.missing};
    });
  }

  /** The document and path behind a leaf id, checked against the configuration (never trusts the browser). */
  async function resolve(c: SanityClient, leafId: string, t: EditContext['t']) {
    const invalid = () => new DevbarError(t('That text is not editable.', 'Ese texto no se edita desde acá.'));
    let parsed: unknown;
    try { parsed = JSON.parse(leafId); } catch { throw invalid(); }
    if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
    const [id, segs] = parsed as [unknown, unknown];
    if (typeof id !== 'string' || !SAFE_ID.test(id) || /^(drafts|versions)\./.test(id) || !Array.isArray(segs) || !segs.length) throw invalid();
    const steps = segs as Seg[];
    const okSeg = (s: unknown) => (typeof s === 'string' && /^[\w-]{1,64}$/.test(s)) || (Number.isInteger(s) && (s as number) >= 0 && (s as number) < 1000)
      || (isObj(s) && typeof s._key === 'string' && SAFE_KEY.test(s._key) && Object.keys(s).length === 1);
    if (!steps.every(okSeg)) throw invalid();
    const [published, draft] = await Promise.all([c.getDocument<Doc>(id), c.getDocument<Doc>(draftOf(id))]);
    const current = draft ?? published;
    const config = current && configOf(current, id);
    if (!current || !config) throw invalid();
    if (config.filter) {
      const ok = await c.fetch<boolean>(`count(*[_id in [$id, $draft] && (${config.filter})]) > 0`, {id, draft: draftOf(id)});
      if (!ok) throw invalid();
    }
    const field = config.fields?.map(fieldOf).find(f => allows(tokens(f.path), steps));
    if (config.fields ? !field : !autoAllows(steps)) throw invalid();
    return {id, steps, published, draft, current, config, field};
  }

  function problemsOf(id: string, doc: Doc, config: SanityDocumentConfig, t: EditContext['t']): string[] {
    const out: string[] = [];
    for (const l of leavesOf(id, doc, config, t)) {
      if (l.required && !l.value.trim()) out.push(t(`${l.label}: empty.`, `${l.label}: está vacío.`));
      if (l.max != null && l.maxLevel === 'error' && l.value.length > l.max) out.push(t(`${l.label}: over ${l.max} characters.`, `${l.label}: más de ${l.max} caracteres.`));
    }
    return [...new Set(out)];
  }

  function diff(id: string, pub: Doc | undefined, draft: Doc, config: SanityDocumentConfig, t: EditContext['t']): Change[] {
    const a = new Map((pub ? leavesOf(id, pub, config, t) : []).map(l => [l.id, l]));
    const b = leavesOf(id, draft, config, t);
    const out: Change[] = [];
    for (const l of b) {
      const before = a.get(l.id)?.value ?? '';
      if (before !== l.value) out.push({label: l.label, before, after: l.value});
      a.delete(l.id);
    }
    for (const l of a.values()) if (l.value) out.push({label: l.label, before: l.value, after: ''});
    if (!out.length && pub && stable(canon(strip(pub))) !== stable(canon(strip(draft)))) {
      out.push({label: t('Other fields (images, links, order…)', 'Otros campos (imágenes, links, orden…)'), before: '', after: t('(changed)', '(cambió)')});
    }
    return out;
  }

  /** If the draft ended up equal to the published document, it is deleted (no empty "unpublished change" left). */
  async function dropIfSame(c: SanityClient, id: string) {
    const [pub, draft] = await Promise.all([c.getDocument<Doc>(id), c.getDocument<Doc>(draftOf(id))]);
    if (pub && draft && stable(canon(strip(pub))) === stable(canon(strip(draft)))) await c.delete(draftOf(id));
  }

  const stale = (t: EditContext['t']) => new DevbarError(t('That text changed in Sanity while you were editing (in the Studio?). Reload the page and try again.',
    'Ese texto cambió en Sanity mientras lo editabas (¿en el Studio?). Recargá la página y probá de nuevo.'));

  function pick(docs: Map<string, {published?: Doc; draft?: Doc}>, reviewed: Record<string, string>, t: EditContext['t']) {
    const ids = Object.keys(reviewed);
    if (!ids.length) throw new DevbarError(t('There are no changes to publish.', 'No hay cambios para publicar.'));
    return ids.map(id => {
      const slot = docs.get(id);
      if (!slot?.draft || slot.draft._rev !== reviewed[id]) {
        throw new DevbarError(t('There were new changes while you were reviewing (in the Studio?). Reload the page and review again.',
          'Hubo cambios nuevos mientras revisabas (¿en el Studio?). Recargá la página y revisá de nuevo.'));
      }
      if (!slot.published) throw new DevbarError(t('A draft was never published: publish that one from the Studio.', 'Un borrador nunca se publicó: ese se publica desde el Studio.'));
      return {id, draft: slot.draft, published: slot.published};
    });
  }

  async function commitLocked(tx: ReturnType<SanityClient['transaction']>, t: EditContext['t']) {
    try {
      await tx.commit({visibility: 'sync'});
    } catch (err) {
      if (/revision|409|conflict/i.test(err instanceof Error ? err.message : String(err))) {
        throw new DevbarError(t('There were new changes while you were reviewing (in the Studio?). Reload the page and review again.',
          'Hubo cambios nuevos mientras revisabas (¿en el Studio?). Recargá la página y revisá de nuevo.'));
      }
      throw err;
    }
  }

  return {
    name: 'sanity',

    async list(ctx) {
      const docs = await loadDocs(client());
      const out: Leaf[] = [];
      for (const [id, {published, draft}] of docs) {
        const doc = draft ?? published;
        const config = doc && configOf(doc, id);
        if (doc && config) out.push(...leavesOf(id, doc, config, ctx.t));
      }
      return out;
    },

    async set(input, ctx) {
      const {t} = ctx;
      const c = client();
      const {id, steps, published, draft, current, field} = await resolve(c, input.id, t);
      const at = sanityPath(steps);
      const node = read(current, steps);
      const warnings: string[] = [];
      const set: Obj = {};
      const unset: string[] = [];
      let beforeRaw: unknown, afterRaw: unknown, label: string;

      if (isBlock(node)) {
        const e = blockToMd(node, t);
        if ('locked' in e) throw new DevbarError(e.locked);
        if (typeof input.expected === 'string' && input.expected !== e.value) throw stale(t);
        let value = input.value.replace(/\r\n/g, '\n').trim();
        if (/^h[1-6]$/.test(String(node.style)) && !node.listItem) value = value.replace(/\s*\n\s*/g, ' ');
        if (value === e.value) return {};
        if (!value) throw new DevbarError(t('This text can\'t be empty. To remove the whole block, do it in the Studio.', 'Este texto no puede quedar vacío. Para sacar el bloque entero, hacelo desde el Studio.'));
        let next: ReturnType<typeof mdToBlock>;
        try { next = mdToBlock(value, node, t); } catch (err) { if (err instanceof MdError) throw new DevbarError(err.message); throw err; }
        set[`${at}.children`] = next.children;
        if (next.markDefs) set[`${at}.markDefs`] = next.markDefs;
        beforeRaw = textPart(node);
        afterRaw = next;
        label = plainOf(node).slice(0, 40);
      } else {
        if (node !== undefined && typeof node !== 'string') throw new DevbarError(t('That text is not editable.', 'Ese texto no se edita desde acá.'));
        const before = typeof node === 'string' ? node : '';
        if (typeof input.expected === 'string' && input.expected !== before) throw stale(t);
        const value = input.value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
        if (value === before) return {};
        if (field?.required && !value) throw new DevbarError(t('This text can\'t be empty.', 'Este texto no puede quedar vacío.'));
        if (field?.max != null && value.length > field.max) {
          if (field.maxLevel === 'error') throw new DevbarError(t(`This text fits up to ${field.max} characters (it has ${value.length}).`, `Este texto entra en hasta ${field.max} caracteres (tiene ${value.length}).`));
          warnings.push(t(`It has ${value.length} characters: over ${field.max} may break the layout.`, `Tiene ${value.length} caracteres: más de ${field.max} puede desarmar el diseño.`));
        }
        // Empty optional text: the field is removed, as in the Studio.
        if (value) set[at] = value; else if (node !== undefined) unset.push(at);
        beforeRaw = node;
        afterRaw = value || undefined;
        label = field?.label ?? steps.filter((s): s is string => typeof s === 'string').map(humanize).join(' › ');
      }

      // Parent objects of a plain field that doesn't exist yet (e.g. "hero" for "hero.intro").
      const parents: string[] = [];
      if (node === undefined && steps.every(s => typeof s === 'string')) for (let i = 1; i < steps.length; i++) parents.push(steps.slice(0, i).join('.'));

      const tx = c.transaction();
      // Like the Studio: with no draft yet, it is created by copying the published document.
      tx.createIfNotExists({...strip(current), _id: draftOf(id), _type: current._type});
      tx.patch(draftOf(id), p => {
        // If there was a draft, it must still be the one that was read (otherwise a Studio change would be overwritten).
        let q = draft?._rev ? p.ifRevisionId(draft._rev) : p;
        for (const parent of parents) q = q.setIfMissing({[parent]: {}});
        if (Object.keys(set).length) q = q.set(set);
        if (unset.length) q = q.unset(unset);
        return q;
      });
      try {
        await tx.commit({visibility: 'sync'});
      } catch (err) {
        if (/revision|409|conflict/i.test(err instanceof Error ? err.message : String(err))) throw stale(t);
        throw err;
      }

      // Check it was written (a path with a _key that no longer exists gives no error: it just does nothing).
      const after = await c.getDocument<Doc>(draftOf(id));
      const written = isBlock(node) ? textPart(read(after, steps)) : read(after, steps);
      if (!after || stable(written) !== stable(afterRaw)) {
        if (!draft && published) await dropIfSame(c, id);
        throw stale(t);
      }
      await ctx.log.add({adapter: 'sanity', op: 'set', docId: id, segs: steps, block: isBlock(node), label, beforeRaw, afterRaw, createdDraft: !draft});
      return {warnings};
    },

    async undo(ctx) {
      const {t} = ctx;
      const c = client();
      for (const {id: logId, entry: e} of await ctx.log.list()) {
        if (e.adapter !== 'sanity') continue;
        if (e.op === 'publish' || e.op === 'discard') return null; // published or discarded changes are not undone from here
        if (e.op !== 'set' || e.undone || e.stale) continue;
        const id = String(e.docId);
        const steps = e.segs as Seg[];
        const at = sanityPath(steps);
        const draft = await c.getDocument<Doc>(draftOf(id));
        const node = read(draft, steps);
        const now = e.block ? textPart(node) : node;
        if (!draft || stable(now) !== stable(e.afterRaw)) {
          await ctx.log.update(logId, {stale: new Date().toISOString()});
          throw new DevbarError(t('That text changed afterwards (in the Studio, or it was published), so it was not undone.', 'Ese texto cambió después (en el Studio o ya se publicó), así que no lo deshice.'));
        }
        let p = c.patch(draftOf(id)).ifRevisionId(draft._rev!);
        if (e.block) {
          const raw = e.beforeRaw as {children?: unknown; markDefs?: unknown};
          p = p.set({[`${at}.children`]: raw.children});
          p = raw.markDefs !== undefined ? p.set({[`${at}.markDefs`]: raw.markDefs}) : p.unset([`${at}.markDefs`]);
        } else p = e.beforeRaw !== undefined ? p.set({[at]: e.beforeRaw}) : p.unset([at]);
        await p.commit({visibility: 'sync'});
        await dropIfSame(c, id);
        await ctx.log.update(logId, {undone: new Date().toISOString()});
        return {label: String(e.label ?? at)};
      }
      return null;
    },

    drafts: {
      async status(ctx) {
        const docs = await loadDocs(client());
        const out: DraftStatus[] = [];
        for (const [id, {published, draft}] of docs) {
          if (!draft) continue;
          const config = configOf(draft, id);
          if (!config) continue;
          const before = new Set(published ? problemsOf(id, published, config, ctx.t) : []);
          out.push({
            id,
            title: titleOf(draft, config),
            rev: draft._rev ?? '',
            canPublish: !!published,
            // Only the problems the draft brings (if the published one already had them, they don't block).
            problems: problemsOf(id, draft, config, ctx.t).filter(x => !before.has(x)),
            changes: diff(id, published, draft, config, ctx.t),
          });
        }
        return out;
      },

      async publish(reviewed, ctx) {
        const c = client();
        const list = pick(await loadDocs(c), reviewed, ctx.t);
        const tx = c.transaction();
        for (const {id, draft, published} of list) {
          const config = configOf(draft, id);
          if (config) {
            const before = new Set(problemsOf(id, published, config, ctx.t));
            const problems = problemsOf(id, draft, config, ctx.t).filter(x => !before.has(x));
            if (problems.length) throw new DevbarError(ctx.t(`Nothing was published: ${problems[0]} Fix it and try again.`, `No se publicó nada: ${problems[0]} Corregilo y probá de nuevo.`));
          }
          // The draft must still be the reviewed one when writing (otherwise the whole transaction fails).
          tx.patch(draftOf(id), p => p.ifRevisionId(draft._rev!).unset(['__devbarLock']));
          tx.createOrReplace({...(strengthen(strip(draft)) as Obj), _id: id, _type: draft._type});
          tx.delete(draftOf(id));
        }
        await commitLocked(tx, ctx.t);
        await ctx.log.add({adapter: 'sanity', op: 'publish', ids: list.map(x => x.id)});
        return list.length;
      },

      async discard(reviewed, ctx) {
        const c = client();
        const list = pick(await loadDocs(c), reviewed, ctx.t);
        const tx = c.transaction();
        for (const {id, draft} of list) {
          tx.patch(draftOf(id), p => p.ifRevisionId(draft._rev!).unset(['__devbarLock']));
          tx.delete(draftOf(id));
        }
        await commitLocked(tx, ctx.t);
        await ctx.log.add({adapter: 'sanity', op: 'discard', ids: list.map(x => x.id)});
        return list.length;
      },
    },
  };
}
