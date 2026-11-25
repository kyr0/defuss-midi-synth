import { isSynthProfile, type SynthProfile } from './profiles.ts';
export type { SynthProfile } from './profiles.ts';
/** The two synthesizers: TinySoundFont with a General MIDI SoundFont, or libADLMIDI on emulated OPL3 FM chips. */
export type EngineKind = SynthProfile | 'fm';
export interface EngineOptions {
  sampleRate?: number;
  /** SoundFont engine: voices preallocated; beyond them a new note steals the voice furthest into its release. */
  maxVoices?: number;
  /** The engine that plays at start; default 'soundfont'. */
  engine?: EngineKind;
  /** FM engine: emulated OPL3 chips, 18 two-operator voices each (1 to 8); default 2. */
  chips?: number;
  /** FM engine: the embedded instrument bank, numbered as libADLMIDI's banks.ini (0 to 78); default 0. */
  fmBank?: number;
}
export type SynthEvent =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number }
  | { type: 'controlChange'; channel: number; controller: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'channelPressure'; channel: number; value: number }
  | { type: 'polyPressure'; channel: number; note: number; value: number }
  /** Any preset of the SoundFont on any channel, also a drum kit of bank 128 outside channel 10. */
  | { type: 'preset'; channel: number; bank: number; program: number }
  /** Every channel back to its General MIDI state (the GM, GS and XG reset messages do this too). */
  | { type: 'reset' }
  /** One system exclusive message, F0 through F7 (at most SYSEX_MAX bytes, data bytes below 80h). Each engine applies
   *  what it knows and ignores the rest: the GM, GM2, GS and XG resets on every engine, GM Master Volume on the
   *  SoundFont and FM engines, libADLMIDI's GS and XG messages on the FM engine, the native core's own on a profile. */
  | { type: 'sysex'; data: Uint8Array | readonly number[] };
/** Time is absolute AudioContext time in the browser, seconds from zero offline. */
export type TimedEvent = SynthEvent & { time: number };
/** Fixed-width protocol: output frame, operation, three integer operands. A sysex event's first operand indexes the
 *  batch's payloads (packEvent), the other two are 0. */
export type PackedEvent = [number, number, number, number, number];
/** One preset of the loaded SoundFont: bank 0 holds the General MIDI programs, bank 128 the drum kits. */
export interface Preset { bank: number; program: number; name: string }
/** The FM engine's embedded banks (index = bank number), the selected bank (-1: a loaded WOPL file) and its chips. */
export interface FmInfo { banks: string[]; bank: number; chips: number }
/** engine names the active synthesizer; presets are what selectPreset accepts on it. fm is set once the FM engine
 *  is loaded. */
export interface SynthInfo { engine: string; kind: EngineKind; profile?: SynthProfile; engines: EngineKind[]; sampleRate: number; maxVoices: number; presets: Preset[]; fm?: FmInfo }
/** rate is the file's playback rate: 2 plays it twice as fast, at the same pitch. */
/** How a file loads. tempo scales the file's own clock: 0.5 plays it at half the tempo its header and tempo events
 *  state, for files converted at a wrong clock (Raptor's MUS music ran at 70 Hz, and MIDI files converted from it at
 *  Doom's 140 Hz play twice too fast), or a MUS file of such a game. Positions, seeking and the duration then count
 *  real seconds. 0.25 to 4, default 1. */
export interface MidiLoadOptions { tempo?: number }
/** Progress of loading a file: its download, then, for a Brotli-compressed one, its decompression (loaded counts the
 *  compressed bytes consumed). total is 0 while a server sends no length. url names the file. */
export interface LoadProgress { phase: 'download' | 'decompress'; url: string; loaded: number; total: number }
export type ProgressListener = (progress: LoadProgress) => void;
export interface PlaybackInfo { title: string; duration: number; position: number; ended: boolean; rate: number }
export interface RenderStats { frame: number; queuedEvents: number; lateEvents: number }

/** Operation codes of PackedEvent, shared by the queue and the engine. */
export const OP = { noteOn: 0, noteOff: 1, controlChange: 2, programChange: 3, pitchBend: 4, channelPressure: 5,
  polyPressure: 6, preset: 7, reset: 8, sysex: 9 } as const;
export const OP_COUNT = 10;
/** The longest system exclusive message, F0 through F7: native/profiles/profile_pack.h PROFILE_SYSEX_MAX. VERIFIED:
 *  tests/core.test.ts drops a longer message whole and tests/native-profile-abi.test.ts checks the cores' bound. */
export const SYSEX_MAX = 65536;
/** The largest operand: a 14-bit pitch bend or bank number. */
export const OPERAND_MAX = 16383;
/** The largest MIDI, RMI or MUS file the package accepts. */
export const MAX_SONG_BYTES = 16 * 1024 * 1024;
/** The largest SoundFont the package accepts; TinySoundFont holds its samples as 32-bit floats, twice the file. */
export const MAX_SOUNDFONT_BYTES = 256 * 1024 * 1024;
/** The largest WOPL bank file the package accepts; a bank of 256 instrument sets is about 2 MB. */
export const MAX_BANK_BYTES = 8 * 1024 * 1024;
/** The FM engine's embedded banks (banks.ini) and chip limit. */
export const FM_BANKS = 79;
export const MAX_CHIPS = 8;

