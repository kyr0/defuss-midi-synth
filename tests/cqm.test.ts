/* Real WASM tests of the sb16-cqm profile: vendor/runtime/profiles/sb16-cqm.wasm, libADLMIDI on one Nuked CQM chip
 * (86Box), built by scripts/build-native-profiles.py sb16-cqm. Expected values come from:
 * - native/profiles/profile_pack.h (ABI 2, DSPK v1) and src/profile-voices.ts instantiateProfile (the allowed imports);
 * - native/profiles/cqm.cpp: no pack plays embedded bank 0, role 32 is a WOPL bank, role 33 a u32 LE embedded bank
 *   number; 0xFF and the GM, GM2, GS and XG resets restore the power-on state;
 * - 86Box's driver, which clocks the core at 49716 Hz (commit f0f3c47209, "Fix CQM pitch");
 * - libADLMIDI's SysEx handler (adlmidi_midiplay.cpp, realTime_SysEx): GM master volume, GS percussion parts;
 * - the YMF262 register set the CQM takes: one chip has 18 two-operator channels, C0 bits 4 and 5 feed left and right;
 * - General MIDI 1: A4 is note 69 at 440 Hz;
 * - Nuked CQM (github.com/nukeykt/Nuked-CQM, "Creative Quadratic Modulation (clone OPL3) emulation"): its waveform 0
 *   multiplies two linear phase ramps (snd_cqm_nuked.c, CQM_Generate), a parabola per half period, whose odd
 *   harmonics fall as 1/n^3: the third at 1/27 (-28.6 dB), the fifth at 1/125 (-41.9 dB). The YMF262's waveform 0 is
 *   a sine (data sheet).
 * The comparisons with one OPL3 chip render fm-synth.wasm through src/offline.ts from dist/, which make test builds. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OfflineSynth, type StereoPcm } from '../src/offline.ts';
import { NativeProfileVoices, instantiateProfile } from '../src/profile-voices.ts';
import { dspack } from './vintage-fixtures.ts';

const RATE = 49716;
const wasm = readFileSync(new URL('../vendor/runtime/profiles/sb16-cqm.wasm', import.meta.url));
const module = new WebAssembly.Module(wasm);
const dist = new URL('../dist/', import.meta.url);
const create = (asset: Uint8Array = new Uint8Array(0), rate = 48000) => new NativeProfileVoices('sb16-cqm', instantiateProfile(module), asset, rate);
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0);
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
/** A copy in its own ArrayBuffer: src/profile-assets.ts keeps a Node Buffer's whole pool (Buffer#slice shares it). */
const own = (b: Uint8Array) => new Uint8Array(b);
function render(v: NativeProfileVoices, n: number, chunk = 128) {
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0; at < n; at += chunk) v.render(l, r, at, Math.min(chunk, n - at));
  return { l, r };
}

type Raw = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
function raw(): Raw {
  const w = instantiateProfile(module).exports as unknown as Raw;
  w._initialize?.();
  assert.equal(w.profile_init(0), 1);
  return w;
}
const rawPcm = (w: Raw, blocks: number) => {
  const out = new Float32Array(blocks * 256);
  for (let i = 0; i < blocks; i++) { const p = w.profile_render(128) >>> 2; out.set(new Float32Array(w.memory.buffer, p * 4, 256), i * 256); }
  return out;
};
const rawSysex = (w: Raw, bytes: number[]) => { new Uint8Array(w.memory.buffer, w.profile_sysex_buffer() >>> 0, bytes.length).set(bytes); return w.profile_sysex(bytes.length); };

/** A WOPL 3 bank whose every instrument is one carrier (multiple 1, full level, instant attack, held) on waveform
 *  wave beside a modulator that never attacks, in additive connection: the chip's bare waveform. */
