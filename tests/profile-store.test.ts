// The profile store on defuss-storage's own adapters: its memory adapter and its Node file adapter on a throwaway
// directory (the OPFS path runs in the browser e2e). A stored pack must play on the real core as the original does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from 'defuss-storage';
import { createFileStorage } from 'defuss-storage/node';
import { OfflineSynth, createProfileStore, openProfileStore } from '../src/offline.ts';
import { gusFixture } from './vintage-fixtures.ts';
import { midiFixture } from './fixtures.ts';

const assets = new URL('../dist/', import.meta.url);
const wasm = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]); // the smallest valid module
const pcm = async (sources: { assets?: Uint8Array }) => {
  const s = await OfflineSynth.create({ baseUrl: assets, profile: 'gus-gf1', profileSources: { 'gus-gf1': sources } });
  try { s.loadMidi(midiFixture()); s.play(); return createHash('sha256').update(s.render(24000).left).digest('hex'); }
  finally { s.close(); }
};

test('a stored pack and module load back as they were and play as the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-store-'));
  try {
    const store = createProfileStore(await createFileStorage(dir));
    const pack = new Uint8Array(gusFixture());
    assert.equal(await store.load('gus-gf1'), undefined);
    await store.save('gus-gf1', { assets: pack });
    await store.save('gus-gf1', { wasm: wasm.buffer });
    assert.deepEqual(readdirSync(dir).sort(), ['gus-gf1.dspack', 'gus-gf1.wasm']);
    const loaded = await createProfileStore(await createFileStorage(dir)).load('gus-gf1'); // a new adapter: what persists
    assert.deepEqual(loaded, { assets: pack, wasm }, 'a part saved later keeps the earlier one');
    assert.equal(await pcm({ assets: loaded!.assets }), await pcm({ assets: pack }));
    assert.deepEqual(await store.profiles(), ['gus-gf1']);
    assert.equal(await store.remove('gus-gf1'), true); assert.equal(await store.remove('gus-gf1'), false);
    assert.equal(await store.load('gus-gf1'), undefined); assert.deepEqual(await store.profiles(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a pack larger than one read comes back whole', async () => {
  // 20 MiB in 1 MiB reads: twenty reads. Saves of several writes are the next test's.
  const store = createProfileStore(createMemoryStorage({ maxReadBytes: 1 << 20 }));
  const body = Uint8Array.from({ length: 20 << 20 }, (_, i) => (i * 7) & 255);
  const pack = new Uint8Array(16 + 8 + body.length), view = new DataView(pack.buffer);
  pack.set([0x44, 0x53, 0x50, 0x4b]); view.setUint32(4, 1, true); view.setUint32(8, 6, true); view.setUint32(12, 1, true);
  view.setUint32(16, 32, true); view.setUint32(20, body.length, true); pack.set(body, 24);
  await store.save('gus-gf1', { assets: pack });
  assert.ok(Buffer.from((await store.load('gus-gf1'))!.assets!).equals(pack));
});

test('a pack or module cut short by a save that stopped counts as not stored; foreign files are no profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-store-'));
  try {
    const pack = gusFixture();
    writeFileSync(join(dir, 'gus-gf1.dspack'), pack.subarray(0, pack.length - 1));
    writeFileSync(join(dir, 'awe32.wasm'), wasm.subarray(0, 6));
    writeFileSync(join(dir, 'notes.txt'), 'x'); writeFileSync(join(dir, 'soundfont.dspack'), pack);
    const store = createProfileStore(await createFileStorage(dir));
    assert.equal(await store.load('gus-gf1'), undefined); assert.equal(await store.load('awe32'), undefined);
    assert.deepEqual(await store.profiles(), ['awe32', 'gus-gf1']);
    await assert.rejects(store.save('soundfont' as never, { assets: pack }), RangeError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('openProfileStore needs the origin private file system', async () => {
  await assert.rejects(openProfileStore(), /needs a browser with the origin private file system/);
});

// Review findings of 2026-11-25 (both reproduced): a save on an adapter whose maxWriteBytes is below the store's write
// threw RangeError, and it had already emptied the stored copy.
test('a save adapts to an adapter that takes smaller writes; one it cannot make keeps the stored copy', async () => {
  const storage = createMemoryStorage({ maxWriteBytes: 1 << 20 }), store = createProfileStore(storage);
  const old = new Uint8Array(gusFixture()), body = Uint8Array.from({ length: 3 << 20 }, (_, i) => i & 255);
  const big = new Uint8Array(24 + body.length), view = new DataView(big.buffer);
  big.set([0x44, 0x53, 0x50, 0x4b]); view.setUint32(4, 1, true); view.setUint32(8, 6, true); view.setUint32(12, 1, true);
  view.setUint32(16, 32, true); view.setUint32(20, body.length, true); big.set(body, 24);
  await store.save('gus-gf1', { assets: old });
  await store.save('gus-gf1', { assets: big });
  assert.ok(Buffer.from((await store.load('gus-gf1'))!.assets!).equals(big), 'written in 1 MiB writes');
  await store.save('gus-gf1', { assets: old });
  assert.deepEqual((await store.load('gus-gf1'))!.assets, old, 'a smaller pack replaces a larger one whole');
  // An adapter whose writes stay below the store's smallest (64 KiB): the save is refused before any byte changes.
  const tiny = createProfileStore(createMemoryStorage({ maxWriteBytes: 1024 })), small = Uint8Array.of(0x44, 0x53, 0x50, 0x4b, 1, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 0, 32, 0, 0, 0, 2, 0, 0, 0, 7, 9);
  await tiny.save('gus-gf1', { assets: small });
  await assert.rejects(tiny.save('gus-gf1', { assets: big }), RangeError);
  assert.deepEqual((await tiny.load('gus-gf1'))?.assets, small, 'the stored copy is as it was');
});
