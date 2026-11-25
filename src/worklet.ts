import { type EnginePart } from './profile-assets.ts';
import { NativeProfileVoices, instantiateProfile } from './profile-voices.ts';
import type { Voices } from './voices.ts';
import { Engine, SYNTH_IMPORTS } from './engine.ts';
import { RenderSession } from './session.ts';
import { normalizeOptions, type EngineKind, type EngineOptions, type MidiLoadOptions, type PackedEvent } from './types.ts';
import { FmVoices, SoundFontVoices } from './voices.ts';

interface ProcessorOptions { processorOptions: { part: EnginePart; settings: EngineOptions; capacity: number } }
interface Request { id: number; method: string; args: unknown[] }

/** The synthesizer in the audio thread: the page compiles the modules and fetches the SoundFont, the processor only
 *  instantiates and loads them, then renders each quantum through the timestamp scheduler. */
class MidiProcessor extends AudioWorkletProcessor {
  private session?: RenderSession;
  private settings: Required<EngineOptions>;
  private closed = false;
  /** The modules compiled so far, by moduleKey: a later engine on one of them comes without bytes. VERIFIED:
   *  scripts/e2e.mjs plays fm and sb16-opl3 in the browser with one fm-synth.wasm request. */
  private readonly modules = new Map<string, WebAssembly.Module>();
  constructor(options: ProcessorOptions) {
    super();
    this.port.onmessage = (event: MessageEvent<Request>) => this.command(event.data);
    const config = options.processorOptions;
    this.settings = normalizeOptions({ ...config.settings, sampleRate });
    try {
      const engine = new Engine(this.voices(config.part), this.settings);
      this.session = new RenderSession(engine, config.capacity);
      this.port.postMessage({ type: 'ready', info: engine.info() });
    } catch (error) { this.fail(error); }
  }
  /** The engine's voices. Native cores boot in profile_init (the Sound Canvas firmware for up to seconds), so voices
   *  are made only here, in the constructor and in addEngine's message, never in process(): a render quantum never
   *  holds a boot, though a long boot still delays the quanta after the message. */
  private voices(part: EnginePart, module = part.module ?? this.modules.get(part.key)): Voices {
    if (!module) throw new Error('The engine part has no module');
    const voices = this.build(part, module);
    // Kept for a later part of the same key only once its core took it: a module it refused would refuse that one too
    // (a later reload sends no module), where the loaded engine still plays on its own.
    this.modules.set(part.key, module);
    return voices;
  }
  private build(part: EnginePart, module: WebAssembly.Module): Voices {
    // A later FM engine starts on the bank the loaded ones play (Engine.fmBank).
    const fmBank = this.session?.engine.fmBank() ?? this.settings.fmBank;
    if ('assets' in part) return new NativeProfileVoices(part.kind, instantiateProfile(module), new Uint8Array(part.assets), this.settings.sampleRate, fmBank);
    const instance = new WebAssembly.Instance(module, SYNTH_IMPORTS);
    if (part.kind === 'fm' || part.kind === 'sb16-opl3') return new FmVoices(instance, { ...this.settings, fmBank }, part.kind);
    if (!part.soundfont) throw new Error('The soundfont engine needs a SoundFont');
    return new SoundFontVoices(instance, new Uint8Array(part.soundfont), this.settings);
  }
  private fail(error: unknown): void {
    this.port.postMessage({ type: 'fatal', error: error instanceof Error ? error.message : String(error) });
    this.closed = true; this.session?.engine.close();
  }
  private command(request: Request): void {
    try {
      if (request.method === 'dispose') {
        this.closed = true; this.session?.engine.close();
        this.port.postMessage({ id: request.id, result: null }); return;
      }
      if (this.closed || !this.session) throw new Error('Processor is not ready');
      if (request.method === 'addEngine') { void this.addEngine(request); return; }
      const s = this.session, e = s.engine, a = request.args;
      let result: unknown = null;
      switch (request.method) {
        case 'schedule': s.schedule(a[0] as PackedEvent[], (a[1] ?? []) as Uint8Array[]); break;
        case 'clear': s.clear(); break;
        case 'panic': s.clear(); e.panic(); break;
        case 'useEngine': s.clear(); e.use(a[0] as EngineKind); result = e.info(); break;
        case 'loadSoundFont': s.clear(); e.loadSoundFont(a[0] as Uint8Array); result = e.info(); break;
        case 'setFmBank': e.setFmBank(a[0] as number); result = e.info(); break;
        case 'loadFmBank': e.loadFmBank(a[0] as Uint8Array); result = e.info(); break;
        case 'loadMidi': s.clear(); result = e.loadMidi(a[0] as Uint8Array, a[1] as MidiLoadOptions); break;
        case 'play': e.play(a[0] as boolean); break;
        case 'pause': e.pause(); break;
        case 'stop': s.clear(); e.stop(); break;
        case 'seek': s.clear(); e.seek(a[0] as number); break;
        case 'rate': e.setRate(a[0] as number); break;
        case 'status': result = { ...s.stats(), ...e.playbackInfo(), voices: e.voices(), dropped: e.dropped() }; break;
        default: throw new Error(`Unknown command: ${request.method}`);
      }
      this.port.postMessage({ id: request.id, result });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Compiles the bytes of a later engine without blocking the audio thread, then adds the engine; the reply waits
   *  for both, and the synthesizer sends no other engine command meanwhile. */
  private async addEngine(request: Request): Promise<void> {
    try {
      const part = request.args[0] as EnginePart;
      const module = part.module ?? (part.wasm ? await WebAssembly.compile(part.wasm) : this.modules.get(part.key));
      if (this.closed || !this.session) throw new Error('Processor is not ready');
      const engine = this.session.engine;
      engine.add(this.voices(part, module), request.args[1] === true);
      this.port.postMessage({ id: request.id, result: engine.info() });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.closed) return false;
    const out = outputs[0];
    if (!out || out.length < 2 || !this.session) return true;
    // The session's clock never runs backwards: Chrome has handed a processor a currentFrame below the frames it had
    // already rendered, which the session rejects; frames the node skipped move the clock forward.
    try { this.session.process(out[0]!, out[1]!, Math.max(currentFrame, this.session.frame)); }
    catch (error) { out[0]!.fill(0); out[1]!.fill(0); this.fail(error); return false; }
    return true;
  }
}
registerProcessor('defuss-midi-synth', MidiProcessor);
