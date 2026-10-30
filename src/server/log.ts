import {randomBytes} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {EditLog} from '../types';

/** Edit log: one JSON per change in `<devbar dir>/edits/`, so adapters can undo (and you can see what changed when). */
export function fileLog(dir: string): EditLog {
  const at = path.join(dir, 'edits');
  const file = (id: string) => path.join(at, `${id}.json`);
  return {
    async add(entry) {
      await mkdir(at, {recursive: true});
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`;
      await writeFile(file(id), JSON.stringify({id, at: new Date().toISOString(), ...entry}, null, 2) + '\n');
      return id;
    },
    async list() {
      const names = (await readdir(at).catch(() => [] as string[])).filter(f => f.endsWith('.json')).sort().reverse();
      const out: {id: string; entry: Record<string, unknown>}[] = [];
      for (const f of names) {
        try {
          out.push({id: f.slice(0, -5), entry: JSON.parse(await readFile(path.join(at, f), 'utf8'))});
        } catch {}
      }
      return out;
    },
    async update(id, patch) {
      if (!/^[\w-]+$/.test(id)) return;
      const entry = JSON.parse(await readFile(file(id), 'utf8'));
      await writeFile(file(id), JSON.stringify({...entry, ...patch}, null, 2) + '\n');
    },
  };
}
