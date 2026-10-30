import {defineConfig} from 'tsup';

const external = ['react', 'react-dom', '@sanity/client'];

export default defineConfig([
  // The toolbar runs in the browser: React Server Components need the 'use client' marker on top of the bundle.
  {
    entry: {index: 'src/index.ts'},
    format: 'esm',
    dts: true,
    clean: true,
    external,
    banner: {js: "'use client';"},
  },
  {
    entry: {server: 'src/server.ts', 'adapters/json': 'src/adapters/json.ts', 'adapters/sanity': 'src/adapters/sanity.ts'},
    format: 'esm',
    dts: true,
    platform: 'node',
    external,
  },
]);
