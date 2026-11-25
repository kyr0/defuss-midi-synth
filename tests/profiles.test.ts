import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { Engine, SYNTH_IMPORTS } from '../src/engine.ts';
import { FmVoices } from '../src/voices.ts';
import { RenderSession } from '../src/session.ts';
import { NativeClock } from '../src/profile-clock.ts';
import { PROFILE_DESCRIPTORS, SYNTH_PROFILES, isSynthProfile, selectEngine } from '../src/profiles.ts';
import { normalizeOptions, OP, type LoadProgress, type TimedEvent } from '../src/types.ts';
import { OfflineSynth } from '../src/offline.ts';
import { FM_BANK_NAMES } from '../src/fm-banks.ts';
import { midiFixture, smf } from './fixtures.ts';
import { dspack, ecwFixture, gusFixture } from './vintage-fixtures.ts';
function wasm(file: string) { return new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/${file}`, import.meta.url))), SYNTH_IMPORTS); }
function fm(engine: 'fm' | 'sb16-opl3') { return Engine.withFm(wasm('fm-synth.wasm'), { engine, chips: 2 }); }
test('exact profile IDs and prototype-safe validation', () => {
  assert.equal(SYNTH_PROFILES.length, 10); assert.equal(new Set(SYNTH_PROFILES).size, 10);
  assert.equal(new Set(SYNTH_PROFILES.map(p => PROFILE_DESCRIPTORS[p].id)).size, 10);
  for (const id of SYNTH_PROFILES) assert.equal(isSynthProfile(id), true);
  for (const id of ['__proto__', 'constructor', 'toString', 'fm', 1, undefined]) assert.equal(isSynthProfile(id), false);
  assert.throws(() => selectEngine('fm', 'sb16-opl3'), /disagree/);
  assert.equal(selectEngine(undefined, 'sb16-opl3'), 'sb16-opl3');
});
test('descriptors separate the shipped core from the assets a user supplies', () => {
  const plays = SYNTH_PROFILES.filter(id => PROFILE_DESCRIPTORS[id].availability === 'bundled' && PROFILE_DESCRIPTORS[id].userAssets !== 'required');
  assert.deepEqual(plays, ['soundfont', 'sb16-opl3', 'sb16-cqm'], 'what plays without user assets');
  for (const id of ['roland-sc55', 'roland-sc55mk2', 'roland-mt32', 'awe32', 'awe64'] as const) assert.equal(PROFILE_DESCRIPTORS[id].userAssets, 'required', `${id} needs ROMs`);
});
test('actual Yamaha engine: single chip vs legacy two chips, audible output', () => {
  for (const kind of ['fm', 'sb16-opl3'] as const) {
    const e = fm(kind);
    try {
      const count = kind === 'fm' ? 2 : 1;
      assert.equal(e.info().fm?.chips, count); assert.equal(e.info().maxVoices, count * 18);
      const session = new RenderSession(e), l = new Float32Array(48000), r = new Float32Array(48000);
      session.schedule([[0, OP.noteOn, 0, 60, 100], [24000, OP.noteOff, 0, 60, 0]]);
      session.process(l,r);
      assert(l.every(Number.isFinite)); assert(r.every(Number.isFinite));
      const rms=Math.sqrt(l.reduce((sum,x)=>sum+x*x,0)/l.length);
      assert(rms>0.0001); console.log(kind, 'RMS',rms);
    } finally { e.close(); }
  }
});
test('real WASM: SF2 and distinct FM profiles coexist and switch', () => {
  const font = brotliDecompressSync(readFileSync(new URL('../vendor/soundfonts/TimGM6mb.sf2.br', import.meta.url)));
  const settings = normalizeOptions({engine:'fm', chips:2});
  const e = Engine.withSoundFont(wasm('midi-synth.wasm'),font,settings);
  try {
    e.add(new FmVoices(wasm('fm-synth.wasm'),settings,'fm'));
    e.add(new FmVoices(wasm('fm-synth.wasm'),settings,'sb16-opl3'));
    assert.deepEqual(e.info().engines,['soundfont','fm','sb16-opl3']);
    e.use('sb16-opl3'); assert.equal(e.info().fm?.chips,1);
    e.use('fm'); assert.equal(e.info().fm?.chips,2);
    e.use('soundfont'); assert.equal(e.info().kind,'soundfont');
    const l=new Float32Array(8192), r=new Float32Array(8192), session=new RenderSession(e);
    session.schedule([[0,OP.noteOn,0,60,100]]); session.process(l,r);
    assert(l.some(x=>Math.abs(x)>0.0001));
  } finally { e.close(); }
});
function clockRun(rate:number, out:number, block:number) {
  const c=new NativeClock(rate,out), l=new Float32Array(8191), r=new Float32Array(8191); let tick=0;
  const pull=(left:Float32Array,right:Float32Array,n:number)=>{ for(let i=0;i<n;i++){left[i]=Math.sin(tick/40);right[i]=Math.cos(tick++/31);} };
  for(let at=0;at<l.length;at+=block)c.render(l,r,at,Math.min(block,l.length-at),pull);
  return {l,r,tick};
}
test('native clock: exact output and consumed samples independent of block partition', () => {
  for(const [rate,out] of [[32000,48000],[49716,44100],[44100,44100],[192000,8000],[8000,192000]]) {
    const a=clockRun(rate!,out!,128), b=clockRun(rate!,out!,7);
    assert.deepEqual(a,b); assert.equal(a.tick,Math.floor(8191*rate!/out!));
  }
  assert.throws(()=>new NativeClock(0,48000),/Invalid/);
});

test('native clock: no drift over 2^21 frames; consumption and output independent of odd block sizes', () => {
  // GF1 at 32 voices (617400 / 32, floored as gus.c does), the ECW reconstruction's 22,050 Hz, the MT-32's 32 kHz.
  // The Sound Canvas cores' 64,000 and 66,206 Hz downsample, by up to 1.5 native samples per output frame.
  for (const [rate, out] of [[19293, 48000], [22050, 44100], [32000, 48000], [22050, 48000], [64000, 48000], [66206, 48000], [66206, 44100]] as const) {
    const run = (blocks: number[]) => {
      const c = new NativeClock(rate, out), l = new Float32Array(128), r = new Float32Array(128), sums = [0, 0];
      let tick = 0, frames = 0;
      const pull = (left: Float32Array, right: Float32Array, n: number) => { for (let i = 0; i < n; i++) { left[i] = Math.sin(tick / 9); right[i] = (tick++ % 7) / 7; } };
      for (let i = 0; frames < 1 << 21; i++) {
        const n = Math.min(blocks[i % blocks.length]!, (1 << 21) - frames);
        c.render(l, r, 0, n, pull); frames += n;
        for (let j = 0; j < n; j++) { sums[0] += l[j]! * (frames - n + j); sums[1] += r[j]!; }
      }
      return { tick, sums };
    };
    const a = run([128]), b = run([61, 7, 128, 1, 64]);
    assert.equal(a.tick, Math.floor((1 << 21) * rate / out), `${rate} Hz into ${out} Hz`);
    assert.deepEqual(b, a);
  }
});
/* The profile API with the real ECW and GF1 modules (vendor/runtime/profiles, staged to dist/assets/profiles) and
 * the synthetic packs of tests/vintage-fixtures.ts. Expected behavior: the human's brief for 0.4.0 (profile in create
 * options and useProfile on both facades beside engine and 'fm'; switching keeps the transport position; lazy loading
 * with onProgress, one compile per instance, concurrent switches sharing one load; an unavailable profile rejects with
 * a clear error and never falls back; dispose, panic, reset and errors work on every engine), the GM reset messages,
 * and profile_pack.h's ABI (profile_sysex resets on them). */
const assets = new URL('../dist/', import.meta.url);
const sources = { 'sb-pci128': { assets: dspack(5, [[32, ecwFixture()]]) }, 'gus-gf1': { assets: gusFixture() } };
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0);
test('profile in the create options, then useProfile: lazy loads with onProgress, one load for concurrent calls, the position kept', async () => {
  const heard: LoadProgress[] = [];
  const reads = (name: string) => heard.filter(p => p.phase === 'download' && p.url.endsWith(`/assets/profiles/${name}`)).length;
  const s = await OfflineSynth.create({ baseUrl: assets, profile: 'gus-gf1', profileSources: sources, onProgress: p => heard.push(p) });
  try {
    assert.equal(s.info.kind, 'gus-gf1'); assert.equal(s.info.profile, 'gus-gf1'); assert.equal(s.info.engine, 'Gravis UltraSound (GF1)');
    assert.deepEqual(s.info.engines, ['gus-gf1']); assert.equal(s.info.maxVoices, 32); assert.equal(reads('gus-gf1.wasm'), 1);
    assert.equal(reads('sb-pci128.wasm'), 0, 'nothing else loads before it is used');
    s.loadMidi(midiFixture()); s.play(); s.render(4800);
    const [a, b] = await Promise.all([s.useProfile('sb-pci128'), s.useProfile('sb-pci128')]);
    assert.equal(a.kind, 'sb-pci128'); assert.equal(b.kind, 'sb-pci128'); assert.equal(reads('sb-pci128.wasm'), 1);
    assert.equal(s.engine.playbackInfo().position, 0.1, 'switching keeps the transport position');
    assert.ok(energy(s.render(9600).left) > 0, 'the held note sounds on the new profile');
    assert.equal((await s.useProfile('gus-gf1')).kind, 'gus-gf1'); assert.equal(reads('gus-gf1.wasm'), 1, 'a loaded profile is not loaded again');
    assert.deepEqual(s.info.engines, ['gus-gf1', 'sb-pci128']); assert.equal(s.engine.playbackInfo().position, 0.3);
  } finally { s.close(); }
});
test('a pack in a pooled Node Buffer reaches the core as its own bytes', async () => {
  // VERIFIED defect of profile-assets.ts: slice().buffer of a pooled Buffer is the whole pool, which the core rejected.
  const pooled = Buffer.from(gusFixture());
  assert.ok(pooled.buffer.byteLength > pooled.length, 'a view into Node\'s shared pool');
  const s = await OfflineSynth.create({ baseUrl: assets, profile: 'gus-gf1', profileSources: { 'gus-gf1': { assets: pooled } } });
  try { assert.equal(s.info.kind, 'gus-gf1'); } finally { s.close(); }
});
test('an unavailable profile rejects with an error naming it and what it needs; the engine that played plays on', async () => {
  // Without its ROMs (and in a checkout without its module) a Roland profile rejects; AWE32Emu builds only locally.
  await assert.rejects(OfflineSynth.create({ baseUrl: assets, profile: 'roland-mt32' }), /The roland-mt32 profile \(Roland MT-32\) is unavailable: its (module|asset pack) did not load: /);
  await assert.rejects(OfflineSynth.create({ baseUrl: assets, profile: 'awe32' }), /awe32 profile .* unavailable: its module did not load: .*--local-awe/);
  await assert.rejects(OfflineSynth.create({ baseUrl: assets, profile: 'fm' as never }), /Unknown synth profile/);
  await assert.rejects(OfflineSynth.create({ baseUrl: assets, engine: 'fm', profile: 'sb16-opl3' }), /disagree/);
  const s = await OfflineSynth.create({ baseUrl: assets, engine: 'fm' });
  try {
    s.loadMidi(midiFixture()); s.play(); s.render(4800);
    await assert.rejects(s.useProfile('awe64'), /The awe64 profile .* is unavailable: its module did not load/);
    await assert.rejects(s.useProfile('sb-pci128'), /The sb-pci128 profile .* is unavailable: its asset pack did not load: .*profileSources\['sb-pci128'\]\.assets/);
    await assert.rejects(s.useProfile('fm' as never), RangeError, "useProfile takes profiles; 'fm' is the legacy engine");
    assert.equal(s.info.kind, 'fm'); assert.deepEqual(s.info.engines, ['fm']); assert.equal(s.engine.playbackInfo().position, 0.1);
    assert.ok(energy(s.render(4800).left) > 0, 'no silent fallback: the FM engine plays on');
  } finally { s.close(); }
  const bad = await OfflineSynth.create({ baseUrl: assets, profileSources: { 'gus-gf1': { assets: Uint8Array.of(1, 2, 3) } } });
  try {
    await assert.rejects(bad.useProfile('gus-gf1'), /Invalid\/missing assets or initialization failed for gus-gf1/);
    assert.equal(bad.info.kind, 'soundfont');
  } finally { bad.close(); }
});
const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
for (const kind of ['soundfont', 'fm', 'sb16-opl3', 'sb-pci128', 'gus-gf1'] as const) {
  test(`${kind}: panic, reset, the reset SysEx, other SysEx and dispose`, async () => {
    const s = await OfflineSynth.create({ baseUrl: assets, engine: kind, profileSources: sources });
    const strike = () => { s.schedule([{ time: s.session.frame / 48000, type: 'noteOn', channel: 0, note: 60, velocity: 100 }]); s.render(480); assert.ok(s.engine.voices() > 0, 'a note sounds'); };
    const after = (events: TimedEvent[]) => { s.schedule(events.map(e => ({ ...e, time: s.session.frame / 48000 }))); s.render(4800); return s.engine.voices(); };
    try {
      strike(); s.engine.panic(); s.render(480); assert.equal(s.engine.voices(), 0, 'panic');
      strike(); assert.equal(after([{ time: 0, type: 'reset' }]), 0, 'reset');
      strike(); assert.equal(after([{ time: 0, type: 'sysex', data: GS_RESET }]), 0, 'the GS reset');
      strike(); assert.ok(after([{ time: 0, type: 'sysex', data: [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7f, 0x00, 0xf7] }]) > 0, 'another SysEx leaves the note');
      s.sendMidi([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], s.session.frame / 48000); s.render(4800); assert.equal(s.engine.voices(), 0, 'GM System On through sendMidi');
    } finally { s.close(); s.close(); }
    assert.throws(() => s.render(128), /disposed/); assert.throws(() => s.engine.panic(), /disposed/);
  });
}
test('a native profile through the scheduler: SysEx and notes at odd frames give the same PCM at any block size', async () => {
  const events: TimedEvent[] = [{ time: 0, type: 'noteOn', channel: 0, note: 60, velocity: 110 }, { time: 1001 / 48000, type: 'noteOn', channel: 1, note: 67, velocity: 90 },
    { time: 3337 / 48000, type: 'sysex', data: GS_RESET }, { time: 5003 / 48000, type: 'noteOn', channel: 0, note: 64, velocity: 100 }];
  for (const kind of ['sb-pci128', 'gus-gf1'] as const) {
    const whole = await OfflineSynth.create({ baseUrl: assets, profile: kind, profileSources: sources }), parts = await OfflineSynth.create({ baseUrl: assets, profile: kind, profileSources: sources });
    try {
      whole.schedule(events); parts.schedule(events);
      const one = whole.render(9000), left = new Float32Array(9000), right = new Float32Array(9000);
      for (let at = 0, n = 0; at < 9000; n++) { const size = Math.min([7, 61, 128, 1, 300][n % 5]!, 9000 - at); const p = parts.render(size); left.set(p.left, at); right.set(p.right, at); at += size; }
      assert.ok(energy(one.left.subarray(0, 3337)) > 0.01 && energy(one.left.subarray(5100)) > 0.01);
      assert.deepEqual(left, one.left); assert.deepEqual(right, one.right);
    } finally { whole.close(); parts.close(); }
  }
});

/* sb16-cqm on libADLMIDI's banks (native/profiles/cqm.cpp: a pack of role 33 names an embedded bank, role 32 holds a
 * WOPL bank), with the module that scripts/build-native-profiles.py builds; skipped where it is not built. The human's
 * brief: setFmBank and the fmBank option apply to the CQM as to the FM engine. */
const cqm = new URL('assets/profiles/sb16-cqm.wasm', assets);
test('sb16-cqm follows the FM bank: the fmBank option, setFmBank, loadFmBank, and a rejected bank keeps the last', { skip: !existsSync(cqm) && 'sb16-cqm.wasm is not built in this checkout' }, async () => {
  const note = (s: OfflineSynth) => { s.schedule([{ time: s.session.frame / 48000, type: 'noteOn', channel: 0, note: 60, velocity: 110 }]); return createHash('sha256').update(s.render(9600).left).digest('hex'); };
  const synth = (options: object) => OfflineSynth.create({ baseUrl: assets, profile: 'sb16-cqm', ...options });
  const a = await synth({}), b = await synth({ fmBank: 16 }), c = await synth({});
  try {
    assert.equal(a.info.fm!.bank, 0); assert.equal(b.info.fm!.bank, 16); assert.equal(b.info.fm!.chips, 1); assert.equal(b.info.maxVoices, 18);
    assert.equal(c.setFmBank(16).fm!.bank, 16);
    const bank0 = note(a), bank16 = note(b);
    assert.notEqual(bank0, bank16); assert.equal(note(c), bank16, 'setFmBank selects the bank the option does');
    assert.throws(() => c.setFmBank(79), RangeError);
    await assert.rejects(c.loadFmBank(new Uint8Array(64)), /initialization failed for sb16-cqm/); assert.equal(c.info.fm!.bank, 16);
    assert.equal((await c.loadFmBank(readFileSync(new URL('./test.wopl', import.meta.url)))).fm!.bank, -1);
  } finally { a.close(); b.close(); c.close(); }
  const fm = await OfflineSynth.create({ baseUrl: assets, engine: 'fm' });
  try {
    fm.setFmBank(16);
    assert.equal((await fm.useProfile('sb16-cqm')).fm!.bank, 16, 'a CQM loaded later starts on the bank the FM engine plays');
    fm.setFmBank(2); assert.equal(fm.info.fm!.bank, 2); assert.equal((await fm.useEngine('fm')).fm!.bank, 2, 'both follow setFmBank');
  } finally { fm.close(); }
});

// useProfile(profile, sources): a pack supplied after the synth exists, as a page takes ROMs or patches its user picks.
test('useProfile with sources: a pack given later loads the profile; a loaded profile keeps its pack', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets });
  try {
    await assert.rejects(s.useProfile('gus-gf1'), /gus-gf1/, 'without a pack the profile is not available');
    assert.equal(s.info.kind, 'soundfont', 'the engine that played plays on');
    assert.equal((await s.useProfile('gus-gf1', { assets: gusFixture() })).kind, 'gus-gf1');
    await assert.rejects(s.useProfile('gus-gf1', { assets: gusFixture(14) }), /loaded; its sources apply to a new synth/);
    await assert.rejects(s.useProfile('sb16-opl3', { assets: gusFixture() }), RangeError);
  } finally { s.close(); }
});

// Review findings of 2026-11-25, each reproduced before its fix.
test('a bank the active sb16-cqm rejects keeps the playing file: its program and state replayed as after a change', { skip: !existsSync(cqm) && 'sb16-cqm.wasm is not built in this checkout' }, async () => {
  // Program 73 on channel 1, a note at 0.5 s: the rejection at 0.25 s restarts the core, which must not lose program 73.
  const file = (program: number) => smf(0, 96, [[[0, 0xc0, program], [96, 0x90, 60, 110], [96, 0x80, 60, 0]]], 96);
  const run = async (program: number, action: (s: OfflineSynth) => Promise<unknown>) => {
    const s = await OfflineSynth.create({ baseUrl: assets, profile: 'sb16-cqm' });
    try { s.loadMidi(file(program)); s.play(); s.render(12000); await action(s); return createHash('sha256').update(s.render(48000).left).digest('hex'); }
    finally { s.close(); }
  };
  const rejected = await run(73, s => assert.rejects(s.loadFmBank(new Uint8Array(64))));
  assert.equal(rejected, await run(73, async s => s.setFmBank(0)), 'as a change to the same bank');
  assert.notEqual(rejected, await run(0, async s => s.setFmBank(0)), 'program 73 still sounds');
});
test('useProfile sources join the profileSources entry of their profile', async () => {
  // A module given at creation stays when the pack comes later: a module path that does not exist must fail the load.
  const s = await OfflineSynth.create({ baseUrl: assets, profileSources: { 'gus-gf1': { wasm: 'assets/profiles/missing.wasm' } } });
  try { await assert.rejects(s.useProfile('gus-gf1', { assets: gusFixture() }), /module did not load/); }
  finally { s.close(); }
});
test('offline, an FM engine that loads while setFmBank runs starts on the new bank, as in the worklet', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets, engine: 'fm' });
  try {
    const switching = s.useProfile('sb16-opl3');
    s.setFmBank(16);
    assert.equal((await switching).fm!.bank, 16);
    assert.equal((await s.useEngine('fm')).fm!.bank, 16);
  } finally { s.close(); }
});
test('a synthesizer whose only libADLMIDI engine is the CQM lists the 79 bank names, the FM module\'s', { skip: !existsSync(cqm) && 'sb16-cqm.wasm is not built in this checkout' }, async () => {
  const fm = await OfflineSynth.create({ baseUrl: assets, engine: 'fm' }), c = await OfflineSynth.create({ baseUrl: assets, profile: 'sb16-cqm', fmBank: 16 });
  try {
    assert.deepEqual(fm.info.fm!.banks, FM_BANK_NAMES, 'the table matches fm-synth.wasm');
    assert.deepEqual(c.info.fm!.banks, FM_BANK_NAMES); assert.equal(c.info.fm!.bank, 16);
  } finally { fm.close(); c.close(); }
});
