import { moduleKey, nativePart } from './profile-assets.ts';
import { NativeProfileVoices, instantiateProfile } from './profile-voices.ts';
import { isNativeProfile, isSynthProfile, selectEngine, withProfileSources, type SynthProfile, type ProfileSources, type ProfileSourceMap } from './profiles.ts';
import type { Voices } from './voices.ts';
export { SYNTH_PROFILES, PROFILE_DESCRIPTORS } from './profiles.ts';
export { createProfileStore, openProfileStore } from './profile-store.ts';
export type { ProfileStore, ProfileStorage, ProfileStorageFile, StoredProfileSources } from './profile-store.ts';
export type { SynthProfile, ProfileSourceMap, ProfileSources, ProfileDescriptor, ProfileAvailability, ProfileUserAssets } from './profiles.ts';
import { bankBytes, readBytes, SOUNDFONT_ASSET, soundFontBytes, type BankSource, type SoundFontSource } from './assets.ts';
import { Engine, SYNTH_IMPORTS } from './engine.ts';
import { MidiStream } from './parser.ts';
import { RenderSession } from './session.ts';
import { engineKind, integer, normalizeOptions, packEvent, type EngineKind, type EngineOptions, type MidiLoadOptions, type PlaybackInfo, type ProgressListener, type SynthInfo, type TimedEvent } from './types.ts';
import { FmVoices, SoundFontVoices } from './voices.ts';
export type { EngineOptions, EngineKind, FmInfo, LoadProgress, ProgressListener, MidiLoadOptions, TimedEvent, PackedEvent, SynthEvent, SynthInfo, Preset, PlaybackInfo, RenderStats } from './types.ts';
export type { SoundFontSource, BankSource } from './assets.ts';
export interface StereoPcm { sampleRate: number; left: Float32Array; right: Float32Array }
export interface OfflineOptions extends EngineOptions {
  profile?: SynthProfile;
  profileSources?: ProfileSourceMap;
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

/** Loads the engines of one OfflineSynth: each module is read and compiled once (moduleKey: 'fm' and 'sb16-opl3'
 *  share fm-synth.wasm), the SoundFont and a profile's pack with each engine. */
class EngineLoader {
  private readonly modules = new Map<string, Promise<WebAssembly.Module>>();
  constructor(readonly settings: Required<EngineOptions>, readonly base: URL, readonly soundfont?: SoundFontSource, readonly onProgress?: ProgressListener, public sources?: ProfileSourceMap) {}
  /** The compiled module of a built-in engine; a failed read or compile is tried again next time. */
  private module(kind: 'soundfont' | 'fm' | 'sb16-opl3'): Promise<WebAssembly.Module> {
    const key = moduleKey(kind);
    let module = this.modules.get(key);
    if (!module) {
      module = readBytes(new URL(key, this.base), undefined, this.onProgress).then(bytes => WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>));
      this.modules.set(key, module);
      module.catch(() => this.modules.delete(key));
    }
    return module;
  }
  /** kind's voices; an FM engine (fm, sb16-opl3, sb16-cqm) starts on the embedded bank fmBank gives once it has
   *  loaded, so a bank selected while it loaded is the one it plays, as in the worklet. */
  async voices(kind: EngineKind, fmBank = (): number => this.settings.fmBank): Promise<Voices> {
    const { settings } = this;
    if (isNativeProfile(kind)) {
      const part = await nativePart(kind, this.base, this.sources, true, undefined, this.onProgress);
      return new NativeProfileVoices(kind, instantiateProfile(part.module!), new Uint8Array(part.assets), settings.sampleRate, fmBank());
    }
    if (kind === 'fm' || kind === 'sb16-opl3') {
      const instance = await WebAssembly.instantiate(await this.module(kind), SYNTH_IMPORTS);
      return new FmVoices(instance, { ...settings, fmBank: fmBank() }, kind);
    }
    const [module, font] = await Promise.all([this.module('soundfont'), soundFontBytes(this.soundfont, this.base, SOUNDFONT_ASSET, undefined, this.onProgress)]);
    return new SoundFontVoices(await WebAssembly.instantiate(module, SYNTH_IMPORTS), font, settings);
  }
}

