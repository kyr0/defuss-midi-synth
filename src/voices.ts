import { GM_PROGRAMS } from './gm.ts';
import { MIDI_RESET } from './parser.ts';
import { inputBytes, integer, MAX_BANK_BYTES, MAX_SOUNDFONT_BYTES, type EngineKind, type EngineOptions, type FmInfo, type Preset } from './types.ts';

/** The one import of both modules: the notice that their memory grew, which needs no answer, since a backend makes
 *  a new view whenever the memory's buffer changed. */
export const SYNTH_IMPORTS: WebAssembly.Imports = { env: { emscripten_notify_memory_growth: () => undefined } };
/** The most frames one native render call writes (native/synth.c SYNTH_BLOCK, native/fm.cpp FM_BLOCK). */
export const RENDER_BLOCK = 128;
export const SOUNDFONT_ENGINE = 'TinySoundFont 0.9';
export const FM_ENGINE = 'libADLMIDI 1.6.2, Nuked OPL3';
const DRUMS = 9;

/** A synthesizer the engine drives: complete MIDI channel messages in, planar Float32 PCM out. */
export interface Voices {
  readonly kind: EngineKind;
  readonly name: string;
  presets(): Preset[];
  /** The voices it can sound at once. */
  maxVoices(): number;
  /** Plays one channel message, or resets every channel to its General MIDI state for status FFh. */
  message(status: number, data1: number, data2: number): void;
  /** Selects bank and program on channel; false when the synthesizer has no such preset there. */
  setPreset(channel: number, bank: number, program: number): boolean;
  /** Writes n (at most RENDER_BLOCK) frames into left and right from at. */
  render(left: Float32Array, right: Float32Array, at: number, n: number): void;
  /** The voices sounding now. */
  voices(): number;
  close(): void;
}

/** Copies n planar frames (left block, then right block) from the module's memory at out into left and right. The
 *  view is made anew only when the memory grew, so a render quantum allocates nothing. */
class PlanarOutput {
  private view: Float32Array;
  constructor(private readonly memory: WebAssembly.Memory, private readonly out: number) {
    this.view = new Float32Array(memory.buffer, out, RENDER_BLOCK * 2);
  }
  copy(left: Float32Array, right: Float32Array, at: number, n: number, gain: number): void {
    if (this.view.buffer !== this.memory.buffer) this.view = new Float32Array(this.memory.buffer, this.out, RENDER_BLOCK * 2);
    const view = this.view;
    for (let i = 0; i < n; i++) { left[at + i] = view[i]! * gain; right[at + i] = view[n + i]! * gain; }
  }
}

function text(memory: WebAssembly.Memory, at: number, max: number): string {
  const heap = new Uint8Array(memory.buffer);
  let value = '';
  for (let p = at; heap[p] && value.length < max; p++) value += String.fromCharCode(heap[p]!);
  return value;
}

/** The exports of midi-synth.wasm (native/synth.c). */
export interface SoundFontExports {
  memory: WebAssembly.Memory;
  _initialize?(): void;
  synth_buffer(bytes: number): number;
  synth_load(data: number, bytes: number, rate: number, gainDb: number, maxVoices: number): number;
  synth_message(status: number, data1: number, data2: number): void;
  synth_set_preset(channel: number, bank: number, program: number): number;
  synth_render(frames: number): number;
  synth_voices(): number;
  synth_preset_count(): number;
  synth_preset_bank(index: number): number;
  synth_preset_program(index: number): number;
  synth_preset_name(index: number): number;
}

/** TinySoundFont with one SoundFont 2 file. */
export class SoundFontVoices implements Voices {
  readonly kind = 'soundfont';
  readonly name = SOUNDFONT_ENGINE;
  private readonly wasm: SoundFontExports;
  private readonly output: PlanarOutput;
  private list: Preset[] = [];
  constructor(instance: WebAssembly.Instance, soundfont: Uint8Array, private readonly options: Required<EngineOptions>) {
    this.wasm = instance.exports as unknown as SoundFontExports;
    this.wasm._initialize?.();
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.synth_render(0));
    this.load(soundfont);
  }
  /** Replaces the SoundFont; a rejected one leaves the loaded SoundFont in place (synth_load parses it first). */
  load(data: Uint8Array): void {
    const w = this.wasm, bytes = inputBytes(data, MAX_SOUNDFONT_BYTES, 'SoundFont length');
    const at = w.synth_buffer(bytes.byteLength);
    if (!at) throw new Error('SoundFont buffer allocation failed');
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.synth_load(at, bytes.byteLength, this.options.sampleRate, SOUNDFONT_GAIN_DB, this.options.maxVoices)) throw new Error('Invalid SoundFont: not an SF2 file, or out of memory');
    const presets: Preset[] = [];
    for (let i = 0, count = w.synth_preset_count(); i < count; i++) {
      presets.push({ bank: w.synth_preset_bank(i), program: w.synth_preset_program(i), name: text(w.memory, w.synth_preset_name(i), 20).trim() });
    }
    this.list = presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  }
  presets(): Preset[] { return this.list.map(p => ({ ...p })); }
  maxVoices(): number { return this.options.maxVoices; }
  message(status: number, data1: number, data2: number): void { this.wasm.synth_message(status, data1, data2); }
  setPreset(channel: number, bank: number, program: number): boolean { return this.wasm.synth_set_preset(channel, bank, program) === 1; }
  render(left: Float32Array, right: Float32Array, at: number, n: number): void {
    // TinySoundFont renders nothing while no voice sounds; zeros are cheaper than the call.
    if (!this.wasm.synth_voices()) { left.fill(0, at, at + n); right.fill(0, at, at + n); return; }
    this.wasm.synth_render(n);
    this.output.copy(left, right, at, n, 1);
  }
  voices(): number { return this.wasm.synth_voices(); }
  close(): void { /* the instance is released with the engine */ }
}

