import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {NativeProfileVoices, instantiateProfile, MAX_PROFILE_ASSET_BYTES, PROFILE_ABI} from '../src/profile-voices.ts';
import {dspack} from './vintage-fixtures.ts';

/** The real roland-mt32 core (Munt libmt32emu); no ROMs: those are private and checked by scripts/profile-mt32-test.mjs. */
const module = new WebAssembly.Module(readFileSync(new URL('../vendor/runtime/profiles/roland-mt32.wasm', import.meta.url)));
interface Exports {
  memory: WebAssembly.Memory; _initialize?(): void; profile_abi(): number; profile_model(): number; profile_buffer(n: number): number;
  profile_init(n: number): number; profile_rate(): number; profile_message(s: number, a: number, b: number): number;
  profile_sysex_buffer(): number; profile_sysex(n: number): number; profile_render(n: number): number; profile_voices(): number; profile_close(): void;
}
function raw(): Exports { const w = instantiateProfile(module).exports as unknown as Exports; w._initialize?.(); return w; }
/** Deterministic non-ROM bytes of a ROM's size (xorshift32). */
function garbage(n: number, seed: number): Uint8Array { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 255; } return b; }
const CONTROL = 65536, PCM = 524288;
const create = (asset: Uint8Array) => new NativeProfileVoices('roland-mt32', instantiateProfile(module), asset, 48000);
function load(w: Exports, asset: Uint8Array): number {
  const at = w.profile_buffer(asset.length) >>> 0;
  assert.notEqual(at, 0);
  new Uint8Array(w.memory.buffer, at, asset.length).set(asset);
  return w.profile_init(asset.length);
}

test('roland-mt32: imports only what instantiateProfile grants, ABI 2, model 9', () => {
  const allowed = new Set(['env.emscripten_notify_memory_growth', ...['proc_exit', 'environ_sizes_get', 'environ_get', 'fd_close', 'fd_seek', 'fd_write'].map(n => 'wasi_snapshot_preview1.' + n)]);
  for (const x of WebAssembly.Module.imports(module)) assert(x.kind === 'function' && allowed.has(`${x.module}.${x.name}`), `${x.module}.${x.name}`);
  const w = raw();
  assert.equal(w.profile_abi(), PROFILE_ABI);
  assert.equal(w.profile_model(), 9);
});

test('roland-mt32: init rejects an empty pack, a wrong model, missing or extra roles and garbage ROMs', () => {
  const control = garbage(CONTROL, 1), pcm = garbage(PCM, 2);
  const packs = [
    new Uint8Array(0),
    dspack(7, [[1, control], [2, pcm]]),
    dspack(9, [[1, control]]),
    dspack(9, [[2, pcm]]),
    dspack(9, [[1, control], [2, pcm]]),
    dspack(9, [[1, new Uint8Array(CONTROL)], [2, new Uint8Array(PCM)]]),
    dspack(9, [[1, pcm], [2, control]]),
    dspack(9, [[1, control], [2, pcm], [3, control]]),
  ];
  for (const pack of packs) assert.throws(() => create(pack), /Invalid\/missing assets or initialization failed for roland-mt32/);
});

test('roland-mt32: without an initialized synth every entry point refuses, SysEx included', () => {
  const w = raw(), valid = Uint8Array.of(0xf0, 0x41, 0x10, 0x16, 0x12, 0x10, 0x00, 0x01, 0x00, 0x6f, 0xf7);
  const check = () => {
    assert.equal(w.profile_rate(), 0);
    assert.equal(w.profile_voices(), 0);
    assert.equal(w.profile_message(0x91, 60, 100), 0);
    assert.equal(w.profile_message(0xff, 0, 0), 0);
    assert.equal(w.profile_render(128), 0);
    const at = w.profile_sysex_buffer() >>> 0;
    assert.notEqual(at, 0);
    new Uint8Array(w.memory.buffer, at, valid.length).set(valid);
    assert.equal(w.profile_sysex(valid.length), 0);
    assert.equal(w.profile_sysex(1), 0);
  };
  check();
  assert.equal(w.profile_buffer(0), 0);
  assert.equal(w.profile_buffer(MAX_PROFILE_ASSET_BYTES + 1), 0);
  assert.equal(load(w, dspack(9, [[1, garbage(CONTROL, 3)], [2, garbage(PCM, 4)]])), 0);
  check();
  w.profile_close(); w.profile_close();
  check();
  assert.equal(load(w, dspack(9, [[1, garbage(CONTROL, 5)], [2, garbage(PCM, 6)]])), 0, 'the module accepts a new pack after close');
});
