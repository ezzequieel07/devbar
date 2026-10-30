import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {sanityAdapter} from '../dist/adapters/sanity.js';
import {createDevbarHandler} from '../dist/server.js';

// A tiny in-memory stand-in for @sanity/client: just what the adapter uses (fetch, getDocument, transactions, patches).
function fakeClient(initial) {
  const docs = new Map(initial.map(d => [d._id, {...structuredClone(d), _rev: 'r0'}]));
  let rev = 0;
  const bump = d => ({...d, _rev: `r${++rev}`});
  const steps = p => [...p.matchAll(/([\w-]+)|\[_key=="([\w-]+)"\]|\[(\d+)\]/g)].map(m => (m[1] ? m[1] : m[2] ? {_key: m[2]} : Number(m[3])));
  const parentOf = (doc, p) => {
    const s = steps(p);
    let cur = doc;
    for (const x of s.slice(0, -1)) cur = typeof x === 'object' ? cur?.find(i => i._key === x._key) : cur?.[x];
    return [cur, s[s.length - 1]];
  };
  const setAt = (doc, p, v) => {
    const [parent, last] = parentOf(doc, p);
    if (!parent) return;
    if (typeof last === 'object') { const i = parent.findIndex(x => x._key === last._key); if (i >= 0) parent[i] = v; } else parent[last] = v;
  };
  const unsetAt = (doc, p) => { const [parent, last] = parentOf(doc, p); if (parent && typeof last !== 'object') delete parent[last]; };
  const patchOps = () => {
    const ops = [];
    const b = {
      ifRevisionId: r => (ops.push({rev: r}), b),
      setIfMissing: o => (ops.push({setIfMissing: o}), b),
      set: o => (ops.push({set: o}), b),
      unset: a => (ops.push({unset: a}), b),
      ops,
    };
    return b;
  };
  const applyPatch = (id, ops) => {
    const doc = docs.get(id);
    if (!doc) throw new Error(`no doc ${id}`);
    const next = structuredClone(doc);
    for (const op of ops) {
      if (op.rev && op.rev !== doc._rev) throw new Error('409 revision mismatch');
      if (op.setIfMissing) for (const [k, v] of Object.entries(op.setIfMissing)) if (next[k] === undefined) setAt(next, k, v);
      if (op.set) for (const [k, v] of Object.entries(op.set)) setAt(next, k, structuredClone(v));
      if (op.unset) for (const k of op.unset) unsetAt(next, k);
    }
    docs.set(id, bump(next));
  };
  const client = {
    docs,
    withConfig: () => client,
    async fetch(query, params) {
      if (query.startsWith('count(')) return true;
      const types = Object.entries(params).filter(([k]) => /^t\d+$/.test(k)).map(([, v]) => v);
      return [...docs.values()].filter(d => types.includes(d._type)).map(d => structuredClone(d));
    },
    async getDocument(id) { const d = docs.get(id); return d && structuredClone(d); },
    async delete(id) { docs.delete(id); },
    transaction() {
      const work = [];
      const tx = {
        createIfNotExists: d => (work.push(() => { if (!docs.has(d._id)) docs.set(d._id, bump(structuredClone(d))); }), tx),
        createOrReplace: d => (work.push(() => docs.set(d._id, bump(structuredClone(d)))), tx),
        delete: id => (work.push(() => docs.delete(id)), tx),
        patch: (id, fn) => { const b = patchOps(); fn(b); work.push(() => applyPatch(id, b.ops)); return tx; },
        async commit() {
          const snapshot = new Map([...docs].map(([k, v]) => [k, structuredClone(v)]));
          try { for (const w of work) w(); } catch (err) { docs.clear(); for (const [k, v] of snapshot) docs.set(k, v); throw err; }
        },
      };
      return tx;
    },
  };
  // client.patch(id).ifRevisionId(…).set(…).unset(…).commit(), as a one-patch transaction.
  client.patch = id => {
    const b = patchOps();
    const chain = {ifRevisionId: r => (b.ifRevisionId(r), chain), set: o => (b.set(o), chain), unset: a => (b.unset(a), chain), commit: async () => applyPatch(id, b.ops)};
    return chain;
  };
  return client;
}

const site = {
  _id: 'siteSettings', _type: 'siteSettings', title: 'My site',
  hero: {heading: 'Welcome', intro: 'We build things.'},
  nav: [{_key: 'a1', _type: 'link', label: 'Work', href: '/work'}, {_key: 'b2', _type: 'link', label: 'About', href: '/about'}],
  body: [
    {_key: 'p1', _type: 'block', style: 'normal', markDefs: [{_key: 'm1', _type: 'link', href: 'https://example.com'}],
      children: [{_key: 's1', _type: 'span', text: 'Read ', marks: []}, {_key: 's2', _type: 'span', text: 'the post', marks: ['m1']}]},
    {_key: 'h1', _type: 'block', style: 'h2', markDefs: [], children: [{_key: 's3', _type: 'span', text: 'Our work', marks: []}]},
  ],
  slug: {_type: 'slug', current: 'home'},
};

