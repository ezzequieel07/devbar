import type {Leaf} from '../types';

// Edit mode: which editable text is the one clicked on the page.
// 1. An element with `data-devbar="<bind>"` (or inside one) edits the leaves with that bind directly.
// 2. Otherwise the visible text of the element (and its parents) is compared with every leaf, normalized the same way on
//    both sides (no asterisks, arrows or odd spaces). The smallest element that matches best wins:
//    - equal to the saved text (or to a template with {name}),
//    - part of it (a heading split in two lines, a name animated letter by letter),
//    - or a group of fields of the same object that together make what is shown (e.g. "2019 — 2021": from and to).
// If the same text is saved in more than one place, every option is returned and the edit box asks which one.

/** Each option is one leaf or a group of leaves edited together, with its score (best first). */
export type Option = {leaves: Leaf[]; s: number};
export type Match = {kind: 'options'; el: Element; options: Option[]} | {kind: 'none'; el: Element; code: boolean};

const clean = (s: string) =>
  s.normalize('NFC')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[*]/g, '')
    .replace(/[↗→↑←↓·•|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const norm = (s: string) => clean(s).toLowerCase();

export type Prepared = {leaf: Leaf; n: string; c: string; re: RegExp | null; letters: number};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lettersOf = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').length;

export const displayOf = (l: Leaf) => l.display ?? l.value;

/** Prepares the leaves once (normalized and, with {templates}, as a regular expression). */
export function prepare(leaves: Leaf[]): Prepared[] {
  return leaves.filter(l => l.onPage !== false && l.textMatch !== false && displayOf(l).trim()).map(leaf => {
    const n = norm(displayOf(leaf));
    // Template ({name}): each hole is a short name, not "anything" (otherwise a huge container that starts the same matches).
    const re = /\{\w+\}/.test(n) ? new RegExp(`^${n.split(/\{\w+\}/).map(escape).join('.{1,60}?')}$`) : null;
    return {leaf, n, c: clean(displayOf(leaf)), re, letters: lettersOf(n)};
  });
}

/** Screen-reader-only classes (sr-only, visually-hidden, block__sr…). */
const SR = /^(sr-only|visually-hidden|screen-reader-text)$|__sr$/;

/** Visible text of the element, without what is only for screen readers. */
function visibleText(el: Element): string {
  let t = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const hidden = [...el.querySelectorAll('[class], [hidden]')].filter(e => e.hasAttribute('hidden') || [...e.classList].some(c => SR.test(c)));
  for (const h of hidden) {
    const x = (h as HTMLElement).innerText ?? h.textContent ?? '';
    if (x) t = t.replace(x, ' ');
  }
  return t;
}

/** Score of a leaf against what an element shows (0 = unrelated). */
function score(t: string, p: Prepared): number {
  if (!t || !p.n) return 0;
  if (t === p.n) return 100;
  if (p.re && t.length <= p.n.length + 60 && p.re.test(t)) return 95;
  // Part of the text (a heading split in lines or letters): at least a third, so loose words don't count.
  if (t.length >= 3 && t.length / p.n.length >= 0.35 && p.n.includes(t)) return 50 + 45 * (t.length / p.n.length);
  if (p.n.length >= 2 && t.includes(p.n)) return 20 + 60 * (p.n.length / t.length);
  return 0;
}

/** More weight to what belongs to the open page and the clicked part of it; less to a text scoped somewhere else. */
function boost(p: Prepared, el: Element): number {
  let b = 0;
  const {scope, path} = p.leaf;
  if (path && (location.pathname === path || location.pathname.startsWith(path.endsWith('/') ? path : `${path}/`))) b += 6;
  if (scope) {
    try { b += el.closest(scope) ? 8 : -25; } catch {}
  }
  return b;
}

/** Leaves by bind, to match `data-devbar` elements. */
export function bindIndex(leaves: Leaf[]): Map<string, Leaf[]> {
  const out = new Map<string, Leaf[]>();
  for (const l of leaves) if (l.bind) out.set(l.bind, [...(out.get(l.bind) ?? []), l]);
  return out;
}

function bindMatch(start: Element, byBind: Map<string, Leaf[]>): Match | null {
  const el = start.closest('[data-devbar]');
  const leaves = el ? byBind.get(el.getAttribute('data-devbar') ?? '') : undefined;
  if (!el || !leaves?.length) return null;
  const field = el.getAttribute('data-devbar-field');
  const first = (l: Leaf) => Number(!!field && l.bindField === field);
  return {kind: 'options', el, options: [{leaves: [...leaves].sort((a, b) => first(b) - first(a)), s: 100}]};
}

/** Inline elements (a bold word, a link inside a paragraph). */
const INLINE = new Set(['A', 'STRONG', 'B', 'U', 'EM', 'I', 'SPAN', 'MARK', 'SMALL', 'SUP', 'SUB', 'CODE']);

const MAX_DEPTH = 8;
const GROUP_SCORE = 92;
/** Options offered besides the best one: up to this many points below it. */
const SPREAD = 15;

/**
 * Finds the editable text of the clicked element (or its parents). `codeZones`: selector of parts whose text lives in
 * the code (charts, demos); `[data-devbar-code]` always counts.
 */
export function match(start: Element, prepared: Prepared[], byBind: Map<string, Leaf[]>, isOurs: (el: Element) => boolean, codeZones = ''): Match {
  const bound = bindMatch(start, byBind);
  if (bound) return bound;
  const zones = ['[data-devbar-code]', codeZones].filter(Boolean).join(', ');
  const zone = start.closest(zones);
  if (zone) return {kind: 'none', el: zone, code: true};
  const levels: {s: number; el: Element; options: Option[]}[] = [];
  // Text of the clicked element itself: a parent only counts with a text that contains it (otherwise clicking a text that
  // lives in the code would climb to its section and pick any other text that happens to be inside).
  let own = '';
  let el: Element | null = start;
  for (let depth = 0; el && depth < MAX_DEPTH && el !== document.body; depth++, el = el.parentElement) {
    if (isOurs(el)) break;
    const raw = visibleText(el);
    if (raw.length > 2000) break;
    const c = clean(raw);
    const t = c.toLowerCase();
    if (!t) continue;
    if (!own) own = t;
    const related = (p: Prepared) => el === start || p.n.includes(own);
    const options: Option[] = [];
    for (const p of prepared) {
      if (!related(p)) continue;
      const s = score(t, p);
      // Same capitalization as shown breaks ties between two saved texts that only differ in case.
      if (s) options.push({leaves: [p.leaf], s: s + boost(p, el) + (s === 100 && p.c === c ? 6 : 0)});
    }
    // Several fields of one object that together are the element's text (almost the same letters and numbers).
    const total = lettersOf(t);
    const byGroup = new Map<string, Prepared[]>();
    for (const p of prepared) if (p.leaf.group && p.n.length >= 2 && t.includes(p.n)) byGroup.set(p.leaf.group, [...(byGroup.get(p.leaf.group) ?? []), p]);
    for (const list of byGroup.values()) {
      const unique = [...new Map(list.map(p => [p.leaf.id, p])).values()];
      if (!unique.some(related)) continue;
      // Up to 4 fields: more than that is a big container (all the paragraphs of a section), not "this text".
      if (unique.length < 2 || unique.length > 4 || !total) continue;
      // If one field is inside another (the name inside the intro), it's not a group: it's one text.
      if (unique.some(a => unique.some(b => a !== b && a.n.includes(b.n)))) continue;
      const ratio = unique.reduce((n, p) => n + p.letters, 0) / total;
      if (ratio >= 0.85 && ratio <= 1.05) options.push({leaves: unique.map(p => p.leaf), s: GROUP_SCORE + boost(unique[0], el)});
    }
    const top = options.reduce((m, o) => Math.max(m, o.s), 0);
    if (top >= 60) levels.push({s: top, el, options: options.filter(o => o.s >= top - SPREAD)});
    // Inline text (a bold word inside a paragraph) doesn't stop the search: the paragraph may be what is edited.
    if (top >= 100 && !INLINE.has(el.tagName)) break;
  }
  if (!levels.length) return {kind: 'none', el: start, code: false};
  // The deepest level that matches; if it is inline and a block above matches another text whole, the block goes first
  // (edit the paragraph) and the inline one stays as "Also in".
  let best = levels[0];
  for (const l of levels.slice(1)) if (l.s > best.s + 2) best = l;
  const block = levels.find(l => l !== levels[0] && !INLINE.has(l.el.tagName) && l.s >= 95);
  let options = best.options;
  let target = best.el;
  if (INLINE.has(levels[0].el.tagName) && block && block.options.some(o => !levels[0].options.some(x => x.leaves[0].id === o.leaves[0].id))) {
    const lead = Math.max(...levels[0].options.map(o => o.s)) + 10;
    options = [...block.options.map(o => ({...o, s: lead})), ...levels[0].options];
    target = block.el;
  }
  // Best first; a single leaf already inside an offered group is dropped if the group scores the same or better.
  const sorted = [...new Map(options.map(o => [o.leaves.map(l => l.id).join('+'), o])).values()].sort((a, b) => b.s - a.s);
  const groups = sorted.filter(o => o.leaves.length > 1);
  const covered = (o: Option) => groups.some(g => g.s >= o.s && g.leaves.some(l => l.id === o.leaves[0].id));
  return {kind: 'options', el: target, options: sorted.filter(o => o.leaves.length > 1 || !covered(o))};
}

/** The best option wins clearly (a real match, 95 or more, 6 points ahead of the next): edit it directly. */
export const isClear = (options: Option[]) => options[0].s >= 95 && (options.length === 1 || options[0].s - options[1].s >= 6);
