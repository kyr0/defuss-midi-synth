import { c as EngineKind, e as Preset, E as EngineOptions, F as FmInfo, a as SynthInfo, M as MidiLoadOptions, d as PlaybackInfo, f as PackedEvent, R as RenderStats, S as SoundFontSource, P as ProgressListener, B as BankSource, T as TimedEvent } from './assets-DQy7EZWb.js';
export { L as LoadProgress, b as SynthEvent } from './assets-DQy7EZWb.js';

/** A synthesizer the engine drives: complete MIDI channel messages in, planar Float32 PCM out. */
interface Voices {
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
/** TinySoundFont with one SoundFont 2 file. */
declare class SoundFontVoices implements Voices {
    private readonly options;
    readonly kind = "soundfont";
    readonly name = "TinySoundFont 0.9";
    private readonly wasm;
    private readonly output;
    private list;
    constructor(instance: WebAssembly.Instance, soundfont: Uint8Array, options: Required<EngineOptions>);
    /** Replaces the SoundFont; a rejected one leaves the loaded SoundFont in place (synth_load parses it first). */
    load(data: Uint8Array): void;
    presets(): Preset[];
    maxVoices(): number;
    message(status: number, data1: number, data2: number): void;
    setPreset(channel: number, bank: number, program: number): boolean;
    render(left: Float32Array, right: Float32Array, at: number, n: number): void;
    voices(): number;
    close(): void;
}
/** libADLMIDI on emulated OPL3 chips, with an embedded bank or a loaded WOPL bank file. */
declare class FmVoices implements Voices {
    readonly kind = "fm";
    readonly name = "libADLMIDI 1.6.2, Nuked OPL3";
    private readonly wasm;
    private readonly output;
    private readonly names;
    private current;
    constructor(instance: WebAssembly.Instance, options: Required<EngineOptions>);
    info(): FmInfo;
    /** Selects embedded bank (banks.ini's number); every voice ends. */
    setBank(bank: number): void;
    /** Replaces the instruments with a WOPL bank file; a rejected file keeps the instruments. Every voice ends. */
    loadBank(data: Uint8Array): void;
    /** The General MIDI programs on bank 0 and the percussion of channel 10 as bank 128. */
    presets(): Preset[];
    maxVoices(): number;
    /** VERIFIED: FFh's libADLMIDI reset (adl_rt_resetState, adlmidi_midiplay.cpp) resets the controllers but keeps each channel's bank and program, so
     *  the General MIDI state's bank 0, program 1 follows it here. */
    message(status: number, data1: number, data2: number): void;
    /** Bank 128 is the percussion, which plays on channel 10 only; other banks go out as bank select and program. */
    setPreset(channel: number, bank: number, program: number): boolean;
    render(left: Float32Array, right: Float32Array, at: number, n: number): void;
    voices(): number;
    close(): void;
}

/**
 * The synthesizer behind the browser and offline facades: one or both engines (TinySoundFont with a SoundFont, and
 * libADLMIDI on OPL3 chips), the MIDI file transport, and planar Float32 rendering into caller storage. One engine
 * plays at a time; switching keeps the file playing. Rendering allocates nothing in JavaScript.
 */
declare class Engine {
    readonly options: Required<EngineOptions>;
    readonly maxFrames = 128;
    private active;
    private soundfont;
    private fm;
    private song;
    private songFrames;
    private endFrame;
    private index;
    /** The file's position in its own frames; it advances rate frames per output frame. */
    private position;
    private rate;
    private state;
    private loop;
    /** The velocity of each note the file holds now (channel * 128 + note), so a new engine strikes it again. */
    private readonly held;
    /** Starts with voices, made from options by SoundFontVoices or FmVoices. */
    constructor(voices: SoundFontVoices | FmVoices, options?: EngineOptions);
    /** An engine with TinySoundFont on instance (midi-synth.wasm) and the SoundFont 2 file soundfont. */
    static withSoundFont(instance: WebAssembly.Instance, soundfont: Uint8Array, options?: EngineOptions): Engine;
    /** An engine with libADLMIDI on instance (fm-synth.wasm), options.chips chips and embedded bank options.fmBank. */
    static withFm(instance: WebAssembly.Instance, options?: EngineOptions): Engine;
    private attach;
    private ensure;
    info(): SynthInfo;
    /** The engines loaded so far. */
    has(kind: EngineKind): boolean;
    /** Adds the other engine, made by SoundFontVoices or FmVoices with this engine's options. */
    add(voices: SoundFontVoices | FmVoices): void;
    /** Makes kind's engine play. The voices of the other one end; a loaded file keeps its position and plays on, with
     *  its controllers and programs up to the position replayed into the new engine and its held notes struck again. */
    use(kind: EngineKind): void;
    /** Replaces the SoundFont engine's SoundFont; a rejected one leaves the loaded SoundFont in place. Stops file
     *  playback first when that engine plays. */
    loadSoundFont(data: Uint8Array): void;
    /** Selects the FM engine's embedded bank; a file keeps playing with its state replayed. */
    setFmBank(bank: number): void;
    /** Replaces the FM engine's instruments with a WOPL bank file; a rejected file keeps the bank. */
    loadFmBank(data: Uint8Array): void;
    /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
     *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
    voices(): number;
    hasPreset(bank: number, program: number): boolean;
    /** Parses a MIDI, RMI or MUS file and positions it at its start. Stops the previous file; a rejected file leaves
     *  none loaded. Every channel returns to its General MIDI state. */
    loadMidi(data: Uint8Array, options?: MidiLoadOptions): PlaybackInfo;
    private requireSong;
    play(loop?: boolean): void;
    /** Freezes file playback and the synthesizer; render emits silence until play. */
    pause(): void;
    /** Ends every sound at once and rewinds a loaded file to its start, in the General MIDI state. */
    stop(): void;
    /** Ends every sound at once; queued and file events still follow. */
    panic(): void;
    /** Moves the file to seconds: resets the channels and applies every non-note message before that time. */
    seek(seconds: number): void;
    /** Sets the file's playback rate, 0.25 to 4: 2 plays it twice as fast at the same pitch. */
    setRate(rate: number): void;
    /** The General MIDI state, then every non-note message of the file before index count, so a new engine or bank
     *  continues the file as it stood. */
    private chase;
    /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
    private restore;
    /** Plays a file message and keeps note on and off in held. */
    private play1;
    playbackInfo(): PlaybackInfo;
    /** Plays one packed message (status, data 1 << 8, data 2 << 16) or MIDI_RESET at once. */
    message(packed: number): void;
    /** Called by the validated scheduler with scalar operands, avoiding event objects. */
    dispatch(op: number, a: number, b: number, c: number): void;
    private controlAll;
    /** Sustain off and All Sound Off (120) on every channel: voices end at once. */
    private silence;
    /** Sustain off and All Notes Off (123) on every channel: voices release. */
    private notesOff;
    /** The file reached its end: start again when looping, else end with the notes released. */
    private finish;
    /** Writes frames (at most maxFrames) of planar Float32 PCM into left and right from offset, playing the file's
     *  messages at their frames: a message at file frame f plays at the first output frame where the file position,
     *  advancing rate frames per output frame, has reached f. */
    render(left: Float32Array, right: Float32Array, offset: number, frames: number): void;
    close(): void;
}

/**
 * Bounded stable min-heap. Typed storage avoids object churn in the audio callback.
 * Timestamp ties use insertion order, so patch changes precede notes when submitted that way.
 */
declare class EventQueue {
    readonly capacity: number;
    private readonly frames;
    private readonly order;
    private readonly ops;
    private serial;
    size: number;
    constructor(capacity?: number);
    get nextFrame(): number;
    clear(): void;
    /** Preflight the entire batch so rejection never leaves half a score scheduled. */
    pushBatch(events: readonly PackedEvent[]): void;
    /** Write into caller-owned scratch, never allocate while popping. */
    pop(target: Int32Array): void;
    private before;
    private swap;
}

/** Same timestamp scheduler drives AudioWorklet and deterministic offline tests. */
declare class RenderSession {
    readonly engine: Engine;
    readonly queue: EventQueue;
    private readonly scratch;
    frame: number;
    lateEvents: number;
    constructor(engine: Engine, capacity?: number);
    schedule(events: readonly PackedEvent[]): void;
    clear(): void;
    stats(): RenderStats;
    process(left: Float32Array, right: Float32Array, startFrame?: number): void;
}

interface StereoPcm {
    sampleRate: number;
    left: Float32Array;
    right: Float32Array;
}
interface OfflineOptions extends EngineOptions {
    /** Directory containing assets/. Defaults beside the installed JS. */
    baseUrl?: string | URL;
    queueCapacity?: number;
    /** SoundFont 2 bytes or URL; defaults to the bundled TimGM6mb.sf2. */
    soundfont?: SoundFontSource;
    /** Hears each download and decompression of the files this synthesizer loads. */
    onProgress?: ProgressListener;
}
declare class OfflineSynth {
    readonly engine: Engine;
    private readonly base;
    private readonly soundfont?;
    private readonly onProgress?;
    readonly session: RenderSession;
    private readonly stream;
    /** Engines being loaded, so concurrent useEngine calls share one load. VERIFIED: without it the second call's add
     *  threw 'already loaded'. */
    private readonly loading;
    private constructor();
    static create(options?: OfflineOptions): Promise<OfflineSynth>;
    private static voices;
    get info(): SynthInfo;
    /** Makes kind's engine play, loading it first when needed; a loaded file plays on and scheduled events are cleared,
     *  as in the browser. */
    useEngine(kind: EngineKind): Promise<SynthInfo>;
    /** Replaces the SoundFont engine's SoundFont with SF2 bytes or a URL relative to baseUrl, plain or Brotli-compressed;
     *  scheduled events are cleared. Without the SoundFont engine it rejects before reading the file. */
    loadSoundFont(source: SoundFontSource): Promise<SynthInfo>;
    /** Selects the FM engine's embedded bank (0 to 78, numbered as libADLMIDI's banks.ini). */
    setFmBank(bank: number): SynthInfo;
    /** Replaces the FM engine's instruments with a WOPL bank file (bytes, or a URL relative to baseUrl). */
    loadFmBank(source: BankSource): Promise<SynthInfo>;
    schedule(events: readonly TimedEvent[]): void;
    /** Schedules the messages of a MIDI byte stream at time (seconds); running status carries over between calls. */
    sendMidi(bytes: ArrayLike<number>, time: number): void;
    /** Loads a Standard MIDI, RMI or MUS file for playback from its start; options.tempo scales its clock. Scheduled
     *  events are cleared, as in the browser. */
    loadMidi(data: Uint8Array | ArrayBuffer, options?: MidiLoadOptions): PlaybackInfo;
    /** Plays the loaded file from its position as the following renders advance; loop restarts it at its end. */
    play(loop?: boolean): void;
    /** Allocating convenience method, up to the frames a WAV file holds. Use renderInto for repeated streaming blocks. */
    render(frames: number): StereoPcm;
    renderInto(left: Float32Array, right: Float32Array): void;
    close(): void;
}
/** Encode signed 16-bit stereo RIFF/WAVE. Inputs remain untouched. */
declare function encodeWav(pcm: StereoPcm): Uint8Array;

export { BankSource, EngineKind, EngineOptions, FmInfo, MidiLoadOptions, OfflineSynth, PackedEvent, PlaybackInfo, Preset, ProgressListener, RenderStats, SoundFontSource, SynthInfo, TimedEvent, encodeWav };
export type { OfflineOptions, StereoPcm };
