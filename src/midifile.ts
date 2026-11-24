import { isReset, MIDI_RESET, packMessage, dataBytes } from './parser.ts';

/** A parsed song: each message (packed as packMessage does, or MIDI_RESET) with its time in seconds, in play order. */
export interface Song { title: string; duration: number; times: Float64Array; messages: Uint32Array }

class Reader {
  constructor(readonly bytes: Uint8Array, public at: number, readonly end: number, readonly label: string) {}
  need(n: number): void { if (this.at + n > this.end) throw new Error(`Truncated ${this.label}`); }
  u8(): number { this.need(1); return this.bytes[this.at++]!; }
  u16be(): number { this.need(2); const v = this.bytes[this.at]! << 8 | this.bytes[this.at + 1]!; this.at += 2; return v; }
  u16le(): number { this.need(2); const v = this.bytes[this.at]! | this.bytes[this.at + 1]! << 8; this.at += 2; return v; }
  u32be(): number { this.need(4); const v = (this.bytes[this.at]! << 24 | this.bytes[this.at + 1]! << 16 | this.bytes[this.at + 2]! << 8 | this.bytes[this.at + 3]!) >>> 0; this.at += 4; return v; }
  /** A variable-length quantity of at most four bytes (Standard MIDI Files 1.0). */
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error(`Malformed ${this.label}: variable-length quantity over four bytes`);
  }
  text(n: number): string { this.need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.at + i]!); this.at += n; return s; }
}

const ascii = (bytes: Uint8Array, at: number, text: string) => text.split('').every((c, i) => bytes[at + i] === c.charCodeAt(0));

/** Parses a Standard MIDI File (format 0 or 1), an RMI file (RIFF RMID around one) or a MUS file. Throws an Error that
 *  names the problem for any other or malformed input. */
export function parseSong(bytes: Uint8Array): Song {
  if (ascii(bytes, 0, 'MThd')) return parseSmf(bytes);
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'RMID')) return parseSmf(rmiData(bytes));
  if (ascii(bytes, 0, 'MUS\x1a')) return parseMus(bytes);
  throw new Error('Unsupported file format: expected a MIDI (MThd), RMI (RIFF RMID) or MUS header');
}

function rmiData(bytes: Uint8Array): Uint8Array {
  const r = new Reader(bytes, 12, bytes.length, 'RMI file');
  while (r.at + 8 <= r.end) {
    const id = r.text(4), size = r.u16le() + r.u16le() * 65536;
    r.need(size);
    if (id === 'data') return bytes.subarray(r.at, r.at + size);
    r.at += size + (size & 1);
  }
  throw new Error('Malformed RMI file: no data chunk');
}

/** A track event in tick order: a tempo change (microseconds per quarter note, 0 for a message) or a message. */
interface Entry { tick: number; track: number; order: number; tempo: number; message: number }

