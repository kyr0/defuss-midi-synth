// AWE32Emu (driver layer + measured 86Box EMU8000) as ABI 2 WASM. The build is local only (driver licence undecided),
// so these tests skip without profile-assets/local-builds/. They need no Creative asset: the bank is the repo's GPL-2.0
// TimGM6mb, uploaded into the emulated DRAM, which the chip plays without its wave ROM.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {NativeProfileVoices, instantiateProfile} from '../src/profile-voices.ts';
import {dspack} from './vintage-fixtures.ts';
type Model = 'awe32'|'awe64';
const wasmUrl = (m: Model) => new URL(`../profile-assets/local-builds/${m}.wasm`, import.meta.url);
const skip = existsSync(wasmUrl('awe32')) && existsSync(wasmUrl('awe64')) ? false
  : 'AWE32Emu local build absent: run python3 scripts/build-native-profiles.py --local-awe awe32 awe64';
const modules = new Map<Model, WebAssembly.Module>();
const moduleFor = (m: Model) => { if (!modules.has(m)) modules.set(m, new WebAssembly.Module(readFileSync(wasmUrl(m)))); return modules.get(m)!; };
const sf2 = readFileSync(new URL('../vendor/soundfonts/TimGM6mb.sf2', import.meta.url));
const ID = {awe32: 3, awe64: 4};
const DRIVERS = ['win95', 'dos', 'sdk'] as const;
/** Config record 33: driver (0 Win95, 1 DOS, 2 SDK), primary bank describes ROM samples, DRAM KiB (LE32). */
function config(driver = 0, rombank = 0, ramKb = 8192, size = 6): Buffer {
  const c = Buffer.alloc(size); c[0] = driver; c[1] = rombank; if (size >= 6) c.writeUInt32LE(ramKb, 2); return c;
}
const ramPack = (m: Model = 'awe32', driver = 0) => dspack(ID[m], [[32, sf2], [33, config(driver)]]);
const LATENCY = 980; // Emu8000Box::kLatencyFrames: the chip renders 980-frame blocks one block behind the writes
function create(m: Model = 'awe32', asset: Uint8Array = ramPack(m)) {
  return new NativeProfileVoices(m, instantiateProfile(moduleFor(m)), asset, 44100); // native rate: 1:1 clock
}
function render(v: NativeProfileVoices, n: number, chunks = [128]) {
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0, i = 0; at < n; i++) { const k = Math.min(chunks[i % chunks.length]!, n - at); v.render(l, r, at, k); at += k; }
  return {l, r};
}
const energy = (a: Float32Array) => a.reduce((s, x) => s + x * x, 0);
const AUDIBLE = 0.01; // sum of squares: an RMS above -60 dBFS over 8192 frames
const silent = (a: Float32Array) => a.every(x => x === 0);
/** Sample-exact equality, reporting the first differing frame (deepEqual's diff of long arrays takes minutes). */
function same(a: Float32Array, b: Float32Array) {
  assert.equal(a.length, b.length);
  const at = a.findIndex((x, i) => x !== b[i]);
  assert.equal(at, -1, `first difference at frame ${at}: ${a[at]} != ${b[at]}`);
}

test('awe32/awe64: ABI 2 exports, host-allowed imports, model ids', {skip}, () => {
  for (const m of ['awe32', 'awe64'] as const) {
    const v = create(m);
    try { assert.equal(v.maxVoices(), 32); assert.equal(v.presets().length, 129); } finally { v.close(); }
  }
  assert.throws(() => create('awe64', ramPack('awe32')), /initialization failed/);
  assert.throws(() => new NativeProfileVoices('awe64', instantiateProfile(moduleFor('awe32')), ramPack('awe64'), 44100), /model mismatch/);
});

