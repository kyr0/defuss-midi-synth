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
import { EventQueue, MAX_QUEUED_SYSEX_BYTES } from '../src/queue.ts';
import { parseSong, SYSEX_STATUS, MAX_FILE_SYSEX } from '../src/midifile.ts';
import { MidiParser, MidiStream, isReset, isResetMessage, MIDI_RESET } from '../src/parser.ts';
import { RENDER_GRID } from '../src/session.ts';
import { chaseMask } from '../src/engine.ts';
import { inputBytes, OP, packEvent, normalizeOptions, SYSEX_MAX, type TimedEvent, type PackedEvent } from '../src/types.ts';
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
  const longDelay = [0x90, 60 | 0x80, 100, 0x81, 0x81, 0x81, 0x81, 0x01, 0x60];
  assert.throws(() => parseSong(Uint8Array.from([77, 85, 83, 26, longDelay.length, 0, 16, 0, 1, 0, 0, 0, 0, 0, 0, 0, ...longDelay])),
    /Malformed MUS score: variable-length quantity over four bytes/, 'a MUS delay over four bytes is malformed, not an endless song');
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
  const fresh = new MidiStream();
  assert.deepEqual(fresh.events([0x90, 60, 100], 0), [on(0, 60, 0, 100)]);
  assert.throws(() => fresh.events([0x80, 60, 0, 0x91, 256], 1), RangeError);
  assert.deepEqual(fresh.events([61, 100], 2), [on(2, 61, 0, 100)], 'a rejected call leaves no events and keeps the running status');
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

/* System exclusive messages. Expected values come from:
 * - the MIDI 1.0 Detailed Specification: F0 starts and F7 ends a system exclusive message, its data bytes are below 80h,
 *   real-time bytes (F8 to FF) may sit inside it and leave it whole, any other status byte ends it;
 * - Standard MIDI Files 1.0: F0 <length> <bytes after F0> and F7 <length> <bytes>; an F7 event continues a SysEx that an
 *   F0 event left without F7 (a divided SysEx) and is otherwise an escape of bytes sent as they are;
 * - the reset messages: GM System On F0 7E <dev> 09 01 F7, GM2 System On F0 7E <dev> 09 03 F7, the GS reset
 *   F0 41 <dev> 42 12 40 00 7F 00 41 F7 and XG System On F0 43 1<n> 4C 00 00 7E 00 F7 (native/profiles/profile_pack.h);
 * - GM Master Volume F0 7F <dev> 04 01 <lsb> <msb> F7 (Universal Real Time, Device Control);
 * - native/profiles/profile_pack.h: PROFILE_SYSEX_MAX, 65,536 bytes from F0 to F7. */
const GM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], XG_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
const master = (msb: number, lsb = 0) => [0xf0, 0x7f, 0x7f, 0x04, 0x01, lsb, msb, 0xf7];
const smfVlq = (value: number) => { const out = [value & 0x7f]; while ((value >>= 7)) out.unshift(0x80 | (value & 0x7f)); return out; };
/** A SysEx event of kind (F0 or F7) carrying bytes, its length as a variable-length quantity. */
const sysexEvent = (delta: number, kind: number, bytes: number[]) => [delta, kind, ...smfVlq(bytes.length), ...bytes];