export class OfflineSynth {
  readonly session: RenderSession;
  private readonly stream = new MidiStream();
  /** Engines being loaded, so concurrent useEngine calls share one load. VERIFIED: without it the second call's add
   *  threw 'already loaded'. */
  private readonly loading = new Map<EngineKind, Promise<void>>();
  private constructor(readonly engine: Engine, capacity: number, private readonly loader: EngineLoader) {
    this.session = new RenderSession(engine, capacity);
  }
  static async create(options: OfflineOptions = {}): Promise<OfflineSynth> {
    const settings = normalizeOptions({ ...options, engine: selectEngine(options.engine, options.profile) });
    const capacity = integer(options.queueCapacity ?? 8192, 1, 1048576, 'queueCapacity');
    const base = options.baseUrl ? new URL(options.baseUrl, import.meta.url) : new URL('./', import.meta.url);
    const loader = new EngineLoader(settings, base, options.soundfont, options.onProgress, options.profileSources);
    return new OfflineSynth(new Engine(await loader.voices(settings.engine), settings), capacity, loader);
  }
  get info(): SynthInfo { return this.engine.info(); }
  /** Makes a hardware profile play (SYNTH_PROFILES; the legacy 'fm' engine is not one), as useEngine does. A profile
   *  that is not available rejects with an Error naming it, and the engine that played plays on. sources (a native
   *  profile's pack or module, as in profileSources) join that profile's profileSources: an unloaded profile loads with
   *  them, a loaded one loads again with them in its place (a file plays on), and a pack or module its core rejects
   *  leaves the loaded one. A profile still loading rejects them. */
  async useProfile(profile: SynthProfile, sources?: ProfileSources): Promise<SynthInfo> {
    if (!isSynthProfile(profile)) throw new RangeError('Unknown synth profile');
    if (sources) {
      const previous = this.loader.sources;
      this.loader.sources = withProfileSources(this.loader.sources, profile, sources, this.loading.has(profile));
      if (this.engine.has(profile)) {
        // Loaded: the profile loads again on the new sources in place of the loaded engine, as in the browser.
        const load = this.loader.voices(profile, () => this.engine.fmBank()).then(voices => this.engine.add(voices, true))
          .finally(() => this.loading.delete(profile));
        this.loading.set(profile, load);
        try { await load; } catch (error) { this.loader.sources = previous; throw error; }
      }
    }
    return this.useEngine(profile);
  }
  /** Makes kind's engine play, loading it first when needed; a loaded file plays on and scheduled events are cleared,
   *  as in the browser. */
  async useEngine(kind: EngineKind): Promise<SynthInfo> {
    engineKind(kind);
    if (!this.engine.has(kind)) {
      let load = this.loading.get(kind);
      if (!load) {
        load = this.loader.voices(kind, () => this.engine.fmBank()).then(voices => this.engine.add(voices)).finally(() => this.loading.delete(kind));
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
    const bytes = await soundFontBytes(source, this.loader.base, SOUNDFONT_ASSET, undefined, this.loader.onProgress);
    this.session.clear();
    this.engine.loadSoundFont(bytes); return this.engine.info();
  }
  /** Selects the embedded bank (0 to 78, numbered as libADLMIDI's banks.ini) of every loaded FM engine: fm, sb16-opl3
   *  and sb16-cqm. */
  setFmBank(bank: number): SynthInfo { this.engine.setFmBank(bank); return this.engine.info(); }
  /** Replaces the instruments of every loaded FM engine (fm, sb16-opl3, sb16-cqm) with a WOPL bank file (bytes, or a
   *  URL relative to baseUrl). */
  async loadFmBank(source: BankSource): Promise<SynthInfo> { this.engine.loadFmBank(await bankBytes(source, this.loader.base, undefined, this.loader.onProgress)); return this.engine.info(); }
  /** Schedules a batch atomically, as in the browser; a sysex event carries one message F0 through F7. */
  schedule(events: readonly TimedEvent[]): void {
    const payloads: Uint8Array[] = [];
    this.session.schedule(events.map(event => packEvent(event, this.engine.options.sampleRate, payloads)), payloads);
  }
  /** Schedules the messages of a MIDI byte stream at time (seconds), system exclusive ones included; running status
   *  carries over between calls. */
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
  /** MIDI and SysEx the active engine's input could not take since it loaded, as MidiSynth's status().dropped. */
  get dropped(): number { return this.engine.dropped(); }
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