async function setup(fields) {
  const root = await mkdtemp(path.join(tmpdir(), 'devbar-sanity-'));
  const client = fakeClient([site]);
  const h = createDevbarHandler({root, enabled: true, content: sanityAdapter({client, documents: [{type: 'siteSettings', id: 'siteSettings', title: 'Site', fields}]})});
  const req = async (method, route, body) => (await h[method](new Request(`http://localhost:3000/devbar/${route}`, {
    method,
    headers: {host: 'localhost:3000', 'x-devbar': '1', ...(body ? {'content-type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined,
  }))).json();
  return {client, req};
}

test('lists every text when no fields are configured', async () => {
  const {req} = await setup();
  const {leaves} = await req('GET', 'edit?page=/');
  const labels = leaves.map(l => l.label);
  assert.ok(labels.includes('Hero › Heading'));
  assert.ok(labels.includes('Nav › 2 › Label'));
  assert.ok(!labels.some(l => /href|slug/i.test(l)), 'skips URLs and slugs');
  const p = leaves.find(l => l.bind === 'p1');
  assert.equal(p.value, 'Read [the post](https://example.com)');
  assert.equal(p.display, 'Read the post');
});

test('saves a draft, shows it as unpublished, publishes it', async () => {
  const {client, req} = await setup(['title', 'hero.heading', 'hero.subtitle', 'nav[].label', {path: 'body', label: 'Body'}]);
  const {leaves} = await req('GET', 'edit?page=/');
  const nav = leaves.find(l => l.label === 'Nav › 2 › Label');
  let d = await req('POST', 'edit', {op: 'set', id: nav.id, value: 'About us', expected: 'About'});
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(client.docs.get('drafts.siteSettings').nav[1].label, 'About us');
  assert.equal(client.docs.get('siteSettings').nav[1].label, 'About', 'published untouched');
  assert.equal(d.status.length, 1);
  assert.deepEqual(d.status[0].changes, [{label: 'Nav › 2 › Label', before: 'About', after: 'About us'}]);

  // A field that doesn't exist yet is offered off-page and created on save.
  const sub = leaves.find(l => l.label === 'Hero › Subtitle');
  assert.equal(sub.onPage, false);
  d = await req('POST', 'edit', {op: 'set', id: sub.id, value: 'Since 2019', expected: ''});
  assert.equal(client.docs.get('drafts.siteSettings').hero.subtitle, 'Since 2019');

  // Portable Text: keeps the link's markDef and the unchanged span.
  const p = leaves.find(l => l.bind === 'p1');
  d = await req('POST', 'edit', {op: 'set', id: p.id, value: 'Please read [the post](https://example.com) **now**', expected: p.value});
  assert.equal(d.ok, true, JSON.stringify(d));
  const block = client.docs.get('drafts.siteSettings').body[0];
  assert.deepEqual(block.markDefs, [{_key: 'm1', _type: 'link', href: 'https://example.com'}]);
  assert.deepEqual(block.children.map(c => [c.text, c.marks]), [['Please read ', []], ['the post', ['m1']], [' ', []], ['now', ['strong']]]);

  // Not configured: refused.
  d = await req('POST', 'edit', {op: 'set', id: JSON.stringify(['siteSettings', ['slug', 'current']]), value: 'x'});
  assert.match(d.error, /not editable/);

  const status = (await req('GET', 'edit?page=/')).status;
  d = await req('POST', 'edit', {op: 'publish', reviewed: {siteSettings: status[0].rev}});
  assert.equal(d.published, 1, JSON.stringify(d));
  assert.equal(client.docs.get('siteSettings').nav[1].label, 'About us');
  assert.equal(client.docs.has('drafts.siteSettings'), false);
});

test('undo restores the text and drops a draft equal to the published one', async () => {
  const {client, req} = await setup(['hero.heading']);
  const {leaves} = await req('GET', 'edit?page=/');
  await req('POST', 'edit', {op: 'set', id: leaves[0].id, value: 'Hello', expected: 'Welcome'});
  assert.equal(client.docs.get('drafts.siteSettings').hero.heading, 'Hello');
  const d = await req('POST', 'edit', {op: 'undo'});
  assert.equal(d.undone.label, 'Hero › Heading');
  assert.equal(client.docs.has('drafts.siteSettings'), false);
});

test('refuses to publish a draft that changed after review', async () => {
  const {client, req} = await setup(['hero.heading']);
  const {leaves} = await req('GET', 'edit?page=/');
  await req('POST', 'edit', {op: 'set', id: leaves[0].id, value: 'Hello', expected: 'Welcome'});
  const rev = (await req('GET', 'edit?page=/')).status[0].rev;
  client.docs.set('drafts.siteSettings', {...client.docs.get('drafts.siteSettings'), _rev: 'changed-in-studio'});
  const d = await req('POST', 'edit', {op: 'publish', reviewed: {siteSettings: rev}});
  assert.match(d.error, /new changes/);
  assert.equal(client.docs.get('siteSettings').hero.heading, 'Welcome');
});