function parseSmf(bytes: Uint8Array): Song {
  const r = new Reader(bytes, 0, bytes.length, 'MIDI header');
  r.at = 4;
  const headerLength = r.u32be();
  if (headerLength < 6) throw new Error('Malformed MIDI header');
  const format = r.u16be(), tracks = r.u16be(), division = r.u16be();
  if (format > 1) throw new Error(`Unsupported MIDI format ${format}: formats 0 and 1 play`);
  if (!tracks) throw new Error('Malformed MIDI header: no tracks');
  let secondsPerTick: ((tempo: number) => number);
  if (division & 0x8000) {
    const fps = 256 - (division >> 8), perFrame = division & 0xff;
    if (![24, 25, 29, 30].includes(fps) || !perFrame) throw new Error('Malformed MIDI header: SMPTE division');
    const rate = (fps === 29 ? 29.97 : fps) * perFrame;
    secondsPerTick = () => 1 / rate;
  } else {
    if (!division) throw new Error('Malformed MIDI header: zero ticks per quarter note');
    secondsPerTick = tempo => tempo / 1e6 / division;
  }
  r.at = 8 + headerLength;
  const entries: Entry[] = [];
  let title = '', endTick = 0, track = 0, order = 0;
  while (track < tracks && r.at + 8 <= bytes.length) {
    const id = r.text(4), length = r.u32be();
    if (id !== 'MTrk') { r.need(length); r.at += length; continue; }
    const t = new Reader(bytes, r.at, Math.min(bytes.length, r.at + length), 'MIDI track');
    r.at = t.end;
    let tick = 0, status = 0;
    while (t.at < t.end) {
      tick += t.vlq();
      let byte = t.u8();
      if (byte === 0xff) {
        const type = t.u8(), size = t.vlq();
        t.need(size);
        if (type === 0x2f) { t.at += size; break; }
        if (type === 0x51 && size === 3) {
          const tempo = t.u8() << 16 | t.u8() << 8 | t.u8();
          if (tempo) entries.push({ tick, track, order: order++, tempo, message: 0 });
        }
        else if (type === 0x03 && track === 0 && !title) title = t.text(size).split(String.fromCharCode(0))[0]!.trimEnd();
        else t.at += size;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        const size = t.vlq();
        t.need(size);
        let data = t.bytes.subarray(t.at, t.at + size);
        t.at += size;
        if (byte === 0xf0 && data[data.length - 1] === 0xf7) data = data.subarray(0, data.length - 1);
        if (byte === 0xf0 && isReset(data)) entries.push({ tick, track, order: order++, tempo: 0, message: MIDI_RESET });
        continue;
      }
      if (byte & 0x80) {
        if (byte >= 0xf0) throw new Error(`Malformed MIDI track: status ${byte.toString(16)}h`);
        status = byte;
        byte = t.u8();
      } else if (!status) throw new Error('Malformed MIDI track: data byte without a status');
      const data2 = dataBytes(status) === 2 ? t.u8() & 0x7f : 0;
      entries.push({ tick, track, order: order++, tempo: 0, message: packMessage(status, byte & 0x7f, data2) });
    }
    endTick = Math.max(endTick, tick);
    track++;
  }
  if (!track) throw new Error('Malformed MIDI file: no MTrk chunk');
  entries.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const times: number[] = [], messages: number[] = [];
  let tempo = 500000, lastTick = 0, seconds = 0;
  for (const entry of entries) {
    seconds += (entry.tick - lastTick) * secondsPerTick(tempo);
    lastTick = entry.tick;
    if (entry.tempo) tempo = entry.tempo;
    else { times.push(seconds); messages.push(entry.message); }
  }
  const duration = seconds + Math.max(0, endTick - lastTick) * secondsPerTick(tempo);
  return { title, duration, times: Float64Array.from(times), messages: Uint32Array.from(messages) };
}

/* MUS controllers 1 to 9 as MIDI controllers (bank select, modulation, volume, pan, expression, reverb, chorus,
 * sustain, soft pedal); 0 is the program change. System events 10 to 14 are the channel mode messages. */
const MUS_CONTROLLERS = [0, 0, 1, 7, 10, 11, 91, 93, 64, 67];
const MUS_SYSTEM: Record<number, number> = { 10: 120, 11: 123, 12: 126, 13: 127, 14: 121 };
/** MUS's clock: 140 ticks per second. */
const MUS_RATE = 140;

function parseMus(bytes: Uint8Array): Song {
  const h = new Reader(bytes, 4, bytes.length, 'MUS header');
  const length = h.u16le(), start = h.u16le();
  const r = new Reader(bytes, start, Math.min(bytes.length, start + length), 'MUS score');
  const velocity = Array.from({ length: 16 }, () => 127);
  const times: number[] = [], messages: number[] = [];
  let tick = 0;
  for (;;) {
    const event = r.u8(), kind = event >> 4 & 7, mus = event & 15;
    const channel = mus === 15 ? 9 : mus >= 9 ? mus + 1 : mus;
    const push = (status: number, d1 = 0, d2 = 0) => { times.push(tick / MUS_RATE); messages.push(packMessage(status | channel, d1, d2)); };
    if (kind === 6) break;
    switch (kind) {
      case 0: push(0x80, r.u8() & 0x7f); break;
      case 1: {
        const note = r.u8();
        if (note & 0x80) velocity[channel] = r.u8() & 0x7f;
        push(0x90, note & 0x7f, velocity[channel]); break;
      }
      case 2: { const bend = r.u8() * 64; push(0xe0, bend & 0x7f, bend >> 7); break; }
      case 3: { const mode = MUS_SYSTEM[r.u8()]; if (mode !== undefined) push(0xb0, mode, 0); break; }
      case 4: {
        const controller = r.u8(), value = Math.min(127, r.u8());
        if (controller === 0) push(0xc0, value);
        else if (controller < MUS_CONTROLLERS.length) push(0xb0, MUS_CONTROLLERS[controller]!, value);
        break;
      }
      case 5: break;
      default: throw new Error(`Malformed MUS score: event type ${kind}`);
    }
    if (event & 0x80) {
      let delay = 0, byte;
      do { byte = r.u8(); delay = delay * 128 + (byte & 0x7f); } while (byte & 0x80);
      tick += delay;
    }
  }
  return { title: '', duration: tick / MUS_RATE, times: Float64Array.from(times), messages: Uint32Array.from(messages) };
}
