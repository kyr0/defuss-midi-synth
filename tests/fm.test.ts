/* Real WASM tests of the FM engine (fm-synth.wasm: libADLMIDI on Nuked OPL3) and of switching engines. Expected values
 * come from:
 * - the YMF262 data sheet: 18 two-operator channels per chip;
 * - libADLMIDI's banks.ini (docs/music/banks.ini): 79 embedded banks, numbered and named there;
 * - General MIDI 1: A4 is note 69 at 440 Hz, an octave doubles the frequency, channel 10 holds the percussion;
 * - the WOPL format of libADLMIDI (tests/test.wopl is libADLMIDI's own test bank).
 * The block renderer's equality with the per-sample chip is checked where the module is built
 * (scripts/rebuild-wasm.sh: tests/opl3-block-test.c and scripts/fm-parity.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OfflineSynth } from '../src/offline.ts';
import type { LoadProgress, TimedEvent } from '../src/types.ts';
import { midiFixture, score, smf } from './fixtures.ts';

const assets = new URL('../dist/', import.meta.url);
const fm = (options = {}) => OfflineSynth.create({ baseUrl: assets, engine: 'fm', ...options });
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0);
const hash = (x: Float32Array) => createHash('sha256').update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest('hex');
/** The fundamental from the autocorrelation: the first peak (between 0.5 ms and 50 ms of lag) within 90% of the
 *  highest, as multiples of the period peak about as high, refined by a parabola through it and its neighbours. */
function frequency(x: Float32Array, rate = 48000): number {
  const corr = (lag: number) => { let c = 0; for (let i = 0; i < 9600; i++) c += x[i]! * x[i + lag]!; return c; };
  const values = Array.from({ length: 2400 }, (_, lag) => lag < 24 ? 0 : corr(lag));
  const max = Math.max(...values);
  let lag = 25;
  while (!(values[lag]! >= 0.9 * max && values[lag]! >= values[lag - 1]! && values[lag]! >= values[lag + 1]!)) lag++;
  const a = values[lag - 1]!, b = values[lag]!, c = values[lag + 1]!;
  return rate / (lag + (a - c) / (2 * (a - 2 * b + c)));
}
function held(s: OfflineSynth, note: number, channel = 0): Float32Array {
  const t = s.session.frame / 48000;
  s.schedule([{ time: t, type: 'noteOn', channel, note, velocity: 127 }]);
  s.render(4800);
  const out = s.render(14400).left;
  s.schedule([{ time: s.session.frame / 48000, type: 'noteOff', channel, note }]);
  s.render(48000);
  return out;
}