test('the SMF parser reads whole, divided and escaped SysEx, real-time bytes inside, and marks the resets', () => {
  const song = parseSong(smf(0, 96, [[
    sysexEvent(0, 0xf0, GM_ON.slice(1)),
    sysexEvent(0, 0xf0, [0x43, 0x10, 0x4c]), [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], sysexEvent(96, 0xf7, [0x00, 0x00, 0x7e, 0x00, 0xf7]),
    sysexEvent(0, 0xf0, [0x7f, 0x7f, 0x04]), sysexEvent(96, 0xf7, [0x01, 0xff, 0x00, 0x40, 0xf7]),
    sysexEvent(0, 0xf7, GS_RESET), sysexEvent(0, 0xf7, [0x91, 60, 100]), sysexEvent(0, 0xf7, [0xff]),
  ]]));
  // The divided XG System On completes at tick 96 across a tempo event, the divided master volume at tick 192 after
  // the System Reset (FF) that sits inside it; the escapes carry a whole GS reset, a note and a System Reset.
  assert.deepEqual([...song.times], [0, 0.5, 1, 1, 1, 1, 1]);
  assert.deepEqual([...song.messages], [MIDI_RESET, MIDI_RESET, MIDI_RESET, SYSEX_STATUS, MIDI_RESET, 0x91 | 60 << 8 | 100 << 16, MIDI_RESET]);
  assert.deepEqual(new Map([...song.sysex].map(([i, data]) => [i, [...data]])), new Map([[0, GM_ON], [1, XG_ON], [3, master(0x40)], [4, GS_RESET]]));
  assert.equal(song.sysex.has(2) || song.sysex.has(6), false, 'a System Reset byte carries no SysEx');
});
test('the SMF parser ends an unfinished SysEx at a channel event, drops one interrupted by a status, and keeps the 65,536-byte limit', () => {
  // An F0 event without F7 is a whole message when no F7 event continues it, as the parser before 0.4.0 took it.
  const open = parseSong(smf(0, 96, [[sysexEvent(0, 0xf0, GM_ON.slice(1, -1)), [10, 0x90, 60, 100]]]));
  assert.deepEqual([...open.messages], [MIDI_RESET, 0x90 | 60 << 8 | 100 << 16]); assert.deepEqual([...open.sysex.get(0)!], GM_ON);
  // A status byte inside a packet ends the SysEx unfinished; the bytes from it on are an escape.
  const cut = parseSong(smf(0, 96, [[sysexEvent(0, 0xf0, [0x7e, 0x7f, 0x90, 61, 100])]]));
  assert.deepEqual([...cut.messages], [0x90 | 61 << 8 | 100 << 16]); assert.equal(cut.sysex.size, 0);
  const data = (n: number) => Array.from({ length: n }, (_, i) => i & 0x7f);
  const longest = parseSong(smf(0, 96, [[sysexEvent(0, 0xf0, [0x7d, ...data(SYSEX_MAX - 3), 0xf7])]]));
  assert.equal(longest.sysex.get(0)!.length, SYSEX_MAX, 'F0, 65,534 data bytes and F7');
  const over = parseSong(smf(0, 96, [[sysexEvent(0, 0xf0, [0x7d, ...data(SYSEX_MAX - 2), 0xf7]), [0, 0x90, 60, 1]]]));
  assert.deepEqual([...over.messages], [0x90 | 60 << 8 | 1 << 16], 'a longer SysEx is dropped whole, never cut');
});
test('MidiParser keeps real-time bytes inside SysEx apart and drops a message over 65,536 bytes whole', () => {
  const messages: number[][] = [], sysex: number[][] = [];
  const parser = new MidiParser((time, status) => messages.push([time, status]), (time, data) => sysex.push([time, data.length, data[0]!, data.at(-1)!]));
  [0xf0, 0x7e, 0xf8, 0x7f, 0xfe, 0x09, 0x01, 0xf7].forEach((byte, i) => parser.feed(byte, i));
  assert.deepEqual(messages, [[2, 0xf8], [4, 0xfe]]); assert.deepEqual(sysex, [[7, 4, 0x7e, 0x01]]);
  sysex.length = 0;
  for (const inner of [SYSEX_MAX - 2, SYSEX_MAX - 1]) {
    parser.feed(0xf0, 0);
    for (let i = 0; i < inner; i++) parser.feed(i & 0x7f, 0);
    parser.feed(0xf7, inner);
  }
  assert.deepEqual(sysex, [[SYSEX_MAX - 2, SYSEX_MAX - 2, 0, (SYSEX_MAX - 3) & 0x7f]], 'only the message within the limit arrives');
  // cancel ends a SysEx in progress and the running status as a status byte would.
  parser.feed(0x90, 0); parser.feed(60, 0); parser.feed(1, 0); parser.feed(0xf0, 1); parser.feed(0x7e, 1);
  parser.cancel(); parser.feed(0xf7, 2); parser.feed(61, 3); parser.feed(1, 3);
  assert.deepEqual(sysex.length, 1); assert.deepEqual(messages.at(-1), [0, 0x90]);
});
test('MidiStream turns each SysEx into a sysex event F0 .. F7, the resets included', () => {
  const stream = new MidiStream();
  assert.deepEqual(stream.events([0x90, 60, 100, ...GS_RESET.slice(0, 5)], 1), [on(1, 60, 0, 100)]);
  assert.deepEqual(stream.events([...GS_RESET.slice(5), 0xf8, ...master(100)], 2),
    [{ time: 2, type: 'sysex', data: Uint8Array.from(GS_RESET) }, { time: 2, type: 'sysex', data: Uint8Array.from(master(100)) }]);
  assert.equal(isResetMessage(Uint8Array.from(GS_RESET), 0, GS_RESET.length), true);
  assert.equal(isReset(Uint8Array.of(0x7e, 0x10, 0x09, 0x03)), true, 'GM2 System On, as profile_sysex_is_reset');
  assert.equal(isResetMessage(Uint8Array.from(master(1)), 0, 8), false);
});
test('a sysex event is validated before it is queued, and a rejected batch queues nothing', async () => {
  const payloads: Uint8Array[] = [];
  assert.deepEqual(packEvent({ time: 1, type: 'sysex', data: GM_ON }, 48000, payloads), [48000, OP.sysex, 0, 0, 0]);
  assert.deepEqual([...payloads[0]!], GM_ON);
  assert.throws(() => packEvent({ time: 0, type: 'sysex', data: GM_ON }, 48000), TypeError, 'a sysex event needs the payload list');
  const s = await sines();
  try {
    for (const data of [[0xf0], [0x7e, 0x7f, 0xf7], [0xf0, 0x80, 0xf7], [0xf0, 0x7e], [0xf0, 256, 0xf7], Array.from({ length: SYSEX_MAX + 1 }, () => 0)]) {
      assert.throws(() => s.schedule([on(0, 60), { time: 0, type: 'sysex', data }]), RangeError);
    }
    assert.throws(() => s.schedule([{ time: 0, type: 'sysex', data: 'F0F7' as never }]), TypeError);
    assert.equal(s.session.stats().queuedEvents, 0);
    assert.throws(() => s.session.schedule([[0, OP.sysex, 0, 0, 0]]), RangeError, 'a sysex event without its payload');
    assert.throws(() => s.session.schedule([[0, OP.sysex, 0, 0, 0]], [Uint8Array.of(0xf0, 0x80, 0xf7)]), RangeError);
    assert.equal(s.session.stats().queuedEvents, 0);
  } finally { s.close(); }
});
test('the queue stores SysEx payloads in one buffer: out of order, compacted, grown, reused', () => {
  const q = new EventQueue(16), scratch = new Int32Array(4);
  const message = (length: number, fill: number) => { const m = new Uint8Array(length).fill(fill); m[0] = 0xf0; m[length - 1] = 0xf7; return m; };
  /** The next event: its operation, then for a sysex event its message's first data byte and length, else its operands. */
  const take = () => { q.pop(scratch); return scratch[0] === OP.sysex ? [OP.sysex, q.payload[scratch[1]! + 1], scratch[2]] : [scratch[0], scratch[1], scratch[2]]; };
  q.pushBatch([[10, OP.sysex, 0, 0, 0], [5, OP.sysex, 1, 0, 0], [7, OP.noteOn, 0, 60, 1]], [message(40000, 1), message(20000, 2)]);
  const first = q.payload;
  assert.equal(first.length, 65536); assert.equal(q.sysexBytes, 60000);
  assert.deepEqual(take(), [OP.sysex, 2, 20000], 'frame 5 leaves first');
  // 60,000 bytes stored, 40,000 live: the next 20,000 fit only after the live message moves to the front.
  q.pushBatch([[1, OP.sysex, 0, 0, 0]], [message(20000, 3)]);
  assert.equal(q.payload, first, 'compacted in place');
  q.pushBatch([[2, OP.sysex, 0, 0, 0]], [message(20000, 4)]);
  assert.notEqual(q.payload, first); assert.equal(q.payload.length, 131072, 'grown to twice the size');
  assert.deepEqual([take(), take(), take(), take()], [[OP.sysex, 3, 20000], [OP.sysex, 4, 20000], [OP.noteOn, 0, 60], [OP.sysex, 1, 40000]]);
  const grown = q.payload;
  for (let round = 0; round < 100; round++) { q.pushBatch([[round, OP.sysex, 0, 0, 0]], [message(30000, 5)]); assert.deepEqual(take(), [OP.sysex, 5, 30000]); }
  assert.equal(q.payload, grown, 'an emptied store starts again at its front: steady scheduling does not allocate');
  const big = message(SYSEX_MAX, 6), queue = new EventQueue(512);
  queue.pushBatch(Array.from({ length: 256 }, (_, i) => [i, OP.sysex, 0, 0, 0] as PackedEvent), [big]);
  assert.equal(queue.sysexBytes, MAX_QUEUED_SYSEX_BYTES);
  assert.throws(() => queue.pushBatch([[0, OP.noteOn, 0, 60, 1], [0, OP.sysex, 0, 0, 0]], [message(2, 0)]), /SysEx queue full/);
  assert.equal(queue.size, 256); queue.clear(); assert.equal(queue.sysexBytes, 0);
});
test('SoundFont engine: GM Master Volume scales as channel volume does; the resets restore it and end the voices', async () => {
  const s = await sines();
  const level = (events: TimedEvent[]) => {
    const t = s.session.frame / 48000;
    s.schedule([{ time: t, type: 'reset' }, ...events.map(e => ({ ...e, time: t })), on(t, 60)]);
    s.render(2400); return peak(s.render(4800).left);
  };
  try {
    // TinySoundFont keeps the volume's low 7 bits at 127 (its reset sets 16383), so controller 7 at 64 is level 8319.
    const full = level([]), half = level([{ time: 0, type: 'controlChange', channel: 0, controller: 7, value: 64 }, { time: 0, type: 'sysex', data: master(127, 127) }]);
    const viaMaster = level([{ time: 0, type: 'controlChange', channel: 0, controller: 7, value: 127 }, { time: 0, type: 'sysex', data: master(64, 127) }]);
    assert.ok(half < full * 0.5); assert.ok(Math.abs(viaMaster / half - 1) < 1e-3, `master volume 64: ${viaMaster}, channel volume 64: ${half}`);
    for (const reset of [GM_ON, GS_RESET, XG_ON, [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7]]) {
      s.schedule([{ time: s.session.frame / 48000, type: 'sysex', data: master(0) }]); s.render(128);
      s.sendMidi(reset, s.session.frame / 48000); s.render(4800);
      assert.equal(s.engine.voices(), 0, 'the reset ends every voice');
      s.schedule([on(s.session.frame / 48000, 60)]); s.render(2400);
      assert.ok(Math.abs(peak(s.render(4800).left) / full - 1) < 0.01, 'and returns the master volume to full');
    }
  } finally { s.close(); }
});
test('SysEx acts at its frame: a file seeks and replays its SysEx, and render blocks on the 64-frame grid give the same PCM', async () => {
  // Master volume 64 at 0, a note at 0.5 s (192 ticks at 96 per quarter and 250,000 us).
  const file = smf(0, 96, [[[0, 0xff, 0x51, 3, 0x03, 0xd0, 0x90], sysexEvent(0, 0xf0, master(64).slice(1)), [192, 0x90, 60, 127]]], 192);
  const a = await sines(), b = await sines();
  try {
    a.engine.loadMidi(file); a.engine.play(); const played = peak(a.render(48000).left.slice(26000));
    a.engine.seek(0.25); a.engine.play(); const sought = peak(a.render(36000).left.slice(14000));
    b.engine.loadMidi(file); b.engine.play(); b.render(48000);
    b.schedule([{ time: b.session.frame / 48000, type: 'sysex', data: master(127, 127) }]); b.render(128);
    b.engine.seek(0.25); b.engine.play();
    const unchanged = peak(b.render(36000).left.slice(14000));
    assert.ok(Math.abs(sought / played - 1) < 1e-3, 'the chased master volume holds after the seek');
    assert.ok(Math.abs(unchanged / played - 1) < 1e-3, 'seek replays the file SysEx over a live one');
    // In file order: a later master volume overrides an earlier one, also after a seek (an MT-32 file's timbre
    // uploads, then its program changes, rely on the order).
    const ordered = (first: number, second: number) => smf(0, 96, [[[0, 0xff, 0x51, 3, 0x03, 0xd0, 0x90], sysexEvent(0, 0xf0, master(first).slice(1)),
      sysexEvent(48, 0xf0, master(second).slice(1)), [144, 0x90, 60, 127]]], 192);
    const after = (file: Uint8Array) => { a.engine.loadMidi(file); a.engine.seek(0.25); a.engine.play(); return peak(a.render(36000).left.slice(14000)); };
    assert.ok(Math.abs(after(ordered(127, 64)) / played - 1) < 1e-3); assert.ok(after(ordered(64, 127)) > played * 4);
  } finally { a.close(); b.close(); }
  const whole = await sines(), parts = await sines();
  try {
    const events: TimedEvent[] = [on(0, 60), { time: 1001 / 48000, type: 'sysex', data: master(90, 3) }, { time: 3001 / 48000, type: 'sysex', data: master(30) }];
    whole.schedule(events); parts.schedule(events);
    const one = whole.render(8192).left, split = new Float32Array(8192);
    for (let at = 0, n = 0; at < split.length; n++) { const size = Math.min([64, 192, 4096, 128][n % 4]!, split.length - at); split.set(parts.render(size).left, at); at += size; }
    assert.equal(hash(split), hash(one));
    assert.ok(peak(one.subarray(3001, 4001)) < peak(one.subarray(2001, 3001)) / 4, 'the level drops at its frame');
  } finally { whole.close(); parts.close(); }
});
// Review finding of 2026-11-25 (measured: 4 million tiny SysEx in a 16 MiB file kept about 1 GB): a file may hold at
// most MAX_FILE_SYSEX system exclusive messages; one more is a RangeError, not a parse that exhausts memory.
test('a MIDI file with more than MAX_FILE_SYSEX system exclusive messages is rejected', () => {
  const file = (count: number) => {
    const events = new Uint8Array(count * 5);
    for (let i = 0; i < count; i++) events.set([0, 0xf0, 2, 0x7d, 0xf7], i * 5);
    const end = [0, 0xff, 0x2f, 0], length = events.length + end.length;
    return Uint8Array.from([...Buffer.from('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, ...Buffer.from('MTrk'), length >>> 24, length >>> 16 & 255, length >>> 8 & 255, length & 255, ...events, ...end]);
  };
  assert.equal(parseSong(file(MAX_FILE_SYSEX)).sysex.size, MAX_FILE_SYSEX);
  assert.throws(() => parseSong(file(MAX_FILE_SYSEX + 1)), /more than 65536 system exclusive messages/);
});

// Review finding of 2026-11-25: a seek or engine switch replayed every earlier non-note message, which the Sound Canvas
// cores take at 3,125 bytes per second. The replay sends each channel's final state and every message whose effect
// depends on its order (SysEx, resets, bank select, RPN/NRPN, data entry, channel mode).
test('chase sends the last program, bend, pressure and controller value per channel, and every order-bound message', () => {
  const m = (status: number, d1 = 0, d2 = 0) => status | d1 << 8 | d2 << 16;
  const messages = Uint32Array.of(m(0xb0, 7, 10), m(0xb0, 0, 1), m(0xc0, 5), m(0xb0, 0, 2), m(0xb0, 7, 100), m(0x90, 60, 100),
    SYSEX_STATUS, m(0xb1, 7, 50), m(0xe0, 0, 10), m(0xe0, 0, 90), m(0xb0, 101, 0), m(0xb0, 6, 12), m(0xd0, 3), m(0xd0, 9));
  assert.deepEqual([...chaseMask(messages, messages.length)], [0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1]);
  assert.deepEqual([...chaseMask(messages, 5)], [0, 1, 1, 1, 1], 'only what precedes the position counts');
});
test('a seek into a file of superseded controller changes sounds as one into the file of its final state', async () => {
  // 300 volume and pan changes, then the values that stand, a program and a note at 1 s; the same file without the 300.
  const noise: number[][] = [];
  for (let i = 0; i < 300; i++) noise.push([0, 0xb0, i % 2 ? 7 : 10, (i * 37) % 128]);
  const final = [[0, 0xb0, 7, 100], [0, 0xb0, 10, 20], [0, 0xc0, 40], [192, 0x90, 60, 110], [96, 0x80, 60, 0]];
  const long = smf(0, 96, [[...noise, ...final]], 96), short = smf(0, 96, [final], 96);
  for (const engine of ['soundfont', 'sb16-opl3'] as const) {
    const pcm = async (file: Uint8Array) => {
      const s = await OfflineSynth.create({ baseUrl: new URL('../dist/', import.meta.url), engine });
      try { s.loadMidi(file); s.engine.seek(0.9); s.play(); return createHash('sha256').update(s.render(24000).left).digest('hex'); }
      finally { s.close(); }
    };
    assert.equal(await pcm(long), await pcm(short), engine);
  }
});
