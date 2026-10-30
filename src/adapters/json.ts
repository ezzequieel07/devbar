import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DevbarError, type ContentAdapter, type EditContext, type Leaf} from '../types';

// Edit mode over JSON files: translation files (messages/en.json), site copy (content/home.json), anything with strings.
// Saving writes straight to the file (git is your history); each change is logged so "Undo" can restore it.

export type JsonFile = {
  /** Path relative to `root`. */
  file: string;
  /** Name shown in the toolbar. Default: the path. */
  title?: string;
  /** Only on pages under this pathname (e.g. "/es" for messages/es.json): ranks its texts higher there. */
  path?: string;
};

export type JsonAdapterOptions = {
  files: (string | JsonFile)[];
  /** Project folder. Default: `process.cwd()`. */
  root?: string;
  /**
   * Where each part of the file shows on the page: key prefix → CSS selector, e.g. `{'hero.': '#hero', 'footer.': 'footer'}`.
   * Helps when the same text appears in several places.
   */
  scope?: Record<string, string>;
  /** Keys that are not texts to edit (e.g. URLs, ids). Receives the dotted path. Default: skips "$schema". */
  exclude?: (key: string) => boolean;
};

type Seg = string | number;
type Entry = {file: JsonFile; index: number};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dotted = (segs: Seg[]) => segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('');
const labelOf = (segs: Seg[]) => segs.map(s => (typeof s === 'number' ? `${s + 1}` : s)).join(' › ');

/** Indentation the file already uses (2 spaces, 4, a tab), to write it back the same way. */
function indentOf(raw: string): string | number {
  const m = /\n([ \t]+)\S/.exec(raw);
  return m ? (m[1].startsWith('\t') ? '\t' : m[1].length) : 2;
}

export function jsonAdapter(options: JsonAdapterOptions): ContentAdapter {
  const root = options.root ?? process.cwd();
  const files: JsonFile[] = options.files.map(f => (typeof f === 'string' ? {file: f} : f));
  const exclude = options.exclude ?? ((k: string) => k === '$schema');
  const scopeOf = (key: string) => Object.entries(options.scope ?? {}).find(([prefix]) => key.startsWith(prefix))?.[1];

  const abs = (f: JsonFile) => {
    const p = path.resolve(root, f.file);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new DevbarError(`devbar: ${f.file} is outside the project`);
    return p;
  };

  async function load(f: JsonFile) {
    const raw = await readFile(abs(f), 'utf8');
    try {
      return {raw, data: JSON.parse(raw) as unknown};
    } catch {
      throw new DevbarError(`${f.file}: invalid JSON`);
    }
  }

  /** Leaf id: "<file index>:<path as JSON>". Decoded and checked on the server, never trusted as a file path. */
  function decode(id: string, t: EditContext['t']): {entry: Entry; segs: Seg[]} {
    const m = /^(\d+):(\[.*\])$/.exec(id);
    const index = m ? Number(m[1]) : -1;
    let segs: unknown;
    try { segs = m ? JSON.parse(m[2]) : null; } catch {}
    if (!files[index] || !Array.isArray(segs) || !segs.length || !segs.every(s => typeof s === 'string' || (Number.isInteger(s) && s >= 0))) {
      throw new DevbarError(t('That text is not editable.', 'Ese texto no se edita desde acá.'));
    }
    return {entry: {file: files[index], index}, segs: segs as Seg[]};
  }

  function read(data: unknown, segs: Seg[]): unknown {
    let cur = data;
    for (const s of segs) cur = typeof s === 'number' ? (Array.isArray(cur) ? cur[s] : undefined) : isObj(cur) ? cur[s] : undefined;
    return cur;
  }

  function write(data: unknown, segs: Seg[], value: string) {
    const parent = read(data, segs.slice(0, -1)) as Record<string | number, unknown>;
    parent[segs[segs.length - 1]] = value;
  }

  async function save(f: JsonFile, raw: string, data: unknown) {
    await writeFile(abs(f), JSON.stringify(data, null, indentOf(raw)) + (raw.endsWith('\n') ? '\n' : ''));
  }

  return {
    name: 'json',

    async list() {
      const out: Leaf[] = [];
      for (const [index, f] of files.entries()) {
        const {data} = await load(f);
        const walk = (v: unknown, segs: Seg[]) => {
          if (typeof v === 'string') {
            const key = dotted(segs);
            if (!segs.length || exclude(key)) return;
            out.push({
              id: `${index}:${JSON.stringify(segs)}`,
              label: labelOf(segs),
              docTitle: f.title ?? f.file,
              value: v,
              multiline: v.includes('\n') || v.length > 90,
              group: `${index}:${dotted(segs.slice(0, -1))}`,
              bind: key,
              scope: scopeOf(key),
              path: f.path,
            });
          } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...segs, i]));
          else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, [...segs, k]);
        };
        walk(data, []);
      }
      return out;
    },

    async set({id, value, expected}, ctx) {
      const {entry, segs} = decode(id, ctx.t);
      const {raw, data} = await load(entry.file);
      const before = read(data, segs);
      if (typeof before !== 'string') throw new DevbarError(ctx.t('That text is no longer in the file. Reload the page.', 'Ese texto ya no está en el archivo. Recargá la página.'));
      if (typeof expected === 'string' && before !== expected) {
        throw new DevbarError(ctx.t('That text changed in the file while you were editing. Reload the page and try again.', 'Ese texto cambió en el archivo mientras lo editabas. Recargá la página y probá de nuevo.'));
      }
      const next = value.replace(/\r\n/g, '\n');
      if (next === before) return {};
      write(data, segs, next);
      await save(entry.file, raw, data);
      await ctx.log.add({adapter: 'json', op: 'set', file: entry.file.file, index: entry.index, segs, label: labelOf(segs), before, after: next});
      return {};
    },

    async undo(ctx) {
      for (const {id, entry: e} of await ctx.log.list()) {
        if (e.adapter !== 'json' || e.op !== 'set' || e.undone || e.stale) continue;
        const f = files[Number(e.index)];
        const segs = e.segs as Seg[];
        if (!f || f.file !== e.file || !Array.isArray(segs)) continue;
        const {raw, data} = await load(f);
        if (read(data, segs) !== e.after) {
          await ctx.log.update(id, {stale: new Date().toISOString()});
          throw new DevbarError(ctx.t('That text changed afterwards, so it was not undone.', 'Ese texto cambió después, así que no lo deshice.'));
        }
        write(data, segs, String(e.before));
        await save(f, raw, data);
        await ctx.log.update(id, {undone: new Date().toISOString()});
        return {label: String(e.label ?? dotted(segs))};
      }
      return null;
    },
  };
}
