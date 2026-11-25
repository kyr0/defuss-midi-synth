import { M as MidiStream, f as finite, i as integer, n as normalizeOptions, s as selectEngine, r as readBytes, a as isNativeProfile, b as nativePart, F as FM_WASM_ASSET, W as WASM_ASSET, c as soundFontBytes, d as isSynthProfile, w as withProfileSources, p as packEvent, S as SOUNDFONT_ASSET, e as engineKind, g as bankBytes, h as inputBytes, m as moduleKey, O as OPERAND_MAX, j as MAX_SONG_BYTES } from './profile-store-CtY7XS1N.js';
export { G as GM_PROGRAMS, k as MidiParser, P as PROFILE_DESCRIPTORS, l as SYNTH_PROFILES, o as createProfileStore, q as isReset, t as openProfileStore } from './profile-store-CtY7XS1N.js';

class MidiSynth {
  constructor(context, node, info, base, owned, timeout, options) {
    this.context = context;
    this.node = node;
    this.base = base;
    this.owned = owned;
    this.timeout = timeout;
    this.options = options;
    this.current = info;
    this.sources = options.profileSources;
    this.output = context.createGain();
    this.output.gain.value = options.gain ?? 1;
    node.connect(this.output);
    if (options.connect !== false) this.output.connect(context.destination);
    node.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "fatal") {
        this.fail(new Error(msg.error));
        return;
      }
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
      }
    };
    node.onprocessorerror = () => this.fail(new Error("AudioWorklet processor failed"));
  }
  context;
  node;
  base;
  owned;
  timeout;
  options;
  output;
  /** The synthesizer's signal before output's gain, for meters and visualizers that should not follow the volume. */
  get source() {
    return this.node;
  }
  current;
  pending = /* @__PURE__ */ new Map();
  stream = new MidiStream();
  nextId = 1;
  disposed = false;
  failure;
  disposeTask;
  /** Engines being fetched and added, so concurrent useEngine calls share one load. */
  loading = /* @__PURE__ */ new Map();
  /** The modules the worklet holds or is being sent, by moduleKey: true once it holds one, so an engine on a module
   *  it holds ('fm' and 'sb16-opl3' share one) goes without its bytes and is not compiled again. */
  modules = /* @__PURE__ */ new Map();
  /** The native profiles' sources: the profileSources option, and those useProfile adds. */
  sources;
  static async create(options = {}) {
    finite(options.gain ?? 1, 0, 4, "gain");
    const timeout = integer(options.timeoutMs ?? 15e3, 100, 12e4, "timeoutMs");
    const capacity = integer(options.queueCapacity ?? 8192, 1, 1048576, "queueCapacity");
    const owned = !options.context;
    const context = options.context ?? new AudioContext({ latencyHint: "interactive" });
    let node;
    try {
      const settings = normalizeOptions({ ...options, engine: selectEngine(options.engine, options.profile), sampleRate: context.sampleRate });
      const base = options.baseUrl ? new URL(options.baseUrl, import.meta.url) : new URL("./", import.meta.url);
      const [part] = await Promise.all([MidiSynth.part(settings.engine, base, options.soundfont, timeout, true, options.onProgress, options.profileSources, true, options.readWasm), context.audioWorklet.addModule(new URL("worklet.js", base))]);
      node = new AudioWorkletNode(context, "defuss-midi-synth", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { part, settings, capacity }
      });
      const worklet = node;
      const info = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("AudioWorklet initialization timed out")), timeout);
        worklet.onprocessorerror = () => {
          clearTimeout(timer);
          reject(new Error("AudioWorklet initialization failed"));
        };
        worklet.port.onmessage = (event) => {
          if (event.data.type === "ready") {
            clearTimeout(timer);
            resolve(event.data.info);
          } else if (event.data.type === "fatal") {
            clearTimeout(timer);
            reject(new Error(event.data.error));
          }
        };
      });
      const synth = new MidiSynth(context, worklet, info, base, owned, timeout, options);
      synth.modules.set(part.key, Promise.resolve(true));
      return synth;
    } catch (error) {
      if (node) {
        node.port.postMessage({ id: 0, method: "dispose", args: [] });
        node.disconnect();
        node.port.close();
      }
      if (owned && context.state !== "closed") await context.close();
      throw error;
    }
  }
  /** Fetches kind's module (unless withWasm is false: the worklet holds it), with the SoundFont for the soundfont
   *  engine and the pack for a native profile, and compiles it off the audio thread when compile is true. Structured
   *  cloning copies the buffers into the audio thread; slices keep a caller's untouched. */
  static async part(kind, base, soundfont, timeout, compile, onProgress, sources, withWasm = true, readWasm = readBytes) {
    if (isNativeProfile(kind)) return nativePart(kind, base, sources, compile, timeout, onProgress, withWasm, readWasm);
    const [wasm, font] = await Promise.all([
      withWasm ? readWasm(new URL(kind === "fm" || kind === "sb16-opl3" ? FM_WASM_ASSET : WASM_ASSET, base), timeout, onProgress) : void 0,
      kind === "soundfont" ? soundFontBytes(soundfont, base, SOUNDFONT_ASSET, timeout, onProgress) : void 0
    ]);
    const copy = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const part = { kind, key: moduleKey(kind) };
    if (wasm) {
      if (compile) part.module = await WebAssembly.compile(wasm);
      else part.wasm = copy(wasm);
    }
    if (font) part.soundfont = copy(font);
    return part;
  }
  /** The active engine, the loaded engines, sample rate, voice limit, the presets selectPreset takes, and the FM
   *  engine's banks once it is loaded. */
  get info() {
    return this.current;
  }
  /** Makes a hardware profile play (SYNTH_PROFILES; the legacy 'fm' engine is not one), as useEngine does: loaded on
   *  first use, a file keeps its position. A profile that is not available rejects with an Error naming it, and the
   *  engine that played plays on. sources (a native profile's pack or module, as in profileSources) join that
   *  profile's profileSources: an unloaded profile loads with them, a loaded one loads again with them in its place (a
   *  file plays on), and a pack or module its core rejects leaves the loaded one. A profile still loading rejects them. */
  async useProfile(profile, sources) {
    if (!isSynthProfile(profile)) throw new RangeError("Unknown synth profile");
    if (sources) {
      const previous = this.sources;
      this.sources = withProfileSources(this.sources, profile, sources, this.loading.has(profile));
      if (this.current.engines.includes(profile)) {
        try {
          await this.reload(profile, sources.wasm !== void 0);
        } catch (error) {
          this.sources = previous;
          throw error;
        }
      }
    }
    return this.useEngine(profile);
  }
  /** Loads kind again on its profileSources, in place of the loaded engine; the worklet keeps the compiled module
   *  unless a new one comes (withWasm), so a new pack costs no new fetch or compile of its core. The previous sources
   *  are restored by useProfile when this rejects, so a refused pack leaves what plays and what a later reload uses.
   *  useSoundFont also uses this path to install the first SF2 directly or replace one during playback. */
  reload(kind, withWasm, soundfont = this.options.soundfont) {
    const load = (async () => {
      const part = await MidiSynth.part(kind, this.base, soundfont, this.timeout, false, this.options.onProgress, this.sources, withWasm, this.options.readWasm);
      this.current = await this.request("addEngine", [part, true]);
    })().finally(() => this.loading.delete(kind));
    this.loading.set(kind, load);
    return load;
  }
  fail(error) {
    this.failure = error;
    this.node.disconnect();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  request(method, args = []) {
    if (this.disposed) return Promise.reject(new Error("Synth is disposed"));
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 1024) return Promise.reject(new Error("Too many pending commands"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command timed out: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: (value) => resolve(value), reject, timer });
      try {
        this.node.port.postMessage({ id, method, args });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  /** Schedules a batch atomically. Resolve means accepted, not yet played. A sysex event carries one message F0
   *  through F7; its bytes travel beside the packed events. */
  schedule(events) {
    const payloads = [];
    const packed = events.map((event) => packEvent(event, this.context.sampleRate, payloads));
    return this.request("schedule", [packed, payloads]);
  }
  send(event, time = this.context.currentTime) {
    return this.schedule([{ ...event, time }]);
  }
  noteOn(channel, note, velocity = 100, time) {
    return this.send({ type: "noteOn", channel, note, velocity }, time);
  }
  noteOff(channel, note, time) {
    return this.send({ type: "noteOff", channel, note }, time);
  }
  programChange(channel, program, time) {
    return this.send({ type: "programChange", channel, program }, time);
  }
  controlChange(channel, controller, value, time) {
    return this.send({ type: "controlChange", channel, controller, value }, time);
  }
  pitchBend(channel, value, time) {
    return this.send({ type: "pitchBend", channel, value }, time);
  }
  /** Selects a preset of info.presets on a channel; a pair the SoundFont lacks is a RangeError. */
  selectPreset(channel, bank, program, time) {
    integer(bank, 0, OPERAND_MAX, "bank");
    integer(program, 0, 127, "program");
    if (!this.current.presets.some((p) => p.bank === bank && p.program === program)) throw new RangeError(`The ${this.current.kind} engine has no preset ${bank}:${program}`);
    if (this.current.kind !== "soundfont" && bank === 128 && channel !== 9) throw new RangeError(`The ${this.current.kind} engine plays bank 128 (percussion) on channel 10 (channel index 9) only`);
    return this.send({ type: "preset", channel, bank, program }, time);
  }
  /** Returns every channel to its General MIDI state. */
  reset(time) {
    return this.send({ type: "reset" }, time);
  }
  /** Schedules the messages of a MIDI byte stream (Web MIDI input, an emulated MPU-401) at time, system exclusive
   *  ones included; running status carries over between calls. */
  sendMidi(bytes, time = this.context.currentTime) {
    return this.schedule(this.stream.events(bytes, time));
  }
  clearScheduled() {
    return this.request("clear");
  }
  panic() {
    return this.request("panic");
  }
  /** Replaces the SoundFont (bytes, or a URL relative to baseUrl) and resolves with the new info. Clears queued events
   *  and, while the SoundFont engine plays, stops file playback; a rejected SoundFont keeps the loaded one. Without
   *  the SoundFont engine it rejects before downloading. */
  async loadSoundFont(source) {
    if (this.disposed) throw new Error("Synth is disposed");
    if (!this.current.engines.includes("soundfont")) throw new Error("The soundfont engine is not loaded");
    const bytes = await soundFontBytes(source, this.base, SOUNDFONT_ASSET, this.timeout, this.options.onProgress);
    this.current = await this.request("loadSoundFont", [bytes]);
    return this.current;
  }
  /** Opens a SoundFont and selects it in one operation. A playing MIDI keeps its position across the change. */
  async useSoundFont(source) {
    if (this.disposed) throw new Error("Synth is disposed");
    if (this.loading.has("soundfont")) throw new Error("The soundfont engine is loading");
    await this.reload("soundfont", !this.current.engines.includes("soundfont"), source);
    return this.useEngine("soundfont");
  }
  /** Makes kind's engine play, fetching and compiling it first when needed, and resolves with the new info. A loaded
   *  file keeps its position and plays on; scheduled events are cleared. */
  async useEngine(kind) {
    if (this.disposed) throw new Error("Synth is disposed");
    engineKind(kind);
    if (!this.current.engines.includes(kind)) {
      let load = this.loading.get(kind);
      if (!load) {
        const key = moduleKey(kind), shared = this.modules.get(key);
        load = (async () => {
          const held = shared ? await shared : false;
          const part = await MidiSynth.part(kind, this.base, this.options.soundfont, this.timeout, false, this.options.onProgress, this.sources, !held, this.options.readWasm);
          this.current = await this.request("addEngine", [part]);
        })().finally(() => this.loading.delete(kind));
        this.loading.set(kind, load);
        if (!shared) this.modules.set(key, load.then(() => true, () => {
          this.modules.delete(key);
          return false;
        }));
      }
      await load;
    }
    this.current = await this.request("useEngine", [kind]);
    return this.current;
  }
  /** Selects the embedded bank (0 to 78, numbered as libADLMIDI's banks.ini) of every loaded FM engine: fm, sb16-opl3
   *  and the sb16-cqm profile; a playing file plays on with the new instruments. */
  async setFmBank(bank) {
    integer(bank, 0, 78, "FM bank");
    this.current = await this.request("setFmBank", [bank]);
    return this.current;
  }
  /** Replaces the instruments of every loaded FM engine (fm, sb16-opl3, sb16-cqm) with a WOPL bank file (bytes, or a
   *  URL relative to baseUrl); a rejected file keeps the bank. */
  async loadFmBank(source) {
    if (this.disposed) throw new Error("Synth is disposed");
    const bytes = await bankBytes(source, this.base, this.timeout, this.options.onProgress);
    this.current = await this.request("loadFmBank", [bytes]);
    return this.current;
  }
  /** Plays the loaded file at rate (0.25 to 4) times its tempo, at the same pitch. */
  setPlaybackRate(rate) {
    finite(rate, 0.25, 4, "playback rate");
    return this.request("rate", [rate]);
  }
  /** Parses a MIDI, RMI or MUS file and makes it the file to play; tempo scales its clock (see MidiLoadOptions). */
  loadMidi(data, options = {}) {
    finite(options.tempo ?? 1, 0.25, 4, "tempo");
    return this.request("loadMidi", [inputBytes(data, MAX_SONG_BYTES, "file length"), { tempo: options.tempo ?? 1 }]);
  }
  play(loop = false) {
    return this.request("play", [loop]);
  }
  pause() {
    return this.request("pause");
  }
  stop() {
    return this.request("stop");
  }
  seek(seconds) {
    finite(seconds, 0, Number.MAX_SAFE_INTEGER, "seek");
    return this.request("seek", [seconds]);
  }
  status() {
    return this.request("status");
  }
  setGain(value) {
    if (this.disposed) throw new Error("Synth is disposed");
    finite(value, 0, 4, "gain");
    this.output.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
  async resume() {
    if (this.disposed) throw new Error("Synth is disposed");
    await this.context.resume();
  }
  /** Repeated calls share cleanup; a caller-owned AudioContext is never closed. */
  dispose() {
    if (this.disposeTask) return this.disposeTask;
    const acknowledgement = this.request("dispose");
    this.disposed = true;
    this.disposeTask = (async () => {
      try {
        await acknowledgement;
      } catch {
      } finally {
        this.node.disconnect();
        this.output.disconnect();
        this.node.port.close();
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("Synth is disposed"));
        }
        this.pending.clear();
        if (this.owned && this.context.state !== "closed") await this.context.close();
      }
    })();
    return this.disposeTask;
  }
}

export { MidiSynth };
