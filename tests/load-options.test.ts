/* Loading options with real WASM: Brotli-compressed SoundFonts and WOPL banks (the human, 2026-11-24: banks ship
 * compressed and defuss-brotli unpacks them), and the tempo of a file whose clock differs from its header's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compress, init } from 'defuss-brotli/compressor';
import { OfflineSynth } from '../src/offline.ts';
import { midiFixture, soundfont } from './fixtures.ts';

const assets = new URL('../dist/', import.meta.url);
await init();
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0);

test('a Brotli-compressed SoundFont loads as the plain one; the bundled one ships compressed', async () => {
  const plain = soundfont(), packed = compress(plain, { quality: 5 });
  assert.notEqual(packed[0], 0x52, 'the compressed bytes do not start with RIFF');
  const a = await OfflineSynth.create({ baseUrl: assets, soundfont: plain }), b = await OfflineSynth.create({ baseUrl: assets, soundfont: packed });
  try {
    assert.deepEqual(b.info.presets, a.info.presets); assert.equal(b.info.presets.length, 3);
    for (const s of [a, b]) s.schedule([{ time: 0, type: 'noteOn', channel: 0, note: 60, velocity: 100 }]);
    assert.deepEqual(b.render(4800).left, a.render(4800).left);
    assert.equal((await b.loadSoundFont(packed)).presets.length, 3);
    await assert.rejects(b.loadSoundFont(new Uint8Array(64)), /Invalid SoundFont/);
    assert.equal(b.info.presets.length, 3, 'bytes that are neither SF2 nor Brotli keep the loaded SoundFont');
  } finally { a.close(); b.close(); }
  const bundled = await OfflineSynth.create({ baseUrl: assets });
  try { assert.equal(bundled.info.presets.length, 136); } finally { bundled.close(); }
});
test('a Brotli-compressed WOPL bank loads as the plain one', async () => {
  const plain = readFileSync(new URL('./test.wopl', import.meta.url)), packed = compress(plain, { quality: 5 });
  const notes: Float32Array[] = [];
  for (const bank of [plain, packed]) {
    const s = await OfflineSynth.create({ baseUrl: assets, engine: 'fm' });
    try {
      assert.equal((await s.loadFmBank(bank)).fm!.bank, -1);
      s.schedule([{ time: 0, type: 'noteOn', channel: 0, note: 60, velocity: 100 }]);
      notes.push(s.render(4800).left);
    } finally { s.close(); }
  }
  assert.ok(energy(notes[0]!) > 0); assert.deepEqual(notes[1], notes[0]);
});
test('tempo scales a file\'s clock: positions, seeking and the end count real seconds', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets });
  try {
    assert.equal(s.engine.loadMidi(midiFixture()).duration, 0.5);
    const slow = s.engine.loadMidi(midiFixture(), { tempo: 0.5 });
    assert.equal(slow.duration, 1);
    s.engine.play();
    s.render(36000); assert.equal(s.engine.playbackInfo().position, 0.75); assert.equal(s.engine.playbackInfo().ended, false);
    s.render(14400); assert.equal(s.engine.playbackInfo().ended, true, 'the 0.5 s file ends after 1 s at tempo 0.5');
    s.engine.seek(0.9); assert.equal(s.engine.playbackInfo().position, 0.9);
    assert.equal(s.engine.loadMidi(midiFixture(), { tempo: 2 }).duration, 0.25);
    for (const tempo of [0, 0.2, 5, NaN]) assert.throws(() => s.engine.loadMidi(midiFixture(), { tempo }), RangeError);
    assert.equal(s.engine.playbackInfo().duration, 0.25, 'a rejected tempo keeps the loaded file');
  } finally { s.close(); }
});
test('the stepwise Brotli decoder gives defuss-brotli\'s bytes and reports its progress to the end', async () => {
  const { BrotliDecoder } = await import('../src/brotli.ts');
  const { decompress, init: ready } = await import('defuss-brotli/decompressor');
  await ready();
  const decoder = await BrotliDecoder.load(readFileSync(new URL('../dist/assets/brotli-decompressor.wasm', import.meta.url)));
  const packed = readFileSync(new URL('../vendor/soundfonts/TimGM6mb.sf2.br', import.meta.url));
  const steps: number[] = [];
  const out = await decoder.decode(packed, 64 * 1024 * 1024, (done, total) => { assert.equal(total, packed.length); steps.push(done); });
  assert.deepEqual(out, decompress(packed, { maxOutputSize: 64 * 1024 * 1024 }));
  assert.deepEqual(out, new Uint8Array(readFileSync(new URL('../vendor/soundfonts/TimGM6mb.sf2', import.meta.url))));
  assert.ok(steps.length >= 2, `${steps.length} reports`); assert.equal(steps.at(-1), packed.length);
  assert.ok(steps.every((v, i) => i === 0 || v >= steps[i - 1]!), 'progress never goes back');
  await assert.rejects(decoder.decode(packed, 1024 * 1024), Error, 'output beyond max throws');
  await assert.rejects(decoder.decode(packed.subarray(0, 1000), 64 * 1024 * 1024), Error, 'truncated input throws');
  assert.deepEqual(await decoder.decode(compress(new Uint8Array(3), { quality: 1 }), 16), new Uint8Array(3), 'the decoder is reusable after errors');
});
test('onProgress hears the download and then the decompression of the bundled SoundFont', async () => {
  const seen: { phase: string; loaded: number; total: number }[] = [];
  const s = await OfflineSynth.create({ baseUrl: assets, onProgress: p => seen.push(p) });
  try {
    assert.equal(s.info.presets.length, 136);
    const font = seen.filter(p => p.phase === 'download' && p.total === 5166685);
    assert.equal(font.at(-1)?.loaded, 5166685, 'the SoundFont was downloaded whole');
    const unpacking = seen.filter(p => p.phase === 'decompress');
    assert.ok(unpacking.length >= 2); assert.equal(unpacking.at(-1)!.loaded, unpacking.at(-1)!.total);
    assert.ok(seen.indexOf(font.at(-1)!) < seen.indexOf(unpacking[0]!), 'decompression follows the download');
  } finally { s.close(); }
});
test('OfflineSynth plays a loaded file at its clock, and tempo stretches it', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets, engine: 'fm', sampleRate: 48000 });
  try {
    const file = midiFixture();
    const info = s.loadMidi(file);
    assert.ok(info.duration > 0.3);
    s.play();
    const pcm = s.render(Math.ceil(info.duration * 48000));
    assert.ok(pcm.left.some(v => Math.abs(v) > 0.001), 'the file sounds');
    assert.equal(s.loadMidi(file, { tempo: 0.5 }).duration, info.duration * 2);
    assert.throws(() => s.loadMidi(new Uint8Array([1, 2, 3])), Error);
  } finally { s.close(); }
});
