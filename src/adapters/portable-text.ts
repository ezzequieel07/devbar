import {randomBytes} from 'node:crypto';

// A Portable Text block (paragraph, heading, list item, quote) ↔ light markdown, which is what the edit box shows:
//   **bold**   *italic*   [link text](https://…)   and \* \[ \] \\ to type those characters as they are.
// Going back starts from the RAW block: spans that did not change stay identical (with their _key), and each link keeps
// its markDef (and _key) if the address is the same. A block with other marks (underline, code, strike) or anything that
// is not text inside can't be edited here (it would be lost): it is locked, with the reason.

type Obj = Record<string, unknown>;
type T = (en: string, es: string) => string;
export type Span = {_type: 'span'; _key: string; text: string; marks: string[]};
export type MarkDef = Obj & {_type: string; _key: string; href?: string};

/** A stretch of text with its format. */
type Run = {text: string; strong: boolean; em: boolean; href?: string};

export class MdError extends Error {}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Links as Sanity Studio accepts them by default: http(s), mailto, site paths (/…) or anchors (#…). */
export const safeHref = (h: string) => /^(https?:\/\/[^\s/]|mailto:\S|\/(?!\/)|#)\S*$/i.test(h);

/** The runs of a raw block, or why it can't be edited here. */
function runsOf(block: Obj, t: T): {runs: Run[]} | {locked: string} {
  const children = Array.isArray(block.children) ? block.children : [];
  const defs = new Map((Array.isArray(block.markDefs) ? block.markDefs : []).filter(isObj).map(d => [d._key, d]));
  const runs: Run[] = [];
  for (const c of children) {
    if (!isObj(c) || c._type !== 'span' || typeof c.text !== 'string') {
      return {locked: t('This text has something inside that is not text: change it in the Studio.', 'Este texto tiene algo que no es texto adentro: cambialo en el Studio.')};
    }
    const r: Run = {text: c.text, strong: false, em: false};
    for (const m of Array.isArray(c.marks) ? c.marks : []) {
      if (m === 'strong') r.strong = true;
      else if (m === 'em') r.em = true;
      else {
        const d = defs.get(m);
        if (!d || d._type !== 'link' || typeof d.href !== 'string' || r.href !== undefined) {
          return {locked: t('This text has formatting that can\'t be edited here (underline, code, strike…): change it in the Studio.',
            'Este texto tiene un formato que no se edita desde acá (subrayado, código, tachado…): cambialo en el Studio.')};
        }
        r.href = d.href;
      }
    }
    runs.push(r);
  }
  return {runs};
}

/** Plain text of the block. */
export const plainOf = (block: Obj) =>
  (Array.isArray(block.children) ? block.children : []).map(c => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('');

/** Consecutive runs with the same format go together; empty ones don't count. */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.strong === r.strong && last.em === r.em && last.href === r.href) last.text += r.text;
    else out.push({text: r.text, strong: r.strong, em: r.em, href: r.href});
  }
  return out;
}

/** Escapes what would read as format. Inside a link also brackets; outside, only when they would make a link. */
function escape(text: string, inLink: boolean): string {
  let out = text.replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
  if (inLink) out = out.replace(/[[\]]/g, '\\$&');
  else out = out.replace(/\[(?=[^\]]*\]\()/g, '\\[');
  return out;
}

function toMd(runs: Run[]): string {
  let out = '';
  let strong = false, em = false;
  let href: string | undefined;
  const close = (r: {strong: boolean; em: boolean}) => {
    if (em && !r.em) { out += '*'; em = false; }
    if (strong && !r.strong) { out += '**'; strong = false; }
  };
  for (const r of runs) {
    close(r);
    if (r.href !== href) {
      if (href !== undefined) out += `](${href})`;
      if (r.href !== undefined) out += '[';
      href = r.href;
    }
    if (r.strong && !strong) { out += '**'; strong = true; }
    if (r.em && !em) { out += '*'; em = true; }
    out += escape(r.text, href !== undefined);
  }
  close({strong: false, em: false});
  if (href !== undefined) out += `](${href})`;
  return out;
}

/** "[text](address)" starting at `i`: where the text closes, where it continues, and the address. */
function linkAt(s: string, i: number): {close: number; next: number; href: string} | null {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') return null;
    if (s[j] !== ']') continue;
    if (s[j + 1] !== '(') return null;
    const k = s.indexOf(')', j + 2);
    const href = k < 0 ? '' : s.slice(j + 2, k);
    if (!href || /\s/.test(href)) return null;
    return {close: j, next: k + 1, href};
  }
  return null;
}

