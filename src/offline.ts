import { bankBytes, FM_WASM_ASSET, readBytes, SOUNDFONT_ASSET, soundFontBytes, WASM_ASSET, type BankSource, type SoundFontSource } from './assets.ts';
import { Engine, SYNTH_IMPORTS } from './engine.ts';
import { MidiStream } from './parser.ts';
import { RenderSession } from './session.ts';
import { engineKind, integer, normalizeOptions, packEvent, type EngineKind, type EngineOptions, type MidiLoadOptions, type PlaybackInfo, type ProgressListener, type SynthInfo, type TimedEvent } from './types.ts';
import { FmVoices, SoundFontVoices } from './voices.ts';
export type { EngineOptions, EngineKind, FmInfo, LoadProgress, ProgressListener, MidiLoadOptions, TimedEvent, PackedEvent, SynthEvent, SynthInfo, Preset, PlaybackInfo, RenderStats } from './types.ts';
export type { SoundFontSource, BankSource } from './assets.ts';
export interface StereoPcm { sampleRate: number; left: Float32Array; right: Float32Array }
export interface OfflineOptions extends EngineOptions {
  /** Directory containing assets/. Defaults beside the installed JS. */
  baseUrl?: string | URL;
  queueCapacity?: number;
  /** SoundFont 2 bytes or URL; defaults to the bundled TimGM6mb.sf2. */
  soundfont?: SoundFontSource;
  /** Hears each download and decompression of the files this synthesizer loads. */
  onProgress?: ProgressListener;
}

/** Faster-than-real-time rendering in Node.js, Bun or a browser with the same WASM, engine and scheduler. */
/** The frames a 16-bit stereo WAV file holds: its data size field is 32 bits. */
const MAX_WAV_FRAMES = Math.floor((0xffffffff - 36) / 4);

