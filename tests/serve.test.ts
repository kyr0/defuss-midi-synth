// scripts/serve.mjs, the development server, on a real port: given a map of local files it serves each one that exists
// under /local/<name> and lists them, and nothing else; the site's own files are served as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript module of the scripts, without declarations
import { serve } from '../scripts/serve.mjs';

const wasm = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
async function withServer(local: Record<string, string> | undefined, fn: (get: (path: string) => Promise<Response>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  writeFileSync(join(dir, 'index.html'), '<p>page</p>');
  const server = await serve(dir, 0, local === undefined ? {} : { local });
  try { await fn(path => fetch(`http://127.0.0.1:${server.address().port}${path}`)); }
  finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
}

test('the local files that exist are listed and served by name; no other path reaches them', async () => {
  const here = mkdtempSync(join(tmpdir(), 'local-files-'));
  try {
    writeFileSync(join(here, 'awe64.wasm'), wasm); writeFileSync(join(here, 'bank.sf2'), 'RIFF'); writeFileSync(join(here, 'other.wasm'), wasm);
    await withServer({ 'awe64.wasm': join(here, 'awe64.wasm'), 'pci128.sf2': join(here, 'bank.sf2'), 'awe32.wasm': join(here, 'missing.wasm') }, async get => {
      assert.deepEqual(await (await get('/local/index.json')).json(), ['awe64.wasm', 'pci128.sf2'], 'a missing file is not listed');
      const module = await get('/local/awe64.wasm');
      assert.equal(module.headers.get('content-type'), 'application/wasm'); assert.deepEqual(new Uint8Array(await module.arrayBuffer()), wasm);
      assert.equal(await (await get('/local/pci128.sf2')).text(), 'RIFF');
      for (const path of ['/local/awe32.wasm', '/local/other.wasm', '/local/bank.sf2']) assert.equal((await get(path)).status, 404, path);
      assert.equal(await (await get('/')).text(), '<p>page</p>');
    });
  } finally { rmSync(here, { recursive: true, force: true }); }
});

test('without local files /local/ is the site\'s own path', async () => {
  await withServer(undefined, async get => assert.equal((await get('/local/index.json')).status, 404));
});