function sineBank(wave = 0): Uint8Array {
  const head = Buffer.alloc(19);
  head.write('WOPL3-BANK\0', 0, 'latin1'); head.writeUInt16LE(3, 11); head.writeUInt16BE(1, 13); head.writeUInt16BE(1, 15);
  const ins = Buffer.alloc(66 * 256);
  for (let k = 0; k < 256; k++) {
    const o = k * 66; ins[o + 38] = 60; ins[o + 40] = 0x01;
    [0x21, 0x00, 0xf0, 0x0f, wave, 0x01, 0x3f, 0x00, 0x0f, 0x00].forEach((b, i) => { ins[o + 42 + i] = b; });
  }
  return new Uint8Array(Buffer.concat([head, Buffer.alloc(68), ins]));
}
/** The amplitude at f of n Hann-windowed samples from at (Goertzel). */
function amplitude(x: Float32Array, f: number, at: number, n: number): number {
  const c = 2 * Math.cos(2 * Math.PI * f / RATE); let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s = x[at + i]! * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))) + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
}
/** The frequency from the rising zero crossings between at and to. */
function zeroCrossingHz(x: Float32Array, at: number, to: number): number {
  let first = -1, last = -1, count = 0;
  for (let i = at; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) { if (first < 0) first = i; last = i; count++; }
  return (count - 1) * RATE / (last - first);
}
/** The smallest share of a's energy left after subtracting b with the best gain (either sign) and lag up to 64. */
function residual(a: Float32Array, b: Float32Array): number {
  let best = 1;
  for (let lag = -64; lag <= 64; lag++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 64; i < a.length - 64; i++) { ab += a[i]! * b[i + lag]!; aa += a[i]! * a[i]!; bb += b[i + lag]! * b[i + lag]!; }
    best = Math.min(best, 1 - ab * ab / (aa * bb));
  }
  return best;
}
async function offline(cqm: boolean, bank?: Uint8Array): Promise<OfflineSynth> {
  const s = cqm
    ? await OfflineSynth.create({ baseUrl: dist, sampleRate: RATE, profile: 'sb16-cqm', ...(bank ? { profileSources: { 'sb16-cqm': { assets: own(dspack(2, [[32, bank]])) } } } : {}) })
    : await OfflineSynth.create({ baseUrl: dist, sampleRate: RATE, engine: 'fm', chips: 1 });
  if (!cqm && bank) await s.loadFmBank(bank);
  return s;
}

test('sb16-cqm: ABI 2 reactor with allowed imports only, 49716 Hz, bounded entry points', () => {
  assert.doesNotThrow(() => instantiateProfile(module)); // throws on any import it does not provide
  const w = raw();
  assert.equal(w.profile_abi(), 2); assert.equal(w.profile_model(), 2); assert.equal(w.profile_rate(), 49716);
  assert.equal(w.profile_render(129), 0);
  for (const [s, a, b] of [[0x7f, 0, 0], [0xf0, 0, 0], [0x90, 128, 1], [0x90, 60, 128]]) assert.equal(w.profile_message(s, a, b), 0);
  assert.equal(w.profile_buffer(1), 0); // no new asset buffer while initialized
  w.profile_close();
  assert.equal(w.profile_message(0x90, 60, 100), 0); assert.equal(w.profile_render(128), 0); assert.equal(w.profile_voices(), 0);
});