/** Reads the light markdown. Throws MdError (with a message for the user) on anything left open or an invalid link. */
export function parseMd(s: string, t: T): Run[] {
  const runs: Run[] = [];
  let strong = false, em = false, buf = '';
  let link: {close: number; next: number; href: string; text: boolean} | null = null;
  const flush = () => {
    if (!buf) return;
    runs.push({text: buf, strong, em, href: link?.href});
    if (link) link.text = true;
    buf = '';
  };
  for (let i = 0; i < s.length;) {
    if (link && i === link.close) {
      flush();
      if (!link.text) throw new MdError(t('A link has no text: write it between the brackets, e.g. [the article](https://…).', 'Un link quedó sin texto: escribí el texto entre los corchetes, ej. [la nota](https://…).'));
      i = link.next;
      link = null;
      continue;
    }
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && '\\*[]'.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (ch === '*') {
      flush();
      if (s[i + 1] === '*') { strong = !strong; i += 2; } else { em = !em; i++; }
      continue;
    }
    if (ch === '[' && !link) {
      const at = linkAt(s, i);
      if (at) {
        if (!safeHref(at.href)) {
          const h = at.href.slice(0, 60);
          throw new MdError(t(`The link "${h}" is not a valid address: use https://…, a path starting with / or mailto:.`, `El link «${h}» no es una dirección válida: usá https://…, una ruta que empiece con / o mailto:.`));
        }
        flush();
        link = {...at, text: false};
        i++;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  if (strong) throw new MdError(t('A ** was left open (bold goes between **two pairs**). For a literal asterisk, type \\*.', 'Quedó un ** sin cerrar (la negrita va entre **dos pares**). Si querés un asterisco tal cual, escribí \\*.'));
  if (em) throw new MdError(t('A * was left open (italic goes between *asterisks*). For a literal asterisk, type \\*.', 'Quedó un * sin cerrar (la itálica va entre *asteriscos*). Si querés un asterisco tal cual, escribí \\*.'));
  return merge(runs);
}

const same = (a: Run[], b: Run[]) =>
  a.length === b.length && a.every((r, i) => r.text === b[i].text && r.strong === b[i].strong && r.em === b[i].em && r.href === b[i].href);

/** What the edit box shows for a raw block, or why it can't be edited here. */
export function blockToMd(block: Obj, t: T): {value: string} | {locked: string} {
  const r = runsOf(block, t);
  if ('locked' in r) return r;
  const runs = merge(r.runs);
  const value = toMd(runs);
  // Safety net: if reading it back doesn't give exactly the same, it's not offered (something would be lost on save).
  try {
    if (same(parseMd(value, t), runs)) return {value};
  } catch {}
  return {locked: t('This text has characters that can\'t be edited here: change it in the Studio.', 'Este texto tiene caracteres que no se pueden editar desde acá: cambialo en el Studio.')};
}

const key = () => randomBytes(6).toString('hex');

/**
 * New children and markDefs of a block from the edited text and the RAW block: unchanged spans are kept as they are
 * (with their _key); new ones reuse the old keys in order; each link reuses the markDef with the same address.
 */
export function mdToBlock(value: string, block: Obj, t: T): {children: Span[]; markDefs?: MarkDef[]} {
  const runs = parseMd(value, t);
  if (!runs.some(r => r.text.trim())) throw new MdError(t('The text can\'t be empty.', 'El texto no puede quedar vacío.'));
  const old = (Array.isArray(block.children) ? block.children : []).filter(isObj);
  const oldDefs = (Array.isArray(block.markDefs) ? block.markDefs : []).filter(isObj) as MarkDef[];
  const taken = new Set([...old, ...oldDefs].map(x => x._key).filter((k): k is string => typeof k === 'string'));
  const fresh = () => { let k = key(); while (taken.has(k)) k = key(); taken.add(k); return k; };
  const byHref = new Map<string, MarkDef>();
  for (const d of oldDefs) if (d._type === 'link' && typeof d.href === 'string' && !byHref.has(d.href)) byHref.set(d.href, d);
  const used = new Map<string, MarkDef>();
  const usedKeys = new Set<string>();
  const children = runs.map((r, i): Span => {
    const marks = [...(r.strong ? ['strong'] : []), ...(r.em ? ['em'] : [])];
    if (r.href !== undefined) {
      const d = used.get(r.href) ?? byHref.get(r.href) ?? {_type: 'link', _key: fresh(), href: r.href};
      used.set(r.href, d);
      marks.push(d._key);
    }
    const prev = old[i];
    const prevMarks = Array.isArray(prev?.marks) ? (prev.marks as string[]) : [];
    if (prev && prev._type === 'span' && prev.text === r.text && prevMarks.length === marks.length && marks.every(m => prevMarks.includes(m))
      && typeof prev._key === 'string' && !usedKeys.has(prev._key)) {
      usedKeys.add(prev._key);
      return prev as Span;
    }
    const k = typeof prev?._key === 'string' && !usedKeys.has(prev._key) ? prev._key : fresh();
    usedKeys.add(k);
    return {_type: 'span', _key: k, text: r.text, marks};
  });
  const markDefs = [...used.values()];
  return Array.isArray(block.markDefs) || markDefs.length ? {children, markDefs} : {children};
}