export class OfflineSynth {
  readonly session: RenderSession;
  private readonly stream = new MidiStream();
  /** Engines being loaded, so concurrent useEngine calls share one load. VERIFIED: without it the second call's add
   *  threw 'already loaded'. */
  private readonly loading = new Map<EngineKind, Promise<void>>();
  private constructor(readonly engine: Engine, capacity: number, private readonly base: URL, private readonly soundfont?: SoundFontSource, private readonly onProgress?: ProgressListener) {
    this.session = new RenderSession(engine, capacity);
  }
  static async create(options: OfflineOptions = {}): Promise<OfflineSynth> {
    const settings = normalizeOptions(options);
    const capacity = integer(options.queueCapacity ?? 8192, 1, 1048576, 'queueCapacity');
    const base = options.baseUrl ? new URL(options.baseUrl, import.meta.url) : new URL('./', import.meta.url);
    const voices = await OfflineSynth.voices(settings.engine, settings, base, options.soundfont, options.onProgress);
    return new OfflineSynth(new Engine(voices, settings), capacity, base, options.soundfont, options.onProgress);
  }
  private static async voices(kind: EngineKind, settings: Required<EngineOptions>, base: URL, soundfont?: SoundFontSource, onProgress?: ProgressListener): Promise<SoundFontVoices | FmVoices> {
    if (kind === 'fm') {
      const { instance } = await WebAssembly.instantiate(await readBytes(new URL(FM_WASM_ASSET, base), undefined, onProgress) as Uint8Array<ArrayBuffer>, SYNTH_IMPORTS);
      return new FmVoices(instance, settings);
    }
    const [wasm, font] = await Promise.all([readBytes(new URL(WASM_ASSET, base), undefined, onProgress), soundFontBytes(soundfont, base, SOUNDFONT_ASSET, undefined, onProgress)]);
    const { instance } = await WebAssembly.instantiate(wasm as Uint8Array<ArrayBuffer>, SYNTH_IMPORTS);
    return new SoundFontVoices(instance, font, settings);
  }
  get info(): SynthInfo { return this.engine.info(); }
  /** Makes kind's engine play, loading it first when needed; a loaded file plays on and scheduled events are cleared,
   *  as in the browser. */
  async useEngine(kind: EngineKind): Promise<SynthInfo> {
    engineKind(kind);
    if (!this.engine.has(kind)) {
      let load = this.loading.get(kind);
      if (!load) {
        load = OfflineSynth.voices(kind, this.engine.options, this.base, this.soundfont, this.onProgress)
          .then(voices => this.engine.add(voices)).finally(() => this.loading.delete(kind));
        this.loading.set(kind, load);
      }
      await load;
    }
    this.session.clear();
    this.engine.use(kind);
    return this.engine.info();
  }
  /** Replaces the SoundFont engine's SoundFont with SF2 bytes or a URL relative to baseUrl, plain or Brotli-compressed;
   *  scheduled events are cleared. Without the SoundFont engine it rejects before reading the file. */
  async loadSoundFont(source: SoundFontSource): Promise<SynthInfo> {
    if (!this.engine.has('soundfont')) throw new Error('The soundfont engine is not loaded');
    const bytes = await soundFontBytes(source, this.base, SOUNDFONT_ASSET, undefined, this.onProgress);
    this.session.clear();
    this.engine.loadSoundFont(bytes); return this.engine.info();
  }
  /** Selects the FM engine's embedded bank (0 to 78, numbered as libADLMIDI's banks.ini). */
  setFmBank(bank: number): SynthInfo { this.engine.setFmBank(bank); return this.engine.info(); }
  /** Replaces the FM engine's instruments with a WOPL bank file (bytes, or a URL relative to baseUrl). */
  async loadFmBank(source: BankSource): Promise<SynthInfo> { this.engine.loadFmBank(await bankBytes(source, this.base, undefined, this.onProgress)); return this.engine.info(); }
  schedule(events: readonly TimedEvent[]): void {
    this.session.schedule(events.map(event => packEvent(event, this.engine.options.sampleRate)));
  }
  /** Schedules the messages of a MIDI byte stream at time (seconds); running status carries over between calls. */
  sendMidi(bytes: ArrayLike<number>, time: number): void { this.schedule(this.stream.events(bytes, time)); }
  /** Loads a Standard MIDI, RMI or MUS file for playback from its start; options.tempo scales its clock. Scheduled
   *  events are cleared, as in the browser. */
  loadMidi(data: Uint8Array | ArrayBuffer, options: MidiLoadOptions = {}): PlaybackInfo {
    this.session.clear();
    return this.engine.loadMidi(data instanceof ArrayBuffer ? new Uint8Array(data) : data, options);
  }
  /** Plays the loaded file from its position as the following renders advance; loop restarts it at its end. */
  play(loop = false): void { this.engine.play(loop); }
  /** Allocating convenience method, up to the frames a WAV file holds. Use renderInto for repeated streaming blocks. */
  render(frames: number): StereoPcm {
    integer(frames, 0, MAX_WAV_FRAMES, 'frames');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.renderInto(left, right); return { sampleRate: this.engine.options.sampleRate, left, right };
  }
  renderInto(left: Float32Array, right: Float32Array): void { this.session.process(left, right); }
  close(): void { this.session.clear(); this.engine.close(); }
}

/** Encode signed 16-bit stereo RIFF/WAVE. Inputs remain untouched. */
export function encodeWav(pcm: StereoPcm): Uint8Array {
  integer(pcm.sampleRate, 8000, 192000, 'sampleRate');
  if (pcm.left.length !== pcm.right.length) throw new RangeError('Stereo lengths differ');
  integer(pcm.left.length, 0, MAX_WAV_FRAMES, 'WAV frames');
  const size = pcm.left.length * 4, bytes = new Uint8Array(44 + size), v = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, pcm.sampleRate, true); v.setUint32(28, pcm.sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, size, true);
  for (let i = 0; i < pcm.left.length; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const sample = ch ? pcm.right[i]! : pcm.left[i]!;
      if (!Number.isFinite(sample)) throw new RangeError('PCM contains a non-finite sample');
      const clamped = Math.max(-1, Math.min(1, sample));
      v.setInt16(44 + i * 4 + ch * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
    }
  }
  return bytes;
}
