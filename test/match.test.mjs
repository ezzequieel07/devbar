import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// The matcher runs in the browser: it is bundled on the fly and run against a tiny stand-in for the DOM (just what it
// uses: closest, attributes, parents, innerText).
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client', 'match.ts');
const out = path.join(await mkdtemp(path.join(tmpdir(), 'devbar-match-')), 'match.mjs');
await build({entryPoints: [SRC], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent'});
const {match, prepare, bindIndex} = await import(pathToFileURL(out).href);

/** One simple selector: tag, .class, #id or [attr]. */
const matches = (el, sel) => sel.split(',').map(s => s.trim()).filter(Boolean).some(s => {
  const m = /^(\w+)?(?:\.([\w-]+))?(?:#([\w-]+))?(?:\[([\w-]+)\])?$/.exec(s);
  if (!m) throw new Error(`selector not supported here: ${s}`);
  return (!m[1] || el.tagName === m[1].toUpperCase()) && (!m[2] || el.classes.includes(m[2])) && (!m[3] || el.attrs.id === m[3]) && (!m[4] || m[4] in el.attrs);
});

function el(tag, {cls = [], attrs = {}, text = ''} = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), classes: cls, attrs, children, parentElement: null,
    get classList() { return cls; },
    get innerText() { return text || children.map(c => c.innerText).join(' '); },
    get textContent() { return this.innerText; },
    getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => name in attrs,
    querySelectorAll: () => [],
    closest(sel) { for (let n = node; n; n = n.parentElement) if (n !== globalThis.document.body && matches(n, sel)) return n; return null; },
  };
  for (const c of children) c.parentElement = node;
  return node;
}

function page(body) {
  globalThis.document = {body};
  globalThis.location = {pathname: '/'};
}

const leaves = [
  {id: 'site:title', label: 'Hero › Title', docTitle: 'Site', value: 'Hello world'},
  {id: 'post:b1', label: 'Paragraph', docTitle: 'Post', value: 'Hello world', bind: 'b1', textMatch: false},
];

test('a bound zone only edits data-devbar elements, never guesses by text', () => {
  const bound = el('p', {attrs: {'data-devbar': 'b1'}, text: 'Hello world'});
  const loose = el('p', {text: 'Hello world'});
  const body = el('body', {}, [el('h1', {text: 'Hello world'}), el('article', {cls: ['rich']}, [bound, loose])]);
  page(body);
  const prepared = prepare(leaves);
  const byBind = bindIndex(leaves);
  const isOurs = () => false;

  // Outside the zone, the text matches the site title.
  assert.equal(match(body.children[0], prepared, byBind, isOurs).options[0].leaves[0].id, 'site:title');
  // Inside, the bound paragraph edits its block…
  assert.equal(match(bound, prepared, byBind, isOurs, '', '.rich').options[0].leaves[0].id, 'post:b1');
  // …and an unbound one with the same text is not editable here (without the zone it would open the site title).
  assert.equal(match(loose, prepared, byBind, isOurs).kind, 'options');
  const m = match(loose, prepared, byBind, isOurs, '', '.rich');
  assert.equal(m.kind, 'none');
  assert.equal(m.bound, true);
  assert.equal(m.el, loose);
});

test('code zones win over bound zones, and data-devbar wins over both', () => {
  const title = el('p', {attrs: {'data-devbar': 'b1'}, text: 'Hello world'});
  const label = el('span', {text: 'Hello world'});
  const chart = el('figure', {cls: ['chart']}, [title, label]);
  page(el('body', {}, [el('article', {attrs: {'data-devbar-bound': ''}}, [chart])]));
  const prepared = prepare(leaves);
  const byBind = bindIndex(leaves);
  assert.equal(match(title, prepared, byBind, () => false, '.chart').options[0].leaves[0].id, 'post:b1');
  const m = match(label, prepared, byBind, () => false, '.chart');
  assert.equal(m.kind, 'none');
  assert.equal(m.code, true);
  assert.equal(m.el, chart);
});
