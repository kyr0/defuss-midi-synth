import type { TimedEvent } from '../src/types.ts';

/** Original synthetic material; no game music or commercial sound samples. */
export function score(): TimedEvent[] {
  const events: TimedEvent[] = [{ time: 0, type: 'programChange', channel: 0, program: 80 }];
  const notes = [60, 64, 67, 72, 71, 67, 64, 62, 57, 60, 64, 69, 67, 64, 62, 60];
  for (let i = 0; i < notes.length; i++) {
    events.push({ time: 0.05 + i * 0.25, type: 'noteOn', channel: 0, note: notes[i]!, velocity: 100 });
    events.push({ time: 0.25 + i * 0.25, type: 'noteOff', channel: 0, note: notes[i]! });
  }
  return events;
}

const vlq = (value: number) => { const out = [value & 0x7f]; while ((value >>= 7)) out.unshift(0x80 | (value & 0x7f)); return out; };
const u32 = (value: number) => [value >>> 24, value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff];
/** A Standard MIDI File of format and division with tracks given as [delta ticks, ...event bytes] rows; each
 *  track gets its End of Track after endDelta ticks. */
export function smf(format: number, division: number, tracks: number[][][], endDelta = 0): Uint8Array {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, division >> 8, division & 0xff];
  for (const rows of tracks) {
    const body = rows.flatMap(([delta, ...bytes]) => [...vlq(delta!), ...bytes]).concat([...vlq(endDelta), 0xff, 0x2f, 0]);
    out.push(0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body);
  }
  return Uint8Array.from(out);
}
/** Format-0 SMF: one quarter-note at 120 BPM (96 ticks per quarter, tempo 500,000 us), then End of Track: 0.5 s. */
export function midiFixture(): Uint8Array {
  const track = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0xc0, 80, 0, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
}
/** The SMF bytes inside a RIFF RMID file's data chunk. */
export function rmiFixture(midi: Uint8Array): Uint8Array {
  const le = (v: number) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24];
  const pad = midi.length & 1 ? [0] : [];
  const body = [0x52, 0x4d, 0x49, 0x44, 0x64, 0x61, 0x74, 0x61, ...le(midi.length), ...midi, ...pad];
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, ...le(body.length), ...body]);
}
/** Original MUS score: middle C for 70 ticks at the format's 140 Hz clock (0.5 s). */
export function musFixture(): Uint8Array {
  const song = [0x90, 60 | 0x80, 100, 70, 0x00, 60, 0x60];
  return Uint8Array.from([77, 85, 83, 26, song.length, 0, 16, 0, 1, 0, 0, 0, 0, 0, 0, 0, ...song]);
}

/**
 * A SoundFont 2 file (RIFF sfbk, SoundFont 2.04 specification) with two looped sine samples whose original key is
 * 60: "low" one cycle per 100 frames at 48 kHz (480 Hz), "high" one per 50 (960 Hz). Preset 0 of bank 0 plays low,
 * preset 1 of bank 0 and the drum kit (preset 0 of bank 128) play high. Written as the emulator's MIDI test writes it.
 */
export function soundfont(): Uint8Array {
  const text = (value: string, length: number) => Uint8Array.from({ length }, (_, i) => value.charCodeAt(i) || 0);
  const le = (bytes: number, value: number) => Uint8Array.from({ length: bytes }, (_, i) => (value >>> (8 * i)) & 0xff);
  const join = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const chunk = (id: string, body: Uint8Array) => join([text(id, 4), le(4, body.length), body, new Uint8Array(body.length & 1)]);
  const list = (id: string, kind: string, chunks: Uint8Array[]) => chunk(id, join([text(kind, 4), ...chunks]));
  const sine = (period: number) => Int16Array.from({ length: 1000 }, (_, i) => Math.round(Math.sin(2 * Math.PI * i / period) * 16000));
  const samples = [sine(100), sine(50)];
  const smpl = new Int16Array(samples.length * (1000 + 46));
  samples.forEach((sample, i) => smpl.set(sample, i * 1046));
  const shdr = (name: string, start: number) => join([text(name, 20), le(4, start), le(4, start + 1000), le(4, start),
    le(4, start + 1000), le(4, 48000), le(1, 60), le(1, 0), le(2, 0), le(2, 1)]);
  const gen = (operator: number, amount: number) => join([le(2, operator), le(2, amount)]);
  const bag = (generator: number) => join([le(2, generator), le(2, 0)]);
  const phdr = (name: string, preset: number, bank: number, bagIndex: number) =>
    join([text(name, 20), le(2, preset), le(2, bank), le(2, bagIndex), le(4, 0), le(4, 0), le(4, 0)]);
  const pdta = list('LIST', 'pdta', [
    chunk('phdr', join([phdr('Low', 0, 0, 0), phdr('High', 1, 0, 1), phdr('Drums', 0, 128, 2), phdr('EOP', 0, 0, 3)])),
    chunk('pbag', join([bag(0), bag(1), bag(2), bag(3)])),
    chunk('pmod', new Uint8Array(10)),
    chunk('pgen', join([gen(41, 0), gen(41, 1), gen(41, 1), gen(0, 0)])),
    chunk('inst', join([text('Low', 20), le(2, 0), text('High', 20), le(2, 1), text('EOI', 20), le(2, 2)])),
    chunk('ibag', join([bag(0), bag(2), bag(4)])),
    chunk('imod', new Uint8Array(10)),
    chunk('igen', join([gen(54, 1), gen(53, 0), gen(54, 1), gen(53, 1), gen(0, 0)])),
    chunk('shdr', join([shdr('low', 0), shdr('high', 1046), shdr('EOS', 0)])),
  ]);
  const sdta = list('LIST', 'sdta', [chunk('smpl', new Uint8Array(smpl.buffer))]);
  const info = list('LIST', 'INFO', [chunk('ifil', join([le(2, 2), le(2, 1)])), chunk('INAM', text('test', 6))]);
  return list('RIFF', 'sfbk', [info, sdta, pdta]);
}

/** The pitch of samples by their upward zero crossings, interpolated between frames. */
export function pitch(samples: Float32Array, rate = 48000): number {
  let first = -1, last = -1, cycles = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i]!, b = samples[i + 1]!;
    if (a < 0 && b >= 0) {
      const at = i - a / (b - a);
      if (first < 0) first = at; else cycles++;
      last = at;
    }
  }
  return cycles ? cycles * rate / (last - first) : 0;
}
