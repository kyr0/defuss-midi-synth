import { isReset, MIDI_RESET, MidiParser, packMessage, dataBytes } from './parser.ts';
import { SYSEX_MAX, type MidiMetadata } from './types.ts';

/** The status of a song message that stands for the system exclusive message of its index in Song.sysex. */
export const SYSEX_STATUS = 0xf0;
/** The most system exclusive messages a file may hold. Each costs an object and a byte array, so a file of nothing but
 *  tiny ones (16 MiB holds 4 million) took about 1 GB on the audio thread; the music in docs/music holds at most 40, an
 *  MT-32 game's timbre upload a few hundred. */
export const MAX_FILE_SYSEX = 65536;
/** A parsed song: each message (packed as packMessage does, MIDI_RESET, or SYSEX_STATUS) with its time in seconds, in
 *  play order. sysex holds the system exclusive messages, F0 through F7, by the index of their message: SYSEX_STATUS,
 *  or MIDI_RESET for the GM, GM2, GS and XG resets, which every engine takes as a reset and a SysEx engine receives as
 *  they are. */
export interface Song { metadata?: MidiMetadata; title: string; duration: number; times: Float64Array; messages: Uint32Array; sysex: Map<number, Uint8Array> }

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

// TextDecoder is unavailable in some AudioWorklets. MIDI files use both UTF-8 and legacy single-byte text.
function metaText(reader: Reader, size: number): string {
  const length = Math.min(size, 2048);
  const raw = reader.text(length).split(String.fromCharCode(0))[0]!;
  reader.at += size - length;
  if (Array.from(raw).some(char => char.charCodeAt(0) > 127)) {
    const encoded = Array.from(raw, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    try { return decodeURIComponent(encoded).trim(); } catch { /* Legacy single-byte text. */ }
  }
  return raw.trim();
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

/** A track event in tick order: a tempo change (microseconds per quarter note, 0 for a message) or a message, with the
 *  bytes of a system exclusive one. */
interface Entry { tick: number; track: number; order: number; tempo: number; message: number; data?: Uint8Array }

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
  const metadata: MidiMetadata = { format, trackCount: tracks };
  const entries: Entry[] = [];
  let sysexCount = 0;
  let title = '', endTick = 0, track = 0, order = 0;
  while (track < tracks && r.at + 8 <= bytes.length) {
    const id = r.text(4), length = r.u32be();
    if (id !== 'MTrk') { r.need(length); r.at += length; continue; }
    const t = new Reader(bytes, r.at, Math.min(bytes.length, r.at + length), 'MIDI track');
    r.at = t.end;
    let tick = 0, status = 0;
    /* SysEx events as the bytes they transmit (Standard MIDI Files 1.0): F0 <length> <bytes after F0> sends F0 and the
     * bytes; F7 <length> <bytes> sends the bytes alone, continuing a SysEx that an F0 event left open (a divided SysEx)
     * or else as an escape, whose bytes a MIDI byte parser reads (a whole or divided SysEx, real-time or channel
     * messages). Real-time bytes inside a SysEx are messages of their own. An F0 SysEx without F7 that no F7 event
     * continues ends at the next channel event or the track's end, at its last packet's tick: writers that omit the F7
     * of each F0 event exist, and the parser before 0.4.0 took every F0 event as a whole message. */
    const sysex = (at: number, data: Uint8Array) => {
      if (++sysexCount > MAX_FILE_SYSEX) throw new RangeError(`MIDI file holds more than ${MAX_FILE_SYSEX} system exclusive messages`);
      entries.push({ tick: at, track, order: order++, tempo: 0, message: isReset(data.subarray(1, data.length - 1)) ? MIDI_RESET : SYSEX_STATUS, data });
    };
    const escape = new MidiParser((at, s, d1, d2) => {
      if (s === 0xff) entries.push({ tick: at, track, order: order++, tempo: 0, message: MIDI_RESET });
      else if (s < 0xf0) entries.push({ tick: at, track, order: order++, tempo: 0, message: packMessage(s, d1, d2) });
    }, (at, inner) => { const data = new Uint8Array(inner.length + 2); data[0] = 0xf0; data.set(inner, 1); data[inner.length + 1] = 0xf7; sysex(at, data); });
    let open: number[] | null = null, openTick = 0, overflow = false;
    const close = () => {
      if (open && !overflow) { open.push(0xf7); sysex(openTick, Uint8Array.from(open)); }
      open = null; overflow = false;
    };
    /** The bytes of an F0 event (after F0) or of an F7 event at tick. */
    const packet = (from: number, end: number, escaped: boolean) => {
      let i = from;
      for (; open && i < end; i++) {
        const b = t.bytes[i]!;
        if (b >= 0xf8) { if (b === 0xff) entries.push({ tick, track, order: order++, tempo: 0, message: MIDI_RESET }); continue; }
        if (b === 0xf7) { open.push(0xf7); if (!overflow) sysex(tick, Uint8Array.from(open)); open = null; overflow = false; i++; break; }
        if (b & 0x80) { open = null; overflow = false; break; } // another status ends it unfinished; the escape reads it
        if (open.length < SYSEX_MAX - 1) open.push(b); else overflow = true;
      }
      if (open) openTick = tick;
      else if (escaped || i < end) for (; i < end; i++) escape.feed(t.bytes[i]!, tick);
    };
    while (t.at < t.end) {
      tick += t.vlq();
      let byte = t.u8();
      if (byte === 0xff) {
        const type = t.u8();
        // Some XMI2MID conversions end the track with FF 2F FF 00 instead of FF 2F 00.
        if (type === 0x2f && t.at + 2 === t.end && t.bytes[t.at] === 0xff && t.bytes[t.at + 1] === 0) break;
        const size = t.vlq();
        t.need(size);
        if (type === 0x2f) { t.at += size; break; }
        if (type === 0x51 && size === 3) {
          const tempo = t.u8() << 16 | t.u8() << 8 | t.u8();
          if (tick === 0 && tempo) metadata.initialBpm = 60e6 / tempo;
          if (tempo) entries.push({ tick, track, order: order++, tempo, message: 0 });
        }
        else if (type === 0x03 && track === 0 && !title) title = metaText(t, size);
        else if (type === 0x02 && !metadata.copyright) metadata.copyright = metaText(t, size);
        else if (type === 0x01 && !metadata.text) metadata.text = metaText(t, size);
        else if (type === 0x58 && tick === 0 && size === 4) {
          const numerator = t.u8(), exponent = t.u8();
          if (numerator && exponent < 16) metadata.timeSignature = `${numerator}/${2 ** exponent}`;
          t.at += 2;
        }
        else t.at += size;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        const size = t.vlq();
        t.need(size);
        if (byte === 0xf0) { close(); escape.cancel(); open = [0xf0]; }
        packet(t.at, t.at + size, !open);
        t.at += size;
        continue;
      }
      if (byte & 0x80) {
        if (byte >= 0xf0) throw new Error(`Malformed MIDI track: status ${byte.toString(16)}h`);
        status = byte;
        byte = t.u8();
      } else if (!status) throw new Error('Malformed MIDI track: data byte without a status');
      close(); escape.cancel();
      const data2 = dataBytes(status) === 2 ? t.u8() & 0x7f : 0;
      entries.push({ tick, track, order: order++, tempo: 0, message: packMessage(status, byte & 0x7f, data2) });
    }
    close();
    endTick = Math.max(endTick, tick);
    track++;
  }
  if (!track) throw new Error('Malformed MIDI file: no MTrk chunk');
  entries.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const times: number[] = [], messages: number[] = [], sysex = new Map<number, Uint8Array>();
  let tempo = 500000, lastTick = 0, seconds = 0;
  for (const entry of entries) {
    seconds += (entry.tick - lastTick) * secondsPerTick(tempo);
    lastTick = entry.tick;
    if (entry.tempo) tempo = entry.tempo;
    else { if (entry.data) sysex.set(messages.length, entry.data); times.push(seconds); messages.push(entry.message); }
  }
  const duration = seconds + Math.max(0, endTick - lastTick) * secondsPerTick(tempo);
  return { title, duration, metadata, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex };
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
    // VERIFIED: a MUS delay has the encoding of a MIDI variable-length quantity (7 bits per byte, high bit continues);
    // over four bytes it is malformed rather than an endless song.
    if (event & 0x80) tick += r.vlq();
  }
  return { title: '', duration: tick / MUS_RATE, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex: new Map() };
}
