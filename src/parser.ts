import { integer, type TimedEvent } from './types.ts';

/** The status the synthesizer takes as a reset to the General MIDI state (native/synth.c, synth_message 0xFF). */
export const MIDI_RESET = 0xff;

/** Packs a channel message for the synthesizer: status, data 1 << 8, data 2 << 16. */
export function packMessage(status: number, data1 = 0, data2 = 0): number {
  return (status | data1 << 8 | data2 << 16) >>> 0;
}

/** The data bytes after a channel status byte: one for program change (Cn) and channel pressure (Dn), else two. */
export function dataBytes(status: number): number {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

/* System exclusive messages that reset a synthesizer to the General MIDI state, without F0 and F7: GM System On,
 * Roland's GS reset, Yamaha's XG System On; -1 matches any device number. */
const RESETS: readonly (readonly number[])[] = [
  [0x7e, -1, 0x09, 0x01],
  [0x41, -1, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41],
  [0x43, -1, 0x4c, 0x00, 0x00, 0x7e, 0x00],
];

/** Whether bytes (a system exclusive message without F0 and F7) reset a synthesizer to General MIDI. */
export function isReset(bytes: Uint8Array): boolean {
  return RESETS.some(known => known.length === bytes.length && known.every((value, i) => value < 0 || value === bytes[i]));
}

/**
 * The parser of a MIDI byte stream (MIDI 1.0 Detailed Specification): a channel status byte (80h-EFh) starts a message
 * and becomes the running status, so further data bytes form further messages of it; a real-time byte (F8h-FFh) is a
 * message of its own and leaves a message in progress whole; F0h starts and F7h ends a system exclusive message (any
 * other status byte ends it too); F1h-F6h are system common messages, which end the running status; a data byte
 * without a status is ignored. message receives each channel message and each real-time byte, sysex the bytes of each
 * system exclusive message between F0h and F7h (at most 65,536 are kept).
 */
export class MidiParser {
  private status = 0;
  private readonly data = [0, 0];
  private have = 0;
  private skip = 0;
  private sysexBytes: number[] | null = null;

  constructor(private readonly message: (time: number, status: number, data1: number, data2: number) => void,
              private readonly sysex: (time: number, bytes: Uint8Array) => void = () => undefined) {}

  /** Takes byte, which arrived at time. */
  feed(byte: number, time: number): void {
    if (byte >= 0xf8) {
      this.message(time, byte, 0, 0);
      return;
    }
    if (byte & 0x80) {
      if (this.sysexBytes) {
        const bytes = Uint8Array.from(this.sysexBytes);
        this.sysexBytes = null;
        if (byte === 0xf7) {
          this.sysex(time, bytes);
          return;
        }
      }
      this.have = 0;
      this.skip = 0;
      if (byte < 0xf0) {
        this.status = byte;
        return;
      }
      this.status = 0;
      if (byte === 0xf0) this.sysexBytes = [];
      else if (byte === 0xf1 || byte === 0xf3) this.skip = 1;
      else if (byte === 0xf2) this.skip = 2;
      return;
    }
    if (this.sysexBytes) {
      if (this.sysexBytes.length < 65536) this.sysexBytes.push(byte);
      return;
    }
    if (this.skip) {
      this.skip--;
      return;
    }
    if (!this.status) return;
    this.data[this.have++] = byte;
    const needed = dataBytes(this.status);
    if (this.have === needed) {
      this.have = 0;
      this.message(time, this.status, this.data[0]!, needed === 2 ? this.data[1]! : 0);
    }
  }
}

/** The typed event of a parsed message at time: a channel message, or a reset for System Reset (FFh); null for the
 *  other real-time messages, which a synthesizer ignores. */
export function messageEvent(time: number, status: number, data1: number, data2: number): TimedEvent | null {
  const channel = status & 0x0f;
  switch (status & 0xf0) {
    case 0x80: return { time, type: 'noteOff', channel, note: data1 };
    case 0x90: return { time, type: 'noteOn', channel, note: data1, velocity: data2 };
    case 0xa0: return { time, type: 'polyPressure', channel, note: data1, value: data2 };
    case 0xb0: return { time, type: 'controlChange', channel, controller: data1, value: data2 };
    case 0xc0: return { time, type: 'programChange', channel, program: data1 };
    case 0xd0: return { time, type: 'channelPressure', channel, value: data1 };
    case 0xe0: return { time, type: 'pitchBend', channel, value: data1 | data2 << 7 };
    default: return status === 0xff ? { time, type: 'reset' } : null;
  }
}

/** A MIDI byte stream as timed events: running status carries over between calls, as on a MIDI cable; the GM, GS
 *  and XG reset messages and System Reset become reset events; other system messages are dropped. */
export class MidiStream {
  private out: TimedEvent[] = [];
  private readonly parser = new MidiParser(
    (time, status, data1, data2) => { const event = messageEvent(time, status, data1, data2); if (event) this.out.push(event); },
    (time, bytes) => { if (isReset(bytes)) this.out.push({ time, type: 'reset' }); });

  /** The events that bytes (each an integer from 0 to 255) complete, all at time. */
  events(bytes: ArrayLike<number>, time: number): TimedEvent[] {
    for (let i = 0; i < bytes.length; i++) this.parser.feed(integer(bytes[i]!, 0, 255, 'MIDI byte'), time);
    const out = this.out;
    this.out = [];
    return out;
  }
}