test('sb16-cqm: a note renders non-silent stereo that CC 10 pans, on at most 18 voices', () => {
  const v = create();
  try {
    assert.equal(v.maxVoices(), 18);
    assert.equal(energy(render(v, 4096).l), 0);
    v.message(0x90, 69, 100); assert.equal(v.voices(), 1);
    const a = render(v, 9600);
    assert(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
    assert(energy(a.l) > 0.01 && energy(a.r) > 0.01);
    for (let i = 0; i < 128; i++) v.message(0x90, i, 100);
    assert.equal(v.voices(), 18);
    v.message(0xb0, 123, 0); render(v, 96000); assert.equal(v.voices(), 0);
  } finally { v.close(); }
  for (const [pan, silent] of [[0, 'r'], [127, 'l']] as const) {
    const p = create();
    try { p.message(0xb0, 10, pan); p.message(0x90, 60, 100); const x = render(p, 9600); assert.equal(energy(x[silent]), 0); assert(energy(x[silent === 'l' ? 'r' : 'l']) > 0.01); }
    finally { p.close(); }
  }
});

test('sb16-cqm: the same notes sound different from one OPL3 chip (src/offline.ts)', async () => {
  const play = async (cqm: boolean): Promise<StereoPcm> => {
    const s = await offline(cqm);
    try {
      s.schedule([{ time: 0, type: 'programChange', channel: 1, program: 33 },
        ...[60, 64, 67].map(note => ({ time: 0.01, type: 'noteOn' as const, channel: 0, note, velocity: 100 })),
        { time: 0.01, type: 'noteOn', channel: 1, note: 36, velocity: 100 },
        ...[36, 38, 42].map((note, i) => ({ time: 0.01 + i * 0.1, type: 'noteOn' as const, channel: 9, note, velocity: 110 })),
        ...[60, 64, 67].map(note => ({ time: 0.4, type: 'noteOff' as const, channel: 0, note }))]);
      return s.render(Math.round(RATE * 0.6));
    } finally { s.close(); }
  };
  const cqm = await play(true), opl3 = await play(false);
  assert(energy(cqm.left) > 1 && energy(opl3.left) > 1);
  // Not a scaled, inverted or delayed copy of the OPL3: at least 1% of the energy differs after the best fit.
  assert(residual(cqm.left, opl3.left) > 0.01);
});

test('sb16-cqm: waveform 0 is the quadratic sine (h3 1/27, h5 1/125) at the GM pitch; the OPL3 one is a sine', async () => {
  const bank = sineBank(0);
  for (const cqm of [true, false]) {
    const s = await offline(cqm, bank);
    try {
      s.schedule([{ time: 0, type: 'noteOn', channel: 0, note: 69, velocity: 127 }]);
      const x = s.render(RATE).left, f0 = zeroCrossingHz(x, 20000, 45000);
      assert(Math.abs(f0 / 440 - 1) < 0.01, `A4 at ${f0} Hz`);
      const [h1, h3, h5] = [1, 3, 5].map(k => amplitude(x, k * f0, 20000, 16384)) as [number, number, number];
      const db = (h: number) => 20 * Math.log10(h / h1);
      if (cqm) {
        assert(Math.abs(db(h3) - 20 * Math.log10(1 / 27)) < 1, `CQM h3 ${db(h3)} dB`);
        assert(Math.abs(db(h5) - 20 * Math.log10(1 / 125)) < 1.5, `CQM h5 ${db(h5)} dB`);
      } else assert(db(h3) < -50, `OPL3 h3 ${db(h3)} dB`);
    } finally { s.close(); }
  }
});

test('sb16-cqm: exact block partition invariance', () => {
  const a = create(), b = create();
  try {
    for (const v of [a, b]) { v.message(0xc0, 24, 0); v.message(0x90, 60, 100); v.message(0x99, 38, 100); v.message(0xe0, 0, 80); }
    assert.deepEqual(render(a, 15001), render(b, 15001, 7));
  } finally { a.close(); b.close(); }
});

test('sb16-cqm: render blocks that are multiples of the 64-frame grid do not change the PCM, vibrato included', async () => {
  // libADLMIDI advances vibrato once per render call, so this holds on the session's grid (as for sb16-opl3), not
  // for arbitrary block sizes.
  const play = async (sizes: number[]) => {
    const s = await OfflineSynth.create({ baseUrl: dist, sampleRate: 48000, profile: 'sb16-cqm' });
    try {
      s.schedule([{ time: 0, type: 'controlChange', channel: 0, controller: 1, value: 127 }, { time: 0, type: 'noteOn', channel: 0, note: 60, velocity: 100 },
        { time: 0.2, type: 'noteOn', channel: 9, note: 38, velocity: 100 }]);
      const out = new Float32Array(48000);
      for (let at = 0, k = 0; at < out.length; k++) { const n = Math.min(sizes[k % sizes.length]!, out.length - at); out.set(s.render(n).left, at); at += n; }
      return out;
    } finally { s.close(); }
  };
  const whole = await play([48000]);
  assert(energy(whole) > 1);
  assert.deepEqual(await play([64, 192, 1024, 128 * 7]), whole);
});

test('sb16-cqm: 0xFF and the GM, GM2, GS and XG resets restore the power-on state', () => {
  const resets: (number[] | null)[] = [null, [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7],
    [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7], [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]];
  for (const reset of resets) {
    const used = raw(), fresh = raw();
    used.profile_message(0xc0, 30, 0); used.profile_message(0xb0, 7, 20); used.profile_message(0xb0, 1, 90);
    used.profile_message(0xe0, 0, 100); used.profile_message(0x90, 40, 127); rawPcm(used, 50);
    if (reset) { assert.equal(rawSysex(used, reset), 1); assert.equal(rawSysex(fresh, reset), 1); }
    else assert.equal(used.profile_message(0xff, 0, 0), 1);
    assert.equal(used.profile_voices(), 0);
    for (const w of [used, fresh]) w.profile_message(0x90, 64, 100);
    const x = rawPcm(used, 100);
    assert(energy(x) > 0.1);
    assert.deepEqual(x, rawPcm(fresh, 100), `reset ${reset ?? '0xFF'}`);
  }
});

test('sb16-cqm: SysEx: malformed rejected, unknown ignored, master volume and GS drum parts applied', () => {
  const v = create();
  try {
    // The core rejects each malformed message (profile_sysex 0); the host counts it as dropped, as a MIDI input does.
    for (const [i, bad] of [[0xf0, 0x7e, 0x7f, 0x09, 0x01], [0xf0, 0x7e, 0x80, 0xf7], [0x90, 60, 100, 0xf7]].entries()) { v.sysex(new Uint8Array(bad)); assert.equal(v.dropped, i + 1); }
  } finally { v.close(); }
  const w = raw();
  assert.equal(rawSysex(w, [0xf0]), 0); assert.equal(w.profile_sysex(0), 0); assert.equal(w.profile_sysex(65537), 0);
  const play = (sysex: number[][], channel = 0) => {
    const v = create(new Uint8Array(0), RATE);
    try { for (const m of sysex) v.sysex(new Uint8Array(m)); v.message(0x90 | channel, 38, 100); return render(v, 12000).l; }
    finally { v.close(); }
  };
  const plain = play([]);
  assert.deepEqual(play([[0xf0, 0x00, 0x20, 0x29, 0x01, 0x02, 0xf7]]), plain); // another vendor's message: ignored
  assert(energy(play([[0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x20, 0xf7]])) < energy(plain) / 10); // master volume 1/4
  // GS: part 1 (MIDI channel 1) becomes a drum part, so note 38 there plays channel 10's snare.
  assert.deepEqual(play([[0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x11, 0x15, 0x02, 0x18, 0xf7]]), play([], 9));
});

test('sb16-cqm: DSPK role 33 selects an embedded bank, role 32 a WOPL bank; invalid packs rejected', () => {
  const play = (asset: Uint8Array) => {
    const v = create(asset, RATE);
    try { for (const [p, ch] of [[0, 0], [48, 1], [80, 2]]) { v.message(0xc0 | ch, p, 0); v.message(0x90 | ch, 60 + ch * 4, 100); } return render(v, 9600).l; }
    finally { v.close(); }
  };
  const embedded0 = play(new Uint8Array(0));
  assert.deepEqual(play(dspack(2, [[33, u32(0)]])), embedded0);
  assert.notDeepEqual(play(dspack(2, [[33, u32(14)]])), embedded0);
  assert(energy(play(dspack(2, [[33, u32(78)]]))) > 0.01);
  assert(energy(play(dspack(2, [[32, readFileSync(new URL('./test.wopl', import.meta.url))]]))) > 0);
  const good = dspack(2, [[33, u32(0)]]);
  for (const bad of [good.subarray(0, 12), good.subarray(0, good.length - 1), Buffer.concat([good, Buffer.alloc(1)]), dspack(9, [[33, u32(0)]]),
    dspack(2, [[33, u32(79)]]), dspack(2, [[33, u32(0).subarray(0, 3)]]), dspack(2, [[32, sineBank()], [33, u32(0)]]),
    dspack(2, [[1, u32(0)]]), dspack(2, [[32, Buffer.from('bad')]])]) assert.throws(() => create(bad), /assets|allocation/);
});
