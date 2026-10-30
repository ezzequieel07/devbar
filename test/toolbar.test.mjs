import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {Devbar} from '../dist/index.js';

const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost:3000/'});
for (const k of ['window', 'document', 'location', 'sessionStorage']) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The toolbar asks the server for its state on mount; here there is no server.
globalThis.fetch = async () => new Response('{}');

/** Mounts the toolbar in a browser-like page and waits for its lazy code. */
async function mount(env, props = {}) {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(createElement(Devbar, props));
      await new Promise(r => setTimeout(r, 50));
    });
    return el.innerHTML;
  } finally {
    await act(async () => root.unmount());
    el.remove();
    process.env.NODE_ENV = before;
  }
}

test('the toolbar shows only in development', async () => {
  assert.match(await mount('development'), /data-devbar-ui/);
  assert.equal(await mount('production'), '');
  assert.equal(await mount('test'), '');
});

test('enabled overrides the environment both ways', async () => {
  assert.match(await mount('production', {enabled: true}), /data-devbar-ui/);
  assert.equal(await mount('development', {enabled: false}), '');
});

test('the server renders nothing, so there is nothing to hydrate', () => {
  assert.equal(renderToString(createElement(Devbar, {enabled: true})), '');
});

test('the entry point does not carry the toolbar code', async () => {
  const entry = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /db-edit__toast/);
  assert.match(entry, /import\(/);
});