/** The exports of fm-synth.wasm (native/fm.cpp). */
export interface FmExports {
  memory: WebAssembly.Memory;
  _initialize?(): void;
  fm_init(rate: number, chips: number, bank: number): number;
  fm_set_bank(bank: number): number;
  fm_buffer(bytes: number): number;
  fm_load_bank(data: number, bytes: number): number;
  fm_message(status: number, data1: number, data2: number): void;
  fm_render(frames: number): number;
  fm_voices(): number;
  fm_chips(): number;
  fm_bank_count(): number;
  fm_bank_name(index: number): number;
}

/** The output levels of both engines. At 0 dB, TinySoundFont with TimGM6mb peaked above full scale on 6 of 8 game
 *  files of docs/music (up to 2.16 on Warcraft II's Human 1, 30 s each); at -6 dB the highest peak was 1.08. The FM
 *  gain makes the median RMS ratio of the two engines over the same files about 1 (FM peaks up to 0.94). */
export const SOUNDFONT_GAIN_DB = -6;
export const FM_GAIN = 2.5;

/** libADLMIDI on emulated OPL3 chips, with an embedded bank or a loaded WOPL bank file. */
export class FmVoices implements Voices {
  readonly kind = 'fm';
  readonly name = FM_ENGINE;
  private readonly wasm: FmExports;
  private readonly output: PlanarOutput;
  private readonly names: string[] = [];
  private current: number;
  constructor(instance: WebAssembly.Instance, options: Required<EngineOptions>) {
    this.wasm = instance.exports as unknown as FmExports;
    this.wasm._initialize?.();
    if (!this.wasm.fm_init(options.sampleRate, options.chips, options.fmBank)) throw new Error('The FM synthesizer rejected its settings');
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.fm_render(0));
    for (let i = 0, count = this.wasm.fm_bank_count(); i < count; i++) this.names.push(text(this.wasm.memory, this.wasm.fm_bank_name(i), 120));
    this.current = options.fmBank;
  }
  info(): FmInfo { return { banks: [...this.names], bank: this.current, chips: this.wasm.fm_chips() }; }
  /** Selects embedded bank (banks.ini's number); every voice ends. */
  setBank(bank: number): void {
    integer(bank, 0, this.names.length - 1, 'FM bank');
    if (!this.wasm.fm_set_bank(bank)) throw new Error(`The FM synthesizer rejected bank ${bank}`);
    this.current = bank;
  }
  /** Replaces the instruments with a WOPL bank file; a rejected file keeps the instruments. Every voice ends. */
  loadBank(data: Uint8Array): void {
    const w = this.wasm, bytes = inputBytes(data, MAX_BANK_BYTES, 'bank length');
    const at = w.fm_buffer(bytes.byteLength);
    if (!at) throw new Error('Bank buffer allocation failed');
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.fm_load_bank(at, bytes.byteLength)) throw new Error('Invalid FM bank: not a WOPL file');
    this.current = -1;
  }
  /** The General MIDI programs on bank 0 and the percussion of channel 10 as bank 128. */
  presets(): Preset[] {
    return [...GM_PROGRAMS.map((name, program) => ({ bank: 0, program, name })), { bank: 128, program: 0, name: 'Percussion' }];
  }
  maxVoices(): number { return this.wasm.fm_chips() * 18; }
  message(status: number, data1: number, data2: number): void { this.wasm.fm_message(status, data1, data2); }
  /** Bank 128 is the percussion, which plays on channel 10 only; other banks go out as bank select and program. */
  setPreset(channel: number, bank: number, program: number): boolean {
    if (bank === 128) {
      if (channel !== DRUMS) return false;
      this.wasm.fm_message(0xc0 | channel, program, 0);
      return true;
    }
    if (bank !== 0) return false;
    this.wasm.fm_message(0xb0 | channel, 0, 0);
    this.wasm.fm_message(0xb0 | channel, 32, 0);
    this.wasm.fm_message(0xc0 | channel, program, 0);
    return true;
  }
  render(left: Float32Array, right: Float32Array, at: number, n: number): void {
    this.wasm.fm_render(n);
    this.output.copy(left, right, at, n, FM_GAIN);
  }
  voices(): number { return this.wasm.fm_voices(); }
  close(): void { this.wasm.fm_message(MIDI_RESET & 0xff, 0, 0); }
}
