import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {jsonAdapter} from '../dist/adapters/json.js';
import {createDevbarHandler} from '../dist/server.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'devbar.mjs');
const ORIGIN = 'http://127.0.0.1:3000';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'devbar-'));
  await writeFile(path.join(root, 'en.json'), JSON.stringify({hero: {title: 'Hello world', roles: ['Designer', 'Researcher']}}, null, 4) + '\n');
  const h = createDevbarHandler({root, enabled: true, content: jsonAdapter({root, files: ['en.json'], scope: {'hero.': '#hero'}})});
  const req = (method, route, {body, headers = {}, toolbar = true} = {}) => h[method](new Request(`${ORIGIN}/devbar/${route}`, {
    method,
    headers: {host: '127.0.0.1:3000', ...(toolbar ? {'x-devbar': '1', 'sec-fetch-site': 'same-origin', origin: ORIGIN} : {}),
      ...(body ? {'content-type': 'application/json'} : {}), ...headers},
    body: body ? JSON.stringify(body) : undefined,
  }));
  return {root, req};
}

const target = {kind: 'element', rect: {x: 0, y: 0, w: 10, h: 10}, selector: 'h1', tag: 'h1', text: 'Hello world'};

test('creates, lists, notifies and discards requests', async () => {
  const {root, req} = await setup();
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  let res = await req('POST', 'feedback', {body: {comment: 'Bigger title', page: '/', viewport: {w: 1280, h: 800, dpr: 2}, scrollY: 0, target, images: [{type: 'image/png', data: png}]}});
  assert.equal(res.status, 200);
  let d = await res.json();
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].status, 'new');
  assert.deepEqual(d.edit, {enabled: true, drafts: false, undo: true});
  const [item] = d.items;
  assert.match(item.images[0], /^attachments\/.+\.png$/);

  res = await req('GET', `file?path=${encodeURIComponent(item.images[0])}`, {toolbar: false});
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal((await req('GET', 'file?path=../en.json', {toolbar: false})).status, 404);

  d = await (await req('PATCH', 'feedback')).json();
  assert.equal(d.items[0].status, 'notified');
  assert.equal((await readdir(path.join(root, '.devbar', 'notices'))).length, 1);

  // The CLI reads the same folder.
  const dir = path.join(root, '.devbar');
  assert.match(execFileSync('node', [CLI, 'list', '--dir', dir], {encoding: 'utf8'}), /Bigger title/);
  execFileSync('node', [CLI, 'start', item.id, '--dir', dir]);
  d = await (await req('GET', 'feedback', {toolbar: false})).json();
  assert.equal(d.items[0].status, 'in-progress');
  execFileSync('node', [CLI, 'done', item.id, '--dir', dir]);
  d = await (await req('GET', 'feedback', {toolbar: false})).json();
  assert.equal(d.items.length, 0);
  assert.deepEqual(await readdir(path.join(dir, 'done')), [`${item.id}.json`]);

  await req('POST', 'feedback', {body: {comment: 'Other', page: '/', viewport: {w: 1, h: 1, dpr: 1}, scrollY: 0, target}});
  const id = (await (await req('GET', 'feedback', {toolbar: false})).json()).items[0].id;
  d = await (await req('DELETE', `feedback?id=${id}`)).json();
  assert.equal(d.items.length, 0);
});

test('refuses writes that do not come from the toolbar', async () => {
  const {req} = await setup();
  const body = {comment: 'x', page: '/', viewport: {w: 1, h: 1, dpr: 1}, scrollY: 0, target};
  assert.equal((await req('POST', 'feedback', {body, toolbar: false})).status, 403);
  assert.equal((await req('POST', 'feedback', {body, headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal((await req('POST', 'feedback', {body, headers: {origin: 'https://evil.example'}})).status, 403);
  assert.equal((await req('GET', 'feedback', {headers: {host: 'evil.example'}})).status, 403);
  const off = createDevbarHandler({enabled: false});
  assert.equal((await off.GET(new Request(`${ORIGIN}/devbar/feedback`, {headers: {host: '127.0.0.1:3000'}}))).status, 404);
});

test('edits a JSON text, keeps the file format, and undoes it', async () => {
  const {root, req} = await setup();
  const {leaves} = await (await req('GET', 'edit?page=/', {toolbar: false})).json();
  const title = leaves.find(l => l.bind === 'hero.title');
  assert.equal(title.value, 'Hello world');
  assert.equal(title.scope, '#hero');
  assert.equal(leaves.find(l => l.bind === 'hero.roles[1]').label, 'hero › roles › 2');

  let res = await req('POST', 'edit', {body: {op: 'set', id: title.id, value: 'Hi there', expected: 'Hello world'}});
  assert.equal(res.status, 200);
  const raw = await readFile(path.join(root, 'en.json'), 'utf8');
  assert.equal(JSON.parse(raw).hero.title, 'Hi there');
  assert.match(raw, /\n {4}"hero"/, 'keeps 4-space indentation');

  // Stale: what the box opened with is no longer in the file.
  res = await req('POST', 'edit', {body: {op: 'set', id: title.id, value: 'Again', expected: 'Hello world'}});
  assert.equal(res.status, 400);

  res = await req('POST', 'edit', {body: {op: 'set', id: '0:["..","x"]', value: 'x'}});
  assert.equal(res.status, 400);

  const d = await (await req('POST', 'edit', {body: {op: 'undo'}})).json();
  assert.equal(d.undone.label, 'hero › title');
  assert.equal(JSON.parse(await readFile(path.join(root, 'en.json'), 'utf8')).hero.title, 'Hello world');
  assert.equal((await (await req('POST', 'edit', {body: {op: 'undo'}})).json()).undone, null);
});

test('adapters get the toolbar request (host, cookies) in the context', async () => {
  const seen = [];
  const content = {
    name: 'spy',
    async list(ctx) { seen.push(ctx.request.headers.get('host')); return []; },
    async set(_input, ctx) { seen.push(ctx.request.headers.get('cookie')); return {}; },
  };
  const h = createDevbarHandler({enabled: true, content, root: await mkdtemp(path.join(tmpdir(), 'devbar-'))});
  const headers = {host: '127.0.0.1:3000', 'x-devbar': '1', 'sec-fetch-site': 'same-origin', origin: ORIGIN};
  await h.GET(new Request(`${ORIGIN}/devbar/edit?page=/`, {headers}));
  await h.POST(new Request(`${ORIGIN}/devbar/edit`, {method: 'POST', headers: {...headers, 'content-type': 'application/json', cookie: 'view=published'},
    body: JSON.stringify({op: 'set', id: 'x', value: 'y'})}));
  assert.deepEqual(seen, ['127.0.0.1:3000', 'view=published']);
});
