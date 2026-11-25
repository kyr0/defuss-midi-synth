import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript module of the scripts, without declarations
import { serve } from '../scripts/serve.mjs';

const wasm = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
test('the static server serves card cores and the page from the same tree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sound-cards-'));
  mkdirSync(join(dir, 'soundcards'));
  writeFileSync(join(dir, 'index.html'), '<p>Sound Card</p>');
  writeFileSync(join(dir, 'soundcards', 'awe64.wasm'), wasm);
  const server = await serve(dir);
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(url)).text(), '<p>Sound Card</p>');
    const core = await fetch(`${url}/soundcards/awe64.wasm`);
    assert.equal(core.headers.get('content-type'), 'application/wasm');
    assert.deepEqual(new Uint8Array(await core.arrayBuffer()), wasm);
    assert.equal((await fetch(`${url}/soundcards/missing.wasm`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});