/** Validate before crossing the worklet boundary; reject instead of silently wrapping. */
export function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}
export function finite(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
export function normalizeOptions(options: EngineOptions = {}): Required<EngineOptions> {
  return {
    sampleRate: integer(options.sampleRate ?? 48000, 8000, 192000, 'sampleRate'),
    maxVoices: integer(options.maxVoices ?? 256, 1, 4096, 'maxVoices'),
    engine: engineKind(options.engine ?? 'soundfont'),
    chips: integer(options.chips ?? 2, 1, MAX_CHIPS, 'chips'),
    fmBank: integer(options.fmBank ?? 0, 0, FM_BANKS - 1, 'fmBank'),
  };
}
export function engineKind(kind: unknown): EngineKind {
  if (kind !== 'fm' && !isSynthProfile(kind)) throw new RangeError('Unknown synthesizer engine');
  return kind;
}
/** Whether length bytes of bytes from offset are one system exclusive message: F0, data bytes below 80h, F7, at most
 *  SYSEX_MAX bytes (profile_pack.h profile_sysex_valid). */
export function isSysEx(bytes: ArrayLike<number>, offset = 0, length = bytes.length - offset): boolean {
  if (!Number.isSafeInteger(length) || length < 2 || length > SYSEX_MAX || bytes[offset] !== 0xf0 || bytes[offset + length - 1] !== 0xf7) return false;
  for (let i = offset + 1; i < offset + length - 1; i++) { const b = bytes[i]!; if (!Number.isInteger(b) || b < 0 || b > 0x7f) return false; }
  return true;
}
/** A copy of data as one validated system exclusive message; a RangeError names what is wrong. */
export function sysexBytes(data: Uint8Array | ArrayLike<number>): Uint8Array {
  if (!(data instanceof Uint8Array) && !Array.isArray(data)) throw new TypeError('SysEx data must be a Uint8Array or an array of bytes');
  if (!isSysEx(data)) throw new RangeError(`SysEx data must be one message F0 .. F7 of 2 to ${SYSEX_MAX} bytes with data bytes below 80h`);
  return Uint8Array.from(data);
}
/** The packed form of event at sampleRate. A sysex event's message goes to payloads, which the packed event indexes;
 *  without payloads it is a TypeError. */
export function packEvent(event: TimedEvent, sampleRate: number, payloads?: Uint8Array[]): PackedEvent {
  const frame = integer(Math.round(finite(event.time, 0, Number.MAX_SAFE_INTEGER / sampleRate, 'event time') * sampleRate), 0, Number.MAX_SAFE_INTEGER, 'frame');
  if (event.type === 'reset') return [frame, OP.reset, 0, 0, 0];
  if (event.type === 'sysex') {
    if (!payloads) throw new TypeError('A sysex event needs a payload list');
    return [frame, OP.sysex, payloads.push(sysexBytes(event.data)) - 1, 0, 0];
  }
  const ch = integer(event.channel, 0, 15, 'channel');
  switch (event.type) {
    case 'noteOn': return [frame, OP.noteOn, ch, integer(event.note, 0, 127, 'note'), integer(event.velocity, 0, 127, 'velocity')];
    case 'noteOff': return [frame, OP.noteOff, ch, integer(event.note, 0, 127, 'note'), 0];
    case 'controlChange': return [frame, OP.controlChange, ch, integer(event.controller, 0, 127, 'controller'), integer(event.value, 0, 127, 'value')];
    case 'programChange': return [frame, OP.programChange, ch, integer(event.program, 0, 127, 'program'), 0];
    case 'pitchBend': return [frame, OP.pitchBend, ch, integer(event.value, 0, 16383, 'pitch bend'), 0];
    case 'channelPressure': return [frame, OP.channelPressure, ch, integer(event.value, 0, 127, 'pressure'), 0];
    case 'polyPressure': return [frame, OP.polyPressure, ch, integer(event.note, 0, 127, 'note'), integer(event.value, 0, 127, 'pressure')];
    case 'preset': return [frame, OP.preset, ch, integer(event.bank, 0, OPERAND_MAX, 'bank'), integer(event.program, 0, 127, 'program')];
    default: throw new TypeError('Unknown event type');
  }
}
/** Bytes from a Uint8Array or ArrayBuffer, between 1 and max bytes long. */
export function inputBytes(data: Uint8Array | ArrayBuffer, max: number, label: string): Uint8Array {
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new TypeError(`${label} must be a Uint8Array or ArrayBuffer`);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  integer(bytes.byteLength, 1, max, label);
  return bytes;
}