test('RAM SoundFont without ROM: a note sounds after the chip latency and releases', {skip}, () => {
  const v = create();
  try {
    assert.equal(v.voices(), 0);
    v.message(0x90, 60, 100);
    const a = render(v, 16384);
    assert(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
    assert(silent(a.l.subarray(0, LATENCY)) && silent(a.r.subarray(0, LATENCY)));
    assert(energy(a.l.subarray(LATENCY)) > AUDIBLE && energy(a.r.subarray(LATENCY)) > AUDIBLE);
    assert(v.voices() >= 1);
    v.message(0x80, 60, 0); render(v, 44100 * 4);
    assert.equal(v.voices(), 0);
    assert(silent(render(v, 4096).l));
  } finally { v.close(); }
});

test('channel 10 plays the percussion bank, not the channel program', {skip}, () => {
  const drums = create(), piano = create();
  try {
    drums.message(0x99, 38, 110); piano.message(0x90, 38, 110);
    const d = render(drums, 8192), p = render(piano, 8192);
    assert(energy(d.l) > AUDIBLE && energy(p.l) > AUDIBLE);
    assert.notDeepEqual(d.l, p.l);
  } finally { drums.close(); piano.close(); }
});

for (const [i, driver] of DRIVERS.entries()) {
  test(`${driver} driver: CC7 volume attenuates a sounding note, CC10 pans the next one`, {skip}, () => {
    const v = create('awe32', ramPack('awe32', i));
    try {
      v.message(0x90, 60, 100);
      const loud = render(v, 8192);
      v.message(0xb0, 7, 0); render(v, 2048);
      const quiet = render(v, 4096);
      assert(energy(loud.l.subarray(LATENCY)) > AUDIBLE);
      assert(energy(quiet.l) * 20 < energy(loud.l.subarray(4096)));
      v.message(0xb0, 120, 0); v.message(0xb0, 7, 100); v.message(0xb1, 10, 0); v.message(0x91, 60, 100);
      const left = render(v, 8192);
      assert(energy(left.l) > 10 * energy(left.r));
    } finally { v.close(); }
  });

  test(`${driver} driver: output does not depend on render partitioning`, {skip}, () => {
    const a = create('awe32', ramPack('awe32', i)), b = create('awe32', ramPack('awe32', i));
    try {
      const events = (v: NativeProfileVoices, step: number) => {
        if (step === 0) { v.message(0x90, 60, 100); v.message(0x99, 38, 110); v.message(0xe0, 0, 80); }
        else { v.message(0xb0, 10, 0); v.message(0x91, 67, 90); v.message(0xb0, 64, 127); v.message(0x80, 60, 0); }
      };
      const out: [ReturnType<typeof render>, ReturnType<typeof render>][] = [];
      // The second span outlasts a Win95 pan glide (255 steps of 227 frames after CC10) under a sounding note.
      for (const [step, n] of [[0, 20000], [1, 80000]] as const) { events(a, step); events(b, step); out.push([render(a, n), render(b, n, [1, 7, 128, 33, 64, 100])]); }
      assert(energy(out[0]![0].l) > AUDIBLE);
      for (const [x, y] of out) { same(x.l, y.l); same(x.r, y.r); }
    } finally { a.close(); b.close(); }
  });
}

test('0xFF and GM/GS/XG reset SysEx restore power-on state; other SysEx is ignored, malformed rejected', {skip}, () => {
  const v = create();
  const resets = [[0xff], [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7], [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]];
  try {
    for (const reset of resets) {
      v.message(0xb0, 7, 0); v.message(0xb0, 10, 0); v.message(0xc0, 40, 0); v.message(0x90, 60, 100); render(v, 4096);
      if (reset.length === 1) v.message(0xff, 0, 0); else v.sysex(Uint8Array.from(reset));
      const fresh = create();
      try {
        for (const s of [v, fresh]) s.message(0x90, 60, 100);
        const a = render(v, 8192), b = render(fresh, 8192);
        // The same output as a synth just created, after the host clock's one held sample from before the reset.
        same(a.l.subarray(1), b.l.subarray(1)); same(a.r.subarray(1), b.r.subarray(1));
        assert(energy(a.l) > AUDIBLE);
      } finally { fresh.close(); }
    }
    v.message(0x90, 64, 100); render(v, 4096);
    v.sysex(Uint8Array.from([0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04, 0x00, 0x3c, 0xf7])); // GS master volume 0
    assert(energy(render(v, 4096).l) > AUDIBLE);
    // What the core rejects (profile_sysex or profile_message 0) the host counts as dropped, as a MIDI input does.
    const before = v.dropped;
    v.sysex(Uint8Array.from([0xf0, 0x7e, 0x80, 0xf7])); v.sysex(Uint8Array.from([0xf0, 0x7e, 0x7f, 0x09, 0x01])); v.message(0x90, 128, 1);
    assert.equal(v.dropped, before + 3);
  } finally { v.close(); }
});

test('polyphony stays within the 32 hardware voices', {skip}, () => {
  const v = create();
  try { for (let n = 30; n < 94; n++) v.message(0x90, n, 100); render(v, 2048); assert(v.voices() > 16 && v.voices() <= 32); } finally { v.close(); }
});

test('ROM record of either dump length is accepted; the RAM bank plays over it', {skip}, () => {
  for (const size of [1048576, 1048574]) {
    const v = create('awe32', dspack(3, [[3, Buffer.alloc(size)], [32, sf2], [33, config()]]));
    try { v.message(0x90, 60, 100); assert(energy(render(v, 8192).l) > AUDIBLE); } finally { v.close(); }
  }
});

test('invalid packs and configs are rejected', {skip}, () => {
  const good = ramPack();
  const bad: [string, Uint8Array][] = [
    ['empty', new Uint8Array()], ['truncated', good.subarray(0, good.length - 1)], ['no bank', dspack(3, [[33, config()]])],
    ['foreign role', dspack(3, [[1, Buffer.alloc(16)], [32, sf2]])], ['ROM size', dspack(3, [[3, Buffer.alloc(1048575)], [32, sf2]])],
    ['config size', dspack(3, [[32, sf2], [33, config(0, 0, 8192, 5)]])], ['driver', dspack(3, [[32, sf2], [33, config(3)]])],
    ['ROM-bank flag', dspack(3, [[32, sf2], [33, config(0, 2)]])], ['RAM step', dspack(3, [[32, sf2], [33, config(0, 0, 8000)]])],
    ['RAM max', dspack(3, [[32, sf2], [33, config(0, 0, 29184)]])], ['bank exceeds DRAM', dspack(3, [[32, sf2], [33, config(0, 0, 512)]])],
    ['ROM bank without ROM', dspack(3, [[32, sf2], [33, config(0, 1)]])], ['not a bank', dspack(3, [[32, Buffer.from('RIFF0000sfbk')]])],
    ['bad user bank', dspack(3, [[32, sf2], [33, config()], [34, Buffer.from('not a bank')]])],
  ];
  for (const [name, asset] of bad) assert.throws(() => create('awe32', asset), /initialization failed|allocation/, name);
});
