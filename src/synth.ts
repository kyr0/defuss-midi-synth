import { nativePart, type NativePart } from './profile-assets.ts';
import { isNativeProfile, selectEngine, type SynthProfile, type ProfileSourceMap } from './profiles.ts';
import { bankBytes, FM_WASM_ASSET, readBytes, SOUNDFONT_ASSET, soundFontBytes, WASM_ASSET, type BankSource, type SoundFontSource } from './assets.ts';
import { MidiStream } from './parser.ts';
import { engineKind, finite, inputBytes, integer, MAX_SONG_BYTES, normalizeOptions, OPERAND_MAX, packEvent, type EngineKind, type EngineOptions, type MidiLoadOptions, type PlaybackInfo, type ProgressListener, type RenderStats, type SynthEvent, type SynthInfo, type TimedEvent } from './types.ts';

export interface SynthOptions extends Omit<EngineOptions, 'sampleRate'> {
  profile?: SynthProfile;
  profileSources?: ProfileSourceMap;
  context?: AudioContext;
  /** Directory containing worklet.js and assets/. Defaults beside the installed JS. */
  baseUrl?: string | URL;
  /** SoundFont 2 bytes or URL (relative to baseUrl) for the soundfont engine; defaults to the bundled TimGM6mb.sf2. */
  soundfont?: SoundFontSource;
  /** Hears each download and decompression of the files this synthesizer loads: modules, SoundFonts, banks. */
  onProgress?: ProgressListener;
  /** Connect to context.destination automatically; disable for custom graphs. */
  connect?: boolean;
  gain?: number;
  queueCapacity?: number;
  timeoutMs?: number;
}
/** An engine's module, with the SoundFont for the soundfont engine, as the worklet takes it: compiled in the
 *  processor's options, as bytes in a later message. Chrome delivers a WebAssembly.Module in processorOptions but not
 *  through the node's port (the processor never receives that message). */
type EnginePart = NativePart | { kind: 'soundfont' | 'fm' | 'sb16-opl3'; module?: WebAssembly.Module; wasm?: ArrayBuffer; soundfont?: ArrayBuffer };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
/** File transport, scheduler counters and the voices sounding now. */
export type SynthStatus = PlaybackInfo & RenderStats & { voices: number };

