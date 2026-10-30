#!/usr/bin/env node
// devbar CLI: what a coding agent (or you) uses to work with the toolbar's requests.
//   devbar list [--json]        open requests, readable (or as JSON)
//   devbar start <id...>        mark as in progress (the toolbar shows "<agent> is on it")
//   devbar done <id...>         move to done/ (leaves the toolbar's counter)
//   devbar listen [--hours 8]   wait for "Notify" from the toolbar; prints the requests and exits
//   devbar init                 .gitignore + agent instructions in AGENTS.md / CLAUDE.md
//   devbar instructions         print the agent instructions
// Every command takes --dir <folder> (default .devbar in the current folder).
import {existsSync} from 'node:fs';
import {appendFile, mkdir, readFile, readdir, rename, unlink, utimes, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const command = args[0];
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && ['dir', 'hours'].includes(all[i - 1].slice(2))));
const DIR = path.resolve(typeof flag('dir') === 'string' ? flag('dir') : '.devbar');
const PENDING = path.join(DIR, 'pending');
const DONE = path.join(DIR, 'done');
const NOTICES = path.join(DIR, 'notices');
const HEARTBEAT = path.join(DIR, 'listening');
const ID = /^[\w-]{1,80}$/;

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

async function pending() {
  const files = (await readdir(PENDING).catch(() => [])).filter(f => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    try { out.push({file: path.join(PENDING, f), ...(await readJson(path.join(PENDING, f)))}); } catch {}
  }
  return out;
}

function describe(r) {
  const t = r.target ?? {};
  const lines = [`● ${r.id}  [${r.status ?? 'new'}]  ${r.page ?? '/'}  (${r.createdAt ?? ''})`, `  ${(r.comment || '(no comment)').replace(/\n/g, '\n  ')}`];
  const what = t.kind === 'text' ? `selected text: "${t.selectedText}"` : t.kind === 'area' ? 'area' : `element: ${t.text ? `"${t.text.slice(0, 120)}"` : `<${t.tag}>`}`;
  lines.push(`  on ${what}`);
  if (t.selector) lines.push(`  selector: ${t.selector}`);
  if (t.kind === 'area' && t.inside?.length) lines.push(`  inside: ${t.inside.map(x => `"${x.text}"`).join(', ').slice(0, 400)}`);
  if (r.viewport) lines.push(`  viewport: ${r.viewport.w}×${r.viewport.h} @${r.viewport.dpr}x, scrollY ${r.scrollY ?? 0}`);
  for (const img of r.images ?? []) lines.push(`  image: ${path.join(DIR, img)}`);
  lines.push(`  file: ${r.file}`);
  return lines.join('\n');
}

async function list() {
  const items = await pending();
  if (flag('json')) { console.log(JSON.stringify(items, null, 2)); return; }
  if (!items.length) { console.log('No open requests.'); return; }
  console.log(`${items.length} open request${items.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), PENDING) || PENDING}:\n`);
  console.log(items.map(describe).join('\n\n'));
  console.log('\nFor each: `npx devbar start <id>`, make the change, then `npx devbar done <id>`.');
}

async function setStatus(ids, status) {
  if (!ids.length) throw new Error(`Usage: devbar ${command} <id...>`);
  for (const id of ids) {
    if (!ID.test(id)) throw new Error(`Invalid id: ${id}`);
    const file = path.join(PENDING, `${id}.json`);
    if (!existsSync(file)) { console.error(`Not pending: ${id}`); process.exitCode = 1; continue; }
    const d = await readJson(file);
    if (status === 'done') {
      await mkdir(DONE, {recursive: true});
      await writeJson(file, {...d, status: 'done', doneAt: new Date().toISOString()});
      await rename(file, path.join(DONE, `${id}.json`));
      console.log(`Done: ${id}`);
    } else {
      await writeJson(file, {...d, status, startedAt: new Date().toISOString()});
      console.log(`In progress: ${id}`);
    }
  }
}

async function listen() {
  const hours = Number(flag('hours')) || 8;
  const end = Date.now() + hours * 3600_000;
  await mkdir(NOTICES, {recursive: true});
  const beat = async () => {
    const now = new Date();
    await utimes(HEARTBEAT, now, now).catch(() => writeFile(HEARTBEAT, ''));
  };
  console.log(`Listening for "Notify" in ${path.relative(process.cwd(), DIR) || DIR} (up to ${hours} h)…`);
  while (Date.now() < end) {
    await beat();
    const notices = (await readdir(NOTICES).catch(() => [])).filter(f => f.endsWith('.json'));
    if (notices.length) {
      for (const f of notices) await unlink(path.join(NOTICES, f)).catch(() => {});
      console.log(`NOTICE: the user pressed "Notify".\n`);
      await list();
      console.log('\nWhen you finish, run `npx devbar listen` again (in the background) to keep listening.');
      return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`No notice in ${hours} hours: run \`npx devbar listen\` again if the session is still open.`);
}

const instructionsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'AGENT.md');
const MARK_START = '<!-- devbar:start -->';
const MARK_END = '<!-- devbar:end -->';

async function init() {
  const gi = path.resolve('.gitignore');
  const ignore = existsSync(gi) ? await readFile(gi, 'utf8') : '';
  if (!/^\/?\.devbar\/?$/m.test(ignore)) {
    await appendFile(gi, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}# devbar requests and edit log\n.devbar/\n`);
    console.log('Added .devbar/ to .gitignore');
  }
  const text = await readFile(instructionsFile, 'utf8');
  const block = `${MARK_START}\n${text.trim()}\n${MARK_END}\n`;
  const targets = ['CLAUDE.md', 'AGENTS.md'].filter(f => existsSync(f));
  for (const f of targets.length ? targets : ['AGENTS.md']) {
    const cur = existsSync(f) ? await readFile(f, 'utf8') : '';
    const next = cur.includes(MARK_START)
      ? cur.replace(new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}\\n?`), block)
      : `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${cur ? '\n' : ''}${block}`;
    await writeFile(f, next);
    console.log(`${cur ? 'Updated' : 'Created'} ${f} with the agent instructions`);
  }
  console.log(`
Next steps (Next.js App Router):

  // app/devbar/[...devbar]/route.ts
  import {createDevbarHandler} from 'devbar/server';
  export const {GET, POST, PATCH, DELETE} = createDevbarHandler();

  // app/layout.tsx, inside <body>
  import {Devbar} from 'devbar';
  {process.env.NODE_ENV === 'development' && <Devbar />}

See the README for edit mode (JSON files, Sanity) and other frameworks.`);
}

const HELP = `devbar — requests from the dev toolbar, for your coding agent

  devbar list [--json]        open requests
  devbar start <id...>        mark as in progress
  devbar done <id...>         move to done (leaves the toolbar)
  devbar listen [--hours 8]   wait for "Notify" from the toolbar, then print the requests and exit
  devbar init                 add .devbar/ to .gitignore and the agent instructions to AGENTS.md / CLAUDE.md
  devbar instructions         print the agent instructions

  --dir <folder>              devbar folder (default: .devbar)`;

try {
  if (command === 'list') await list();
  else if (command === 'start') await setStatus(positional, 'in-progress');
  else if (command === 'done') await setStatus(positional, 'done');
  else if (command === 'listen') await listen();
  else if (command === 'init') await init();
  else if (command === 'instructions') console.log(await readFile(instructionsFile, 'utf8'));
  else { console.log(HELP); if (command && command !== 'help' && command !== '--help') process.exitCode = 1; }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