test('the FM engine embeds the 79 banks of banks.ini and 18 voices per chip', async () => {
  const s = await fm({ chips: 3 });
  try {
    const { engine, kind, engines, maxVoices, presets, fm: info } = s.info;
    assert.equal(engine, 'libADLMIDI 1.6.2, Nuked OPL3'); assert.equal(kind, 'fm'); assert.deepEqual(engines, ['fm']);
    assert.equal(info!.chips, 3); assert.equal(maxVoices, 54); assert.equal(info!.bank, 0);
    const ini = readFileSync(new URL('../docs/music/banks.ini', import.meta.url), 'utf8');
    const names = [...ini.matchAll(/^\[bank-(\d+)\][^[]*?^name\s*=\s*"([^"]*)"/gms)].map(m => m[2]);
    assert.equal(names.length, 79); assert.deepEqual(info!.banks, names);
    assert.equal(presets.length, 129); assert.equal(presets[0]!.name, 'Acoustic Grand Piano');
    assert.deepEqual(presets[128], { bank: 128, program: 0, name: 'Percussion' });
  } finally { s.close(); }
  const d = await fm();
  try { assert.equal(d.info.fm!.chips, 2); assert.equal(d.info.maxVoices, 36); } finally { d.close(); }
  await assert.rejects(fm({ chips: 9 }), RangeError); await assert.rejects(fm({ fmBank: 79 }), RangeError);
});
test('an FM note sounds at its General MIDI pitch, an octave doubling it', async () => {
  for (const bank of [0, 16, 72]) {
    const s = await fm({ fmBank: bank });
    try {
      s.schedule([{ time: 0, type: 'programChange', channel: 0, program: 73 }]); // flute: a strong fundamental
      const a3 = frequency(held(s, 57)), a4 = frequency(held(s, 69));
      assert.ok(Math.abs(a4 / 440 - 1) < 0.01, `bank ${bank}: A4 at ${a4} Hz`);
      assert.ok(Math.abs(a4 / a3 - 2) < 0.02, `bank ${bank}: A3 at ${a3} Hz`);
    } finally { s.close(); }
  }
});
test('banks change the instruments; a WOPL file loads; invalid banks keep the current one', async () => {
  // Each note is rendered by a fresh synthesizer: the chip's tremolo, vibrato and envelope clocks run on, so the same
  // note later in one instance differs.
  const note = async (prepare: (s: OfflineSynth) => Promise<unknown> | unknown) => {
    const s = await fm();
    try { await prepare(s); return hash(held(s, 60)); } finally { s.close(); }
  };
  const bank0 = await note(() => undefined), bank16 = await note(s => s.setFmBank(16));
  assert.notEqual(bank0, bank16);
  assert.equal(await note(s => { s.setFmBank(16); assert.throws(() => s.setFmBank(79), RangeError); assert.equal(s.info.fm!.bank, 16); }), bank16);
  assert.equal(await note(async s => { s.setFmBank(16); await assert.rejects(s.loadFmBank(new Uint8Array(64)), /not a WOPL file/); assert.equal(s.info.fm!.bank, 16); }), bank16, 'a rejected file leaves the instruments');
  const wopl = readFileSync(new URL('./test.wopl', import.meta.url));
  const custom = await note(async s => assert.equal((await s.loadFmBank(wopl)).fm!.bank, -1));
  assert.notEqual(custom, bank0); assert.notEqual(custom, bank16);
});
test('FM percussion plays on channel 10; note off releases and panic ends every voice', async () => {
  const s = await fm();
  try {
    s.schedule([{ time: 0, type: 'noteOn', channel: 9, note: 38, velocity: 127 }]);
    assert.ok(energy(s.render(9600).left) > 0.01, 'snare drum');
    s.schedule([{ time: s.session.frame / 48000, type: 'noteOn', channel: 0, note: 60, velocity: 100 }, { time: s.session.frame / 48000, type: 'noteOn', channel: 1, note: 64, velocity: 100 }]);
    s.render(480); assert.ok(s.engine.voices() >= 2);
    const off = s.session.frame / 48000;
    s.schedule([{ time: off, type: 'noteOff', channel: 9, note: 38 }, { time: off, type: 'noteOff', channel: 0, note: 60 }, { time: off, type: 'noteOff', channel: 1, note: 64 }]);
    // fm_voices counts the channels notes hold: 0 once every note is off, while the released notes still ring out.
    assert.ok(energy(s.render(4800).left) > 0.01, 'note off releases the notes instead of cutting them');
    assert.equal(s.engine.voices(), 0, 'note off frees the voices');
    s.schedule([{ time: s.session.frame / 48000, type: 'noteOn', channel: 0, note: 60, velocity: 100 }]);
    s.render(480); assert.ok(s.engine.voices() >= 1);
    s.engine.panic(); s.render(480); assert.equal(s.engine.voices(), 0);
  } finally { s.close(); }
});
test('an FM reset returns every channel to bank 0, program 1 (General MIDI), as file loads, stop and seek rely on', async () => {
  const note = async (program: number, reset: boolean) => {
    const s = await fm();
    try {
      s.schedule([{ time: 0, type: 'controlChange', channel: 0, controller: 0, value: 1 }, { time: 0, type: 'programChange', channel: 0, program },
        ...(reset ? [{ time: 0, type: 'reset' } as const] : [])]);
      s.render(4800);
      return hash(held(s, 60));
    } finally { s.close(); }
  };
  const piano = await note(0, false);
  assert.notEqual(await note(73, false), piano, 'program 74 (flute) sounds unlike program 1');
  assert.equal(await note(73, true), piano, 'after a reset the channel plays program 1 again');
});
test('FM render blocks that are multiples of the 64-frame grid do not change the PCM', async () => {
  const a = await fm(), b = await fm();
  try {
    const events = score(); a.schedule(events); b.schedule(events);
    const whole = a.render(240000), left = new Float32Array(240000);
    for (let offset = 0, n = 0; offset < 240000; n++) {
      const size = Math.min([64, 128, 192, 1024, 4096, 896][n % 6]!, 240000 - offset);
      left.set(b.render(size).left, offset); offset += size;
    }
    assert.ok(energy(whole.left) > 1); assert.equal(hash(left), hash(whole.left));
  } finally { a.close(); b.close(); }
});
test('switching engines keeps a file playing from its position, with its programs', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets });
  try {
    assert.equal(s.info.kind, 'soundfont'); assert.deepEqual(s.info.engines, ['soundfont']); assert.equal(s.info.fm, undefined);
    s.engine.loadMidi(midiFixture()); s.engine.play();
    s.render(4800);
    const before = s.engine.playbackInfo().position;
    const info = await s.useEngine('fm');
    assert.equal(info.kind, 'fm'); assert.deepEqual(info.engines, ['soundfont', 'fm']); assert.equal(info.fm!.banks.length, 79);
    assert.equal(s.engine.playbackInfo().position, before);
    assert.ok(energy(s.render(9600).left) > 0, 'the file sounds on the FM engine');
    assert.equal((await s.useEngine('soundfont')).kind, 'soundfont');
    assert.equal(before, 0.1); assert.equal(s.engine.playbackInfo().position, 0.3);
    assert.throws(() => s.engine.use('bogus' as never), RangeError); assert.equal(s.info.kind, 'soundfont');
    await assert.rejects(s.useEngine('bogus' as never), RangeError);
  } finally { s.close(); }
});
test('the playback rate scales the file clock and keeps 1 exact', async () => {
  const s = await OfflineSynth.create({ baseUrl: assets });
  try {
    s.engine.loadMidi(midiFixture());
    assert.equal(s.engine.playbackInfo().rate, 1);
    s.engine.setRate(2); s.engine.play();
    s.render(12000); assert.equal(s.engine.playbackInfo().position, 0.5);
    s.render(128); assert.equal(s.engine.playbackInfo().ended, true, 'the 0.5 s file ends after 0.25 s at rate 2');
    for (const bad of [0, 0.2, 4.5, NaN]) assert.throws(() => s.engine.setRate(bad), RangeError);
    s.engine.setRate(0.5); s.engine.play(); s.render(4800); assert.equal(s.engine.playbackInfo().position, 0.05);
  } finally { s.close(); }
});
test('an FM preset event selects the program as bank select and program change do; percussion only on channel 10', async () => {
  const note = async (events: Parameters<OfflineSynth['schedule']>[0], channel = 0, key = 60) => {
    const s = await fm();
    try { s.schedule(events); return hash(held(s, key, channel)); } finally { s.close(); }
  };
  const flute = await note([{ time: 0, type: 'controlChange', channel: 0, controller: 0, value: 0 }, { time: 0, type: 'programChange', channel: 0, program: 73 }]);
  assert.equal(await note([{ time: 0, type: 'preset', channel: 0, bank: 0, program: 73 }]), flute);
  assert.notEqual(await note([{ time: 0, type: 'preset', channel: 0, bank: 0, program: 0 }]), flute);
  assert.equal(await note([{ time: 0, type: 'preset', channel: 9, bank: 128, program: 0 }], 9, 38), await note([], 9, 38));
});

