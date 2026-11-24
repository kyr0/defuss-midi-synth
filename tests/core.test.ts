/* Real WASM tests of the engine, scheduler, file transport and parsers. Expected values come from:
 * - the SoundFont 2.04 specification for the written SoundFont (fixtures.ts, soundfont): a sample plays at its
 *   original key's pitch, k semitones higher plays it 2^(k/12) faster, bank 128 holds drum kits;
 * - General MIDI 1: 128 programs, drums on channel 10, channel volume 100 at power-up, a pitch bend range of two
 *   semitones that RPN 0 changes, the GM System On message F0 7E 7F 09 01 F7;
 * - the MIDI 1.0 Detailed Specification for running status, real-time and system messages;
 * - Standard MIDI Files 1.0 for tempo (microseconds per quarter note) and SMPTE division; the MUS format's 140 Hz
 *   clock; RIFF RMID's data chunk;
 * - the bundled TimGM6mb.sf2's preset headers (128 programs of bank 0, 8 drum kits of bank 128). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OfflineSynth, encodeWav } from '../src/offline.ts';
import { EventQueue } from '../src/queue.ts';
import { parseSong } from '../src/midifile.ts';
import { MidiParser, MidiStream, isReset } from '../src/parser.ts';
import { RENDER_GRID } from '../src/session.ts';
import { inputBytes, packEvent, normalizeOptions, type TimedEvent, type PackedEvent } from '../src/types.ts';
import { midiFixture, musFixture, pitch, rmiFixture, score, smf, soundfont } from './fixtures.ts';
// The production loader expects assets/. Use the delivered dist assets in tests.
const assets = new URL('../dist/', import.meta.url);
async function create(options = {}) { return OfflineSynth.create({ baseUrl: assets, ...options }); }
async function sines(options = {}) { return create({ soundfont: soundfont(), ...options }); }
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0);
const peak = (x: Float32Array) => x.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
const hash = (x: Float32Array) => createHash('sha256').update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest('hex');
const on = (time: number, note: number, channel = 0, velocity = 127): TimedEvent => ({ time, type: 'noteOn', channel, note, velocity });

test('validation rejects invalid options, events and inputs without integer coercion', () => {
  for (const value of [NaN, Infinity, -1, 0.5, 128]) assert.throws(() => packEvent({ time: 0, type: 'noteOn', channel: 0, note: value, velocity: 1 }, 48000));
  assert.throws(() => normalizeOptions({ maxVoices: 0 }));
  assert.throws(() => normalizeOptions({ sampleRate: NaN }));
  assert.throws(() => packEvent({ type: 'noteOn', time: -1, channel: 0, note: 60, velocity: 1 }, 48000));
  assert.throws(() => packEvent({ type: 'programChange', time: 0, channel: 16, program: 0 }, 48000));
  assert.throws(() => packEvent({ type: 'preset', time: 0, channel: 0, bank: 16384, program: 0 }, 48000));
  assert.throws(() => packEvent({ type: 'bogus', time: 0, channel: 0 } as never, 48000), TypeError);
  assert.deepEqual(packEvent({ type: 'reset', time: 1 }, 48000), [48000, 8, 0, 0, 0]);
  assert.deepEqual(packEvent({ type: 'pitchBend', time: 0, channel: 3, value: 16383 }, 48000), [0, 4, 3, 16383, 0]);
  assert.throws(() => inputBytes(new Uint8Array(0), 10, 'file length'));
  assert.throws(() => inputBytes('bytes' as never, 10, 'file length'), TypeError);
});
test('stable heap matches independent sort for randomized timestamps', () => {
  const q = new EventQueue(1000), scratch = new Int32Array(4);
  const events: PackedEvent[] = []; let seed = 42;
  for (let i = 0; i < 1000; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; events.push([seed % 97, 0, i, 0, 0]); }
  q.pushBatch(events);
  for (const e of [...events].sort((a, b) => a[0] - b[0])) { assert.equal(q.nextFrame, e[0]); q.pop(scratch); assert.equal(scratch[1], e[2]); }
  assert.equal(q.nextFrame, Infinity); assert.throws(() => q.pop(scratch));
});
test('queue overflow and malformed batches are atomic', () => {
  const q = new EventQueue(2); q.pushBatch([[1, 0, 0, 1, 1]]);
  assert.throws(() => q.pushBatch([[2, 0, 0, 1, 1], [3, 0, 0, 1, 1]])); assert.equal(q.size, 1);
  assert.throws(() => q.pushBatch([[NaN, 0, 0, 1, 1]])); assert.equal(q.size, 1);
  assert.throws(() => q.pushBatch([[1, 9, 0, 1, 1]])); assert.equal(q.size, 1);
  q.clear(); assert.equal(q.size, 0);
});
test('the bundled SoundFont holds the 128 General MIDI programs and 8 drum kits', async () => {
  const s = await create();
  try {
    const { engine, presets, maxVoices, sampleRate } = s.info;
    assert.equal(engine, 'TinySoundFont 0.9'); assert.equal(maxVoices, 256); assert.equal(sampleRate, 48000);
    assert.deepEqual(presets.filter(p => p.bank === 0).map(p => p.program), Array.from({ length: 128 }, (_, i) => i));
    assert.deepEqual(presets.filter(p => p.bank === 128).map(p => p.program), [0, 8, 16, 24, 25, 32, 40, 48]);
    assert.equal(presets.length, 136);
    assert.deepEqual(presets[0], { bank: 0, program: 0, name: 'Piano 1' });
    assert.equal(presets.find(p => p.bank === 128 && p.program === 0)?.name, 'Standard');
  } finally { s.close(); s.close(); }
  assert.throws(() => s.render(128), /disposed/);
});
test('a note plays its sample at its pitch; programs, drums and direct presets select samples', async () => {
  const s = await sines();
  // Ends every voice, starts the events at the current frame, skips 50 ms of transition and measures 100 ms.
  const measure = (events: (t: number) => TimedEvent[]) => {
    const t = s.session.frame / 48000;
    s.schedule([...Array.from({ length: 16 }, (_, channel) => ({ time: t, type: 'controlChange', channel, controller: 120, value: 0 } as TimedEvent)), ...events(t)]);
    s.render(2400);
    return pitch(s.render(4800).left);
  };
  const near = (value: number, expected: number, label: string) => assert.ok(Math.abs(value - expected) < 0.5, `${label}: ${value}`);
  try {
    near(measure(t => [on(t, 60)]), 480, 'the original key');
    near(measure(t => [on(t, 72)]), 960, 'an octave higher');
    near(measure(t => [{ time: t, type: 'programChange', channel: 1, program: 1 }, on(t, 60, 1)]), 960, 'program 1');
    near(measure(t => [on(t, 60, 9)]), 960, 'channel 10 plays bank 128');
    near(measure(t => [on(t, 60, 2)]), 480, 'channel 3 starts on program 0');
    near(measure(t => [{ time: t, type: 'preset', channel: 2, bank: 128, program: 0 }, on(t, 60, 2)]), 960, 'a preset event reaches bank 128');
  } finally { s.close(); }
});
test('pitch bend spans two semitones, and RPN 0 sets the range', async () => {
  const s = await sines();
  try {
    s.schedule([{ time: 0, type: 'pitchBend', channel: 0, value: 16383 }, on(0, 60)]);
    assert.ok(Math.abs(pitch(s.render(9600).left) - 480 * 2 ** (2 / 12)) < 0.5);
    s.schedule([101, 100].map(controller => ({ time: 0.2, type: 'controlChange', channel: 0, controller, value: 0 } as TimedEvent))
      .concat([{ time: 0.2, type: 'controlChange', channel: 0, controller: 6, value: 12 }]));
    s.render(4800);
    assert.ok(Math.abs(pitch(s.render(9600).left) - 960) < 0.5);
  } finally { s.close(); }
});
test('channels start at the GM volume 100; a GM System On through sendMidi restores it', async () => {
  const s = await sines();
  try {
    s.schedule([on(0, 60)]); const atDefault = peak(s.render(4800).left);
    s.schedule([{ time: 0.1, type: 'controlChange', channel: 0, controller: 7, value: 127 }]); s.render(4800);
    const atFull = peak(s.render(4800).left);
    assert.ok(atDefault > 0.01 && atFull > atDefault * 1.5);
    s.sendMidi([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], 0.3); s.render(4800);
    assert.equal(s.engine.voices(), 0, 'the reset ends every voice');
    s.sendMidi([0x90, 60, 127], 0.4); s.render(4800);
    assert.ok(Math.abs(peak(s.render(4800).left) - atDefault) < atDefault * 0.01);
  } finally { s.close(); }
});
test('note off releases, panic silences at once, maxVoices bounds the voices', async () => {
  const s = await sines();
  try {
    s.schedule([on(0, 60), { time: 0.01, type: 'noteOff', channel: 0, note: 60 }]); s.render(9600);
    assert.equal(s.engine.voices(), 0);
    s.schedule([on(0.2, 60), on(0.2, 64, 1)]); s.render(480); assert.equal(s.engine.voices(), 2);
    s.engine.panic(); s.render(4800); assert.equal(s.engine.voices(), 0);
  } finally { s.close(); }
  const one = await sines({ maxVoices: 1 });
  try { one.schedule([on(0, 60), on(0, 72, 1)]); one.render(480); assert.equal(one.engine.voices(), 1); } finally { one.close(); }
});
test('sample scheduling keeps pre-onset silence; late events counted', async () => {
  const s = await create();
  try {
    s.schedule([on(257 / 48000, 60)]);
    const pcm = s.render(8192); assert.equal(energy(pcm.left.slice(0, 257)), 0); assert.ok(energy(pcm.left.slice(257, 257 + 64)) > 0);
    s.schedule([{ time: 0, type: 'noteOff', channel: 0, note: 60 }]); s.render(128);
    assert.equal(s.session.stats().lateEvents, 1);
  } finally { s.close(); }
});
test('render blocks that are multiples of the 64-frame grid do not change the PCM', async () => {
  const a = await create(), b = await create();
  try {
    assert.equal(RENDER_GRID, 64);
    const events = score(); a.schedule(events); b.schedule(events);
    const whole = a.render(240000), chunks = { left: new Float32Array(240000), right: new Float32Array(240000) };
    let offset = 0, n = 0;
    while (offset < 240000) {
      const size = Math.min([64, 128, 192, 1024, 4096, 128 * 7][n++ % 6]!, 240000 - offset);
      const part = b.render(size); chunks.left.set(part.left, offset); chunks.right.set(part.right, offset); offset += size;
    }
    assert.ok(energy(whole.left) > 1);
    assert.equal(hash(chunks.left), hash(whole.left)); assert.equal(hash(chunks.right), hash(whole.right));
  } finally { a.close(); b.close(); }
});
test('any render block size keeps every onset at its frame', async () => {
  const s = await sines();
  try {
    s.schedule([on(1000 / 48000, 60), on(3001 / 48000, 72, 1)]);
    const left = new Float32Array(6000);
    let offset = 0, n = 0;
    while (offset < left.length) { const size = Math.min([1, 31, 127, 257][n++ % 4]!, left.length - offset); left.set(s.render(size).left, offset); offset += size; }
    assert.equal(energy(left.slice(0, 1000)), 0); assert.ok(energy(left.slice(1000, 1064)) > 0);
  } finally { s.close(); }
});
test('the SMF, RMI and MUS parsers time messages by tempo, division and clock', () => {
  const midi = parseSong(midiFixture());
  assert.equal(midi.duration, 0.5); assert.deepEqual([...midi.times], [0, 0, 0.5]);
  assert.deepEqual([...midi.messages], [0xc0 | 80 << 8, 0x90 | 60 << 8 | 100 << 16, 0x80 | 60 << 8]);
  assert.deepEqual(parseSong(rmiFixture(midiFixture())), midi);
  const mus = parseSong(musFixture());
  assert.equal(mus.duration, 0.5); assert.deepEqual([...mus.times], [0, 0.5]);
  assert.deepEqual([...mus.messages], [0x90 | 60 << 8 | 100 << 16, 0x80 | 60 << 8]);
  // Format 1: the tempo map of track 0 times track 1; 480 ticks at 500,000 us, then 480 at 250,000 us.
  const format1 = parseSong(smf(1, 480, [
    [[0, 0xff, 0x03, 4, 0x53, 0x6f, 0x6e, 0x67], [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], [480, 0xff, 0x51, 3, 0x03, 0xd0, 0x90]],
    [[960, 0x91, 64, 90], [480, 64, 0]],
  ]));
  assert.equal(format1.title, 'Song'); assert.deepEqual([...format1.times], [0.75, 1]); assert.equal(format1.duration, 1);
  assert.equal(format1.messages[1], 0x91 | 64 << 8, 'running status repeats the note on status');
  // SMPTE: 25 frames of 40 ticks are 1,000 ticks per second.
  assert.deepEqual([...parseSong(smf(0, 0xe728, [[[500, 0x90, 60, 1]]])).times], [0.5]);
  assert.deepEqual([...parseSong(smf(0, 96, [[[0, 0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7]]])).messages], [0xff]);
  assert.throws(() => parseSong(Uint8Array.of(1, 2, 3)), /Unsupported file format/);
  assert.throws(() => parseSong(smf(2, 96, [[[0, 0x90, 60, 1]]])), /format 2/);
  assert.throws(() => parseSong(smf(0, 96, [[[0, 60, 1]]])), /without a status/);
  assert.throws(() => parseSong(midiFixture().slice(0, 30)), /Truncated/);
  assert.throws(() => parseSong(musFixture().slice(0, 19)), /Truncated MUS/);
});
test('MIDI file load/play/pause/seek/stop/end/loop and malformed recovery', async () => {
  const s = await create();
  try {
    assert.throws(() => s.engine.play()); assert.throws(() => s.engine.seek(0));
    assert.throws(() => s.engine.loadMidi(new Uint8Array([1, 2, 3])));
    const meta = s.engine.loadMidi(midiFixture()); assert.equal(meta.duration, 0.5); assert.equal(meta.ended, false);
    assert.equal(energy(s.render(128).left), 0);
    s.engine.play(); assert.ok(energy(s.render(8192).left) > 0);
    s.engine.pause(); const before = s.engine.playbackInfo().position;
    assert.equal(energy(s.render(4096).left), 0); assert.equal(s.engine.playbackInfo().position, before);
    s.engine.seek(0); assert.throws(() => s.engine.seek(99999));
    s.engine.play(); s.render(48000 * 3); assert.equal(s.engine.playbackInfo().ended, true);
    s.engine.play(); assert.equal(s.engine.playbackInfo().ended, false);
    s.engine.stop(); assert.equal(s.engine.playbackInfo().position, 0);
    s.engine.play(true); s.render(48000 * 3 + 4800); assert.equal(s.engine.playbackInfo().ended, false);
    assert.equal(s.engine.playbackInfo().position, 0.1, 'six loops of 0.5 s, then 0.1 s');
    assert.throws(() => s.engine.loadMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64]))); assert.throws(() => s.engine.play(), /Load a MIDI file/);
  } finally { s.close(); }
});
test('file messages play at their frames, and seek applies the program changes before the target', async () => {
  const s = await sines();
  try {
    // Program 1 (high) at 0, a note at 0.5 s (192 ticks at 96 per quarter and 250,000 us).
    s.engine.loadMidi(smf(0, 96, [[[0, 0xff, 0x51, 3, 0x03, 0xd0, 0x90], [0, 0xc0, 1], [192, 0x90, 60, 127]]], 96));
    s.engine.play();
    const pcm = s.render(48000);
    assert.equal(energy(pcm.left.slice(0, 24000)), 0); assert.ok(energy(pcm.left.slice(24000, 24064)) > 0);
    assert.ok(Math.abs(pitch(pcm.left.slice(26000, 36000)) - 960) < 0.5);
    s.engine.seek(0.25); s.engine.play();
    assert.ok(Math.abs(pitch(s.render(36000).left.slice(14000)) - 960) < 0.5, 'the chased program change selects the high sample');
  } finally { s.close(); }
});
test('MUS input plays and reaches its end', async () => {
  const s = await create();
  try {
    assert.equal(s.engine.loadMidi(musFixture()).duration, 0.5);
    s.engine.play(); assert.ok(energy(s.render(8192).left) > 0);
    s.render(48000 * 3); assert.equal(s.engine.playbackInfo().ended, true);
  } finally { s.close(); }
});
test('loadSoundFont replaces the presets; a rejected SoundFont keeps the loaded one', async () => {
  const s = await create();
  try {
    assert.throws(() => s.engine.loadSoundFont(new Uint8Array(64)), /Invalid SoundFont/);
    assert.equal(s.info.presets.length, 136);
    s.engine.loadSoundFont(soundfont());
    assert.deepEqual(s.info.presets.map(p => `${p.bank}:${p.program}:${p.name}`), ['0:0:Low', '0:1:High', '128:0:Drums']);
    assert.ok(s.engine.hasPreset(128, 0)); assert.equal(s.engine.hasPreset(128, 1), false);
    s.schedule([on(0, 60)]); assert.ok(Math.abs(pitch(s.render(4800).left) - 480) < 0.5);
  } finally { s.close(); }
});
test('MidiParser keeps running status, real-time bytes and system exclusive apart', () => {
  const parse = (bytes: number[]) => {
    const messages: number[][] = [], sysex: number[][] = [];
    const parser = new MidiParser((time, status, d1, d2) => messages.push([time, status, d1, d2]), (time, data) => sysex.push([time, ...data]));
    bytes.forEach((byte, i) => parser.feed(byte, i));
    return { messages, sysex };
  };
  assert.deepEqual(parse([0x90, 0x3c, 0x7f, 0x40, 0x7f, 0x3c, 0x00]).messages, [[2, 0x90, 0x3c, 0x7f], [4, 0x90, 0x40, 0x7f], [6, 0x90, 0x3c, 0x00]]);
  assert.deepEqual(parse([0xc9, 0x05, 0x06]).messages, [[1, 0xc9, 0x05, 0], [2, 0xc9, 0x06, 0]]);
  assert.deepEqual(parse([0x90, 0x3c, 0xf8, 0x7f]).messages, [[2, 0xf8, 0, 0], [3, 0x90, 0x3c, 0x7f]]);
  const { messages, sysex } = parse([0x90, 0x3c, 0x7f, 0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7, 0x40, 0xf2, 0x01, 0x02, 0x41]);
  assert.deepEqual(messages, [[2, 0x90, 0x3c, 0x7f]]); assert.deepEqual(sysex, [[8, 0x7e, 0x7f, 0x09, 0x01]]);
  assert.equal(isReset(Uint8Array.of(0x7e, 0x7f, 0x09, 0x01)), true);
  assert.equal(isReset(Uint8Array.of(0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41)), true);
  assert.equal(isReset(Uint8Array.of(0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00)), true);
  assert.equal(isReset(Uint8Array.of(0x7e, 0x7f, 0x09, 0x02)), false);
});
test('MidiStream turns byte streams into typed events and keeps running status between calls', () => {
  const stream = new MidiStream();
  assert.deepEqual(stream.events([0x91, 60], 1), []);
  assert.deepEqual(stream.events([100, 64, 0], 2), [on(2, 60, 1, 100), on(2, 64, 1, 0)]);
  assert.deepEqual(stream.events([0xe2, 0x7f, 0x7f, 0xd3, 5, 0xa4, 60, 9, 0xff, 0xfe], 3), [
    { time: 3, type: 'pitchBend', channel: 2, value: 16383 }, { time: 3, type: 'channelPressure', channel: 3, value: 5 },
    { time: 3, type: 'polyPressure', channel: 4, note: 60, value: 9 }, { time: 3, type: 'reset' }]);
  assert.throws(() => stream.events([256], 0), RangeError);
});
test('WAV headers, stereo ordering, clipping and non-finite rejection', () => {
  const bytes = encodeWav({ sampleRate: 48000, left: Float32Array.of(-2, 1), right: Float32Array.of(0, 0.5) });
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(40, true), 8); assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0); assert.equal(view.getInt16(48, true), 32767);
  assert.throws(() => encodeWav({ sampleRate: 48000, left: Float32Array.of(NaN), right: Float32Array.of(0) }));
  assert.throws(() => encodeWav({ sampleRate: 48000, left: new Float32Array(1), right: new Float32Array(0) }));
});
