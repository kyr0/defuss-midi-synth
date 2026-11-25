/* The host side of the native profile ABI (src/profile-voices.ts) against the real ECW and GF1 cores
 * (vendor/runtime/profiles) with the synthetic packs of tests/vintage-fixtures.ts. Expected behavior comes from
 * native/profiles/profile_pack.h (ABI 2: profile_model names the profile, profile_init rejects missing or invalid
 * assets, profile_sysex takes one message F0 .. F7 of at most PROFILE_SYSEX_MAX bytes and resets on the GM, GM2, GS
 * and XG resets) and from the import policy of instantiateProfile (no host access beyond a sink for diagnostics). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeProfileVoices, instantiateProfile, PROFILE_ABI, PROFILE_SYSEX_MAX } from '../src/profile-voices.ts';
import { dspack, ecwFixture, gusFixture } from './vintage-fixtures.ts';

const module = (kind: 'sb-pci128' | 'gus-gf1') => new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/profiles/${kind}.wasm`, import.meta.url)));
const packs = { 'sb-pci128': dspack(5, [[32, ecwFixture()]]), 'gus-gf1': gusFixture() };
/** A module that imports env.name and wasi_snapshot_preview1.wasi with no parameters and exports nothing: the import
 *  policy's input, built by hand (WebAssembly binary format: magic, version, a type section, an import section). */
function importing(name: string, wasi?: string): WebAssembly.Module {
  const text = (value: string) => [value.length, ...Buffer.from(value)];
  const entry = (from: string, field: string) => [...text(from), ...text(field), 0x00, 0x00];
  const entries = [entry('env', name), ...(wasi ? [entry('wasi_snapshot_preview1', wasi)] : [])];
  const body = [entries.length, ...entries.flat()];
  return new WebAssembly.Module(Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x02, body.length, ...body]));
}

test('the cores report ABI 2 and their model; a model mismatch, missing assets or the pack of another model fail', () => {
  for (const kind of ['sb-pci128', 'gus-gf1'] as const) {
    const exports = instantiateProfile(module(kind)).exports as unknown as { profile_abi(): number; profile_model(): number };
    assert.equal(exports.profile_abi(), PROFILE_ABI); assert.equal(exports.profile_model(), kind === 'sb-pci128' ? 5 : 6);
    assert.throws(() => new NativeProfileVoices(kind === 'sb-pci128' ? 'gus-gf1' : 'sb-pci128', instantiateProfile(module(kind)), packs[kind], 48000), /model mismatch/);
    assert.throws(() => new NativeProfileVoices(kind, instantiateProfile(module(kind)), new Uint8Array(0), 48000), /Invalid\/missing assets or initialization failed/);
    const other = kind === 'sb-pci128' ? packs['gus-gf1'] : packs['sb-pci128'];
    assert.throws(() => new NativeProfileVoices(kind, instantiateProfile(module(kind)), other, 48000), /initialization failed/, 'the other model\'s pack');
  }
});
test('instantiateProfile allows only its import surface and needs an exported memory', () => {
  assert.throws(() => instantiateProfile(importing('fetch')), /Unsupported profile import env\.fetch/);
  assert.throws(() => instantiateProfile(importing('emscripten_notify_memory_growth', 'path_open')), /Unsupported profile import wasi_snapshot_preview1\.path_open/);
  assert.throws(() => instantiateProfile(importing('emscripten_notify_memory_growth', 'fd_write')), /exports no memory/);
});
test('lifecycle: voices, SysEx bounds, the reset SysEx, close once, nothing after close', () => {
  for (const kind of ['sb-pci128', 'gus-gf1'] as const) {
    const v = new NativeProfileVoices(kind, instantiateProfile(module(kind)), packs[kind], 48000);
    const l = new Float32Array(128), r = new Float32Array(128);
    assert.equal(v.presets().length, 129); assert.deepEqual(v.presets()[128], { bank: 128, program: 0, name: 'Percussion' });
    v.message(0x90, 60, 100); assert.equal(v.voices(), 1); v.render(l, r, 0, 128);
    assert.ok(l.some(x => x !== 0), 'a note sounds');
    v.sysex(Uint8Array.of(0xf0, 0x7f, 0x7f, 0x04, 0x01, 0, 0x40, 0xf7)); assert.equal(v.voices(), 1, 'a message the core does not know is ignored');
    // The message sits inside a larger buffer, as the scheduler's payload store passes it.
    v.sysex(Uint8Array.of(9, 9, 0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7, 9), 2, 6); assert.equal(v.voices(), 0, 'GM2 System On resets');
    assert.throws(() => v.sysex(Uint8Array.of(0xf0)), RangeError); assert.throws(() => v.sysex(new Uint8Array(PROFILE_SYSEX_MAX + 1)), RangeError);
    assert.throws(() => v.sysex(Uint8Array.of(0xf0, 0xf7), 1, 2), RangeError, 'past the end of the bytes');
    // What the core does not take (malformed here; a full input queue on the Sound Canvas cores) is dropped and counted.
    assert.equal(v.dropped, 0); v.sysex(Uint8Array.of(0xf0, 0x80, 0xf7)); assert.equal(v.dropped, 1, 'the core rejects a data byte of 80h');
    v.close(); v.close();
    assert.equal(v.voices(), 0);
    assert.throws(() => v.message(0x90, 60, 100), /closed/); assert.throws(() => v.sysex(Uint8Array.of(0xf0, 0xf7)), /closed/); assert.throws(() => v.render(l, r, 0, 128), /closed/);
  }
});

test('Sound Canvas presets: the GS tones of SoundCarcass\'s maps on their variation banks and ten drum sets on bank 128', async () => {
  const { soundCanvasPresets } = await import('../src/profile-presets.ts');
  const drums = [[0, 'STANDARD'], [8, 'ROOM'], [16, 'POWER'], [24, 'ELECTRONIC'], [25, 'TR-808'], [32, 'JAZZ'], [40, 'BRUSH'], [48, 'ORCHESTRA'], [56, 'SFX'], [127, 'CM-64/32L']];
  for (const [model, tones, banks] of [['roland-sc55', 381, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 126, 127]], ['roland-sc55mk2', 418, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 24, 32, 126, 127]]] as const) {
    const presets = soundCanvasPresets(model);
    assert.equal(presets.filter(p => p.bank < 128).length, tones);
    assert.deepEqual([...new Set(presets.filter(p => p.bank < 128).map(p => p.bank))], banks);
    assert.deepEqual(presets.filter(p => p.bank === 128).map(p => [p.program, p.name]), drums);
    assert.equal(presets.filter(p => p.bank === 0).length, 128, 'every capital tone');
    assert.equal(new Set(presets.map(p => `${p.bank}:${p.program}`)).size, presets.length, 'no pair twice');
  }
  assert.deepEqual(soundCanvasPresets('roland-sc55')[0], { bank: 0, program: 0, name: 'Piano 1' });
});