/* SysEx on the FM engine. Expected values come from libADLMIDI's realTime_SysEx (native/adlmidi/src/adlmidi_midiplay.cpp,
 * the contract fm.cpp's fm_sysex passes messages to): the GS "use for rhythm part" message F0 41 10 42 12 40 1<p> 15 <v>
 * <sum> F7 makes a channel a percussion channel (part 1 is MIDI channel 1), GM Master Volume F0 7F 7F 04 01 <lsb> <msb>
 * F7 scales every channel, and the resets of General MIDI, GS and XG return the synthesizer to its General MIDI
 * state. Roland's checksum is 128 minus the sum of address and data, modulo 128. */
const GS_DRUMS_PART1 = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x11, 0x15, 0x01, 0x19, 0xf7];
const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
const sysex = (time: number, data: number[]): TimedEvent => ({ time, type: 'sysex', data });
test('libADLMIDI receives SysEx: a GS rhythm part plays percussion, and a reset returns it to General MIDI', async () => {
  const note = async (events: TimedEvent[], channel: number, kind: 'fm' | 'sb16-opl3' = 'fm') => {
    const s = await fm({ engine: kind });
    try { s.schedule(events); s.render(128); return hash(held(s, 38, channel)); } finally { s.close(); }
  };
  const snare = await note([], 9), melodic = await note([], 0);
  assert.notEqual(melodic, snare);
  assert.equal(await note([sysex(0, GS_DRUMS_PART1)], 0), snare, 'channel 1 plays the snare drum of channel 10');
  assert.equal(await note([sysex(0, GS_DRUMS_PART1), { time: 0, type: 'reset' }], 0), melodic, 'a reset ends the rhythm part');
  assert.equal(await note([sysex(0, GS_DRUMS_PART1), sysex(0, GS_RESET)], 0), melodic, 'so does the GS reset');
  assert.equal(await note([sysex(0, GS_DRUMS_PART1)], 0, 'sb16-opl3'), await note([], 9, 'sb16-opl3'), 'the sb16-opl3 profile takes SysEx too');
});
test('FM GM Master Volume lowers every channel; a reset restores it and the program', async () => {
  const level = async (events: TimedEvent[]) => {
    const s = await fm();
    try { s.schedule(events); s.render(128); return { energy: energy(held(s, 60)), hash: hash(held(s, 64)) }; } finally { s.close(); }
  };
  const full = await level([]), low = await level([sysex(0, [0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x20, 0xf7])]);
  assert.ok(low.energy < full.energy / 2, `master volume 32 of 127: energy ${low.energy} against ${full.energy}`);
  const reset = await level([{ time: 0, type: 'programChange', channel: 0, program: 73 }, sysex(0, [0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x20, 0xf7]),
    sysex(0, [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])]);
  assert.equal(reset.hash, full.hash, 'GM System On: full volume and program 1 again');
});
test('a file\'s SysEx reaches the engine it switches to, and a reset in the file ends the notes it held', async () => {
  // 120 BPM at 96 ticks per quarter: the GS rhythm part at 0, a note on channel 1 at 0.25 s that the file holds to its end.
  const drums = smf(0, 96, [[[0, 0xf0, GS_DRUMS_PART1.length - 1, ...GS_DRUMS_PART1.slice(1)], [48, 0x90, 38, 127]]], 480);
  const plain = smf(0, 96, [[[48, 0x90, 38, 127]]], 480);
  const switched = async (file: Uint8Array) => {
    const s = await OfflineSynth.create({ baseUrl: assets });
    try {
      s.loadMidi(file); s.play(); s.render(24000);
      await s.useEngine('fm'); return energy(s.render(9600).left);
    } finally { s.close(); }
  };
  const asDrum = await switched(drums), asTone = await switched(plain);
  assert.ok(asDrum > 0 && asTone > 0 && Math.abs(asDrum / asTone - 1) > 0.1, `the note restruck as a drum (${asDrum}) and as a tone (${asTone})`);
  // A GM System On at 0.5 s ends the note the file struck at 0: the next engine must not strike it again.
  const reset = smf(0, 96, [[[0, 0x90, 60, 127], [96, 0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7]]], 480);
  const s = await OfflineSynth.create({ baseUrl: assets });
  try {
    s.loadMidi(reset); s.play(); s.render(36000);
    await s.useEngine('fm'); s.render(480);
    assert.equal(s.engine.voices(), 0, 'no note restruck after the reset');
  } finally { s.close(); }
});
test('sb16-opl3 is libADLMIDI on one chip, as fm with one chip and at its level; fm keeps its chips', async () => {
  const pcm = async (options: object) => {
    const s = await OfflineSynth.create({ baseUrl: assets, ...options });
    try { s.schedule(score()); return { info: s.info, left: s.render(96000).left }; } finally { s.close(); }
  };
  const profile = await pcm({ profile: 'sb16-opl3', chips: 4 }), one = await pcm({ engine: 'fm', chips: 1 }), legacy = await pcm({ engine: 'fm' });
  assert.equal(profile.info.kind, 'sb16-opl3'); assert.equal(profile.info.profile, 'sb16-opl3'); assert.equal(profile.info.engine, 'Sound Blaster 16 (Yamaha OPL3)');
  assert.equal(profile.info.fm!.chips, 1, 'the chips option does not apply'); assert.equal(profile.info.maxVoices, 18);
  assert.equal(legacy.info.fm!.chips, 2); assert.equal(legacy.info.maxVoices, 36); assert.equal(legacy.info.profile, undefined);
  assert.ok(energy(one.left) > 1); assert.equal(hash(profile.left), hash(one.left), 'the same samples at the same gain as fm on one chip');
});
test('fm and sb16-opl3 share one compiled module: switching reads fm-synth.wasm once', async () => {
  const heard: LoadProgress[] = [];
  const s = await OfflineSynth.create({ baseUrl: assets, onProgress: p => heard.push(p) });
  try {
    const [a, b] = await Promise.all([s.useEngine('fm'), s.useEngine('fm')]);
    assert.equal(a.kind, 'fm'); assert.equal(b.kind, 'fm');
    assert.equal((await s.useProfile('sb16-opl3')).kind, 'sb16-opl3');
    assert.deepEqual(s.info.engines, ['soundfont', 'fm', 'sb16-opl3']);
    const reads = heard.filter(p => p.phase === 'download' && p.url.endsWith('/fm-synth.wasm'));
    assert.equal(reads.length, 1, `fm-synth.wasm read ${reads.length} times`);
  } finally { s.close(); }
});