/** Browser facade. Call create/resume from a user gesture to satisfy autoplay policy. */
export class MidiSynth {
  readonly output: GainNode;
  /** The synthesizer's signal before output's gain, for meters and visualizers that should not follow the volume. */
  get source(): AudioNode { return this.node; }
  private current: SynthInfo;
  private readonly pending = new Map<number, Pending>();
  private readonly stream = new MidiStream();
  private nextId = 1;
  private disposed = false;
  private failure?: Error;
  private disposeTask?: Promise<void>;
  /** Engines being fetched and added, so concurrent useEngine calls share one load. */
  private readonly loading = new Map<EngineKind, Promise<void>>();
  private constructor(readonly context: AudioContext, private readonly node: AudioWorkletNode, info: SynthInfo,
    private readonly base: URL, private readonly owned: boolean, private readonly timeout: number, private readonly options: SynthOptions) {
    this.current = info;
    this.output = context.createGain(); this.output.gain.value = options.gain ?? 1;
    node.connect(this.output); if (options.connect !== false) this.output.connect(context.destination);
    node.port.onmessage = event => {
      const msg = event.data;
      if (msg.type === 'fatal') { this.fail(new Error(msg.error)); return; }
      const pending = this.pending.get(msg.id);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(msg.id); if (msg.error) pending.reject(new Error(msg.error)); else pending.resolve(msg.result); }
    };
    node.onprocessorerror = () => this.fail(new Error('AudioWorklet processor failed'));
  }
  static async create(options: SynthOptions = {}): Promise<MidiSynth> {
    finite(options.gain ?? 1, 0, 4, 'gain');
    const timeout = integer(options.timeoutMs ?? 15000, 100, 120000, 'timeoutMs');
    const capacity = integer(options.queueCapacity ?? 8192, 1, 1048576, 'queueCapacity');
    const owned = !options.context;
    const context = options.context ?? new AudioContext({ latencyHint: 'interactive' });
    let node: AudioWorkletNode | undefined;
    try {
      const settings = normalizeOptions({ ...options, engine: selectEngine(options.engine, options.profile), sampleRate: context.sampleRate });
      const base = options.baseUrl ? new URL(options.baseUrl, import.meta.url) : new URL('./', import.meta.url);
      const [part] = await Promise.all([MidiSynth.part(settings.engine, base, options.soundfont, timeout, true, options.onProgress, options.profileSources), context.audioWorklet.addModule(new URL('worklet.js', base))]);
      node = new AudioWorkletNode(context, 'defuss-midi-synth', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { part, settings, capacity },
      });
      const worklet = node;
      const info = await new Promise<SynthInfo>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('AudioWorklet initialization timed out')), timeout);
        worklet.onprocessorerror = () => { clearTimeout(timer); reject(new Error('AudioWorklet initialization failed')); };
        worklet.port.onmessage = event => {
          if (event.data.type === 'ready') { clearTimeout(timer); resolve(event.data.info); }
          else if (event.data.type === 'fatal') { clearTimeout(timer); reject(new Error(event.data.error)); }
        };
      });
      return new MidiSynth(context, worklet, info, base, owned, timeout, options);
    } catch (error) {
      if (node) { node.port.postMessage({ id: 0, method: 'dispose', args: [] }); node.disconnect(); node.port.close(); }
      if (owned && context.state !== 'closed') await context.close();
      throw error;
    }
  }
  /** Fetches kind's module, with the SoundFont for the soundfont engine, and compiles it off the audio thread when
   *  compile is true. Structured cloning copies the buffers into the audio thread; slices keep a caller's untouched. */
  private static async part(kind: EngineKind, base: URL, soundfont: SoundFontSource | undefined, timeout: number, compile: boolean, onProgress?: ProgressListener, sources?: ProfileSourceMap): Promise<EnginePart> {
    if (isNativeProfile(kind)) return nativePart(kind, base, sources, compile, timeout, onProgress);
    const [wasm, font] = await Promise.all([readBytes(new URL(kind === 'fm' || kind === 'sb16-opl3' ? FM_WASM_ASSET : WASM_ASSET, base), timeout, onProgress),
      kind === 'soundfont' ? soundFontBytes(soundfont, base, SOUNDFONT_ASSET, timeout, onProgress) : undefined]);
    const copy = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const part: Extract<EnginePart, { kind: 'soundfont' | 'fm' | 'sb16-opl3' }> = compile ? { kind, module: await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>) } : { kind, wasm: copy(wasm) };
    if (font) part.soundfont = copy(font);
    return part;
  }
  /** The active engine, the loaded engines, sample rate, voice limit, the presets selectPreset takes, and the FM
   *  engine's banks once it is loaded. */
  get info(): SynthInfo { return this.current; }
  useProfile(profile: SynthProfile): Promise<SynthInfo> { return this.useEngine(profile); }
  private fail(error: Error): void {
    this.failure = error; this.node.disconnect();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  private request<T = void>(method: string, args: unknown[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Synth is disposed'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 1024) return Promise.reject(new Error('Too many pending commands'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Command timed out: ${method}`)); }, this.timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.node.port.postMessage({ id, method, args }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  /** Schedules a batch atomically. Resolve means accepted, not yet played. */
  schedule(events: readonly TimedEvent[]): Promise<void> {
    const packed = events.map(event => packEvent(event, this.context.sampleRate));
    return this.request('schedule', [packed]);
  }
  send(event: SynthEvent, time = this.context.currentTime): Promise<void> { return this.schedule([{ ...event, time }]); }
  noteOn(channel: number, note: number, velocity = 100, time?: number): Promise<void> { return this.send({ type: 'noteOn', channel, note, velocity }, time); }
  noteOff(channel: number, note: number, time?: number): Promise<void> { return this.send({ type: 'noteOff', channel, note }, time); }
  programChange(channel: number, program: number, time?: number): Promise<void> { return this.send({ type: 'programChange', channel, program }, time); }
  controlChange(channel: number, controller: number, value: number, time?: number): Promise<void> { return this.send({ type: 'controlChange', channel, controller, value }, time); }
  pitchBend(channel: number, value: number, time?: number): Promise<void> { return this.send({ type: 'pitchBend', channel, value }, time); }
  /** Selects a preset of info.presets on a channel; a pair the SoundFont lacks is a RangeError. */
  selectPreset(channel: number, bank: number, program: number, time?: number): Promise<void> {
    integer(bank, 0, OPERAND_MAX, 'bank'); integer(program, 0, 127, 'program');
    if (!this.current.presets.some(p => p.bank === bank && p.program === program)) throw new RangeError(`The ${this.current.kind} engine has no preset ${bank}:${program}`);
    if (this.current.kind !== 'soundfont' && bank === 128 && channel !== 9) throw new RangeError('FM percussion plays on channel 10 (channel index 9)');
    return this.send({ type: 'preset', channel, bank, program }, time);
  }
  /** Returns every channel to its General MIDI state. */
  reset(time?: number): Promise<void> { return this.send({ type: 'reset' }, time); }
  /** Schedules the messages of a MIDI byte stream (Web MIDI input, an emulated MPU-401) at time; running status
   *  carries over between calls. */
  sendMidi(bytes: ArrayLike<number>, time = this.context.currentTime): Promise<void> { return this.schedule(this.stream.events(bytes, time)); }
  clearScheduled(): Promise<void> { return this.request('clear'); }
  panic(): Promise<void> { return this.request('panic'); }
  /** Replaces the SoundFont (bytes, or a URL relative to baseUrl) and resolves with the new info. Clears queued events
   *  and, while the SoundFont engine plays, stops file playback; a rejected SoundFont keeps the loaded one. Without
   *  the SoundFont engine it rejects before downloading. */
  async loadSoundFont(source: SoundFontSource): Promise<SynthInfo> {
    if (this.disposed) throw new Error('Synth is disposed');
    if (!this.current.engines.includes('soundfont')) throw new Error('The soundfont engine is not loaded');
    const bytes = await soundFontBytes(source, this.base, SOUNDFONT_ASSET, this.timeout, this.options.onProgress);
    this.current = await this.request<SynthInfo>('loadSoundFont', [bytes]);
    return this.current;
  }
  /** Makes kind's engine play, fetching and compiling it first when needed, and resolves with the new info. A loaded
   *  file keeps its position and plays on; scheduled events are cleared. */
  async useEngine(kind: EngineKind): Promise<SynthInfo> {
    if (this.disposed) throw new Error('Synth is disposed');
    engineKind(kind);
    if (!this.current.engines.includes(kind)) {
      let load = this.loading.get(kind);
      if (!load) {
        load = (async () => {
          const part = await MidiSynth.part(kind, this.base, this.options.soundfont, this.timeout, false, this.options.onProgress, this.options.profileSources);
          this.current = await this.request<SynthInfo>('addEngine', [part]);
        })().finally(() => this.loading.delete(kind));
        this.loading.set(kind, load);
      }
      await load;
    }
    this.current = await this.request<SynthInfo>('useEngine', [kind]);
    return this.current;
  }
  /** Selects the FM engine's embedded bank (0 to 78, numbered as libADLMIDI's banks.ini); a playing file plays on
   *  with the new instruments. */
  async setFmBank(bank: number): Promise<SynthInfo> {
    integer(bank, 0, 78, 'FM bank');
    this.current = await this.request<SynthInfo>('setFmBank', [bank]);
    return this.current;
  }
  /** Replaces the FM engine's instruments with a WOPL bank file (bytes, or a URL relative to baseUrl); a rejected
   *  file keeps the bank. */
  async loadFmBank(source: BankSource): Promise<SynthInfo> {
    if (this.disposed) throw new Error('Synth is disposed');
    const bytes = await bankBytes(source, this.base, this.timeout, this.options.onProgress);
    this.current = await this.request<SynthInfo>('loadFmBank', [bytes]);
    return this.current;
  }
  /** Plays the loaded file at rate (0.25 to 4) times its tempo, at the same pitch. */
  setPlaybackRate(rate: number): Promise<void> { finite(rate, 0.25, 4, 'playback rate'); return this.request('rate', [rate]); }
  /** Parses a MIDI, RMI or MUS file and makes it the file to play; tempo scales its clock (see MidiLoadOptions). */
  loadMidi(data: Uint8Array | ArrayBuffer, options: MidiLoadOptions = {}): Promise<PlaybackInfo> {
    finite(options.tempo ?? 1, 0.25, 4, 'tempo');
    return this.request('loadMidi', [inputBytes(data, MAX_SONG_BYTES, 'file length'), { tempo: options.tempo ?? 1 }]);
  }
  play(loop = false): Promise<void> { return this.request('play', [loop]); }
  pause(): Promise<void> { return this.request('pause'); }
  stop(): Promise<void> { return this.request('stop'); }
  seek(seconds: number): Promise<void> { finite(seconds, 0, Number.MAX_SAFE_INTEGER, 'seek'); return this.request('seek', [seconds]); }
  status(): Promise<SynthStatus> { return this.request('status'); }
  setGain(value: number): void {
    if (this.disposed) throw new Error('Synth is disposed');
    finite(value, 0, 4, 'gain'); this.output.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
  async resume(): Promise<void> { if (this.disposed) throw new Error('Synth is disposed'); await this.context.resume(); }
  /** Repeated calls share cleanup; a caller-owned AudioContext is never closed. */
  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    const acknowledgement = this.request('dispose');
    this.disposed = true;
    this.disposeTask = (async () => {
      // VERIFIED: after a processor failure request() rejects at once, so the acknowledgement rejects; cleanup still
      // runs and dispose resolves, as README's 'idempotent cleanup' promises.
      try { await acknowledgement; }
      catch { /* nothing left to report: the instance is gone either way */ }
      finally {
        this.node.disconnect(); this.output.disconnect(); this.node.port.close();
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Synth is disposed')); }
        this.pending.clear();
        if (this.owned && this.context.state !== 'closed') await this.context.close();
      }
    })();
    return this.disposeTask;
  }
}
