import { f as EngineKind, i as Preset, E as EngineOptions, c as SynthInfo, M as MidiLoadOptions, g as PlaybackInfo, n as PackedEvent, R as RenderStats, S as SynthProfile, P as ProfileSourceMap, a as SoundFontSource, b as ProgressListener, d as ProfileSources, B as BankSource, T as TimedEvent } from './assets-g7P72yF5.js';
export { F as FmInfo, L as LoadProgress, h as PROFILE_DESCRIPTORS, j as ProfileAvailability, k as ProfileDescriptor, l as ProfileUserAssets, m as SYNTH_PROFILES, e as SynthEvent } from './assets-g7P72yF5.js';

/** A synthesizer the engine drives: complete MIDI channel messages in, planar Float32 PCM out. */
interface Voices {
    readonly kind: EngineKind;
    readonly name: string;
    presets(): Preset[];
    /** The voices it can sound at once. */
    maxVoices(): number;
    /** Plays one channel message, or resets every channel to its General MIDI state for status FFh. */
    message(status: number, data1: number, data2: number): void;
    /** Applies the system exclusive message of length bytes at offset in bytes (F0 through F7, validated by the caller)
     *  as the synthesizer understands it: the GM, GM2, GS and XG resets reset it, as FFh does, and what it does not know
     *  it ignores. Allocates nothing. */
    sysex(bytes: Uint8Array, offset: number, length: number): void;
    /** Selects bank and program on channel; false when the synthesizer has no such preset there. */
    setPreset(channel: number, bank: number, program: number): boolean;
    /** Writes n (at most RENDER_BLOCK) frames into left and right from at. */
    render(left: Float32Array, right: Float32Array, at: number, n: number): void;
    /** The voices sounding now. */
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
    private readonly loaded;
    private get fm();
    /** The loaded engines on libADLMIDI's banks: 'fm', 'sb16-opl3' and the 'sb16-cqm' profile, which setFmBank and
     *  loadFmBank keep on one bank. */
    private fmFamily;
    /** The embedded bank the FM engines play (an engine loaded later starts on it), options.fmBank before one is loaded
     *  or while they play a WOPL file. */
    fmBank(): number;
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
    constructor(voices: Voices, options?: EngineOptions);
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
    add(voices: Voices): void;
    /** Makes kind's engine play. The voices of the other one end; a loaded file keeps its position and plays on, with
     *  its controllers and programs up to the position replayed into the new engine and its held notes struck again. */
    use(kind: EngineKind): void;
    /** Replaces the SoundFont engine's SoundFont; a rejected one leaves the loaded SoundFont in place. Stops file
     *  playback first when that engine plays. */
    loadSoundFont(data: Uint8Array): void;
    /** Selects the embedded bank (banks.ini's number) of every loaded FM engine: 'fm', 'sb16-opl3' and the 'sb16-cqm'
     *  profile (a new pack for its core); a file keeps playing with its state replayed. */
    setFmBank(bank: number): void;
    /** Replaces the instruments of every loaded FM engine with a WOPL bank file; a rejected file keeps the bank. */
    loadFmBank(data: Uint8Array): void;
    /** Applies a bank change to every loaded FM engine, the CQM first: its core may reject the bank, and goes first so a
     *  rejection leaves every engine on the bank it had. The CQM changes banks by restarting its core, which a rejection
     *  restarts on the pack it had, at power-on state: when it plays, the file's state is replayed then as after a change. */
    private changeFmBank;
    /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
     *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
    voices(): number;
    /** MIDI and SysEx the active engine could not take since it loaded: a native profile whose input queue was full,
     *  such as the Sound Canvas cores' MIDI IN; 0 on the other engines, which take everything. */
    dropped(): number;
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
    /** The General MIDI state, then the file's state before message index count in file order, so a new engine or bank
     *  continues the file as it stood: every system exclusive message and reset, and of each channel's program, pitch
     *  bend, channel pressure and controller value the last one. A message that a later one of its kind replaces leaves
     *  nothing behind, and the Sound Canvas cores take MIDI at 3,125 bytes per second into 16 KiB, so a seek in a file of
     *  many controller changes would wait seconds, or overflow (dropped), behind ones that change nothing. Bank select,
     *  RPN, NRPN, data entry and the channel mode messages act on what comes after them: all of those go. */
    private chase;
    /** Plays message index of song: a channel message, a reset, or a system exclusive message, which reaches the active
     *  engine as it is (each engine resets on the GM, GM2, GS and XG resets itself). */
    private apply;
    /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
    private restore;
    /** Plays file message index and keeps note on and off in held; a reset ends every held note. */
    private play1;
    playbackInfo(): PlaybackInfo;
    /** Plays one packed message (status, data 1 << 8, data 2 << 16) or MIDI_RESET at once. */
    message(packed: number): void;
    /** Plays the system exclusive message of length bytes at offset in bytes (F0 through F7, validated by the caller) on
     *  the active engine at once; the scheduler passes its payload store, so nothing is allocated. */
    sysex(bytes: Uint8Array, offset: number, length: number): void;
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
 * A sysex event's message lives in one byte store (payload), its offset and length in the event's operands. Events
 * leave in frame order, not in the order they came, so a batch that finds no room at the store's end first moves the
 * live messages to its front, and grows the store (to at most MAX_QUEUED_SYSEX_BYTES) only when they do not leave
 * room. Both happen while a batch is added, never while events are taken, and a store that empties starts again at
 * its front, so steady scheduling reuses it without allocating. VERIFIED: tests/core.test.ts stores payloads out of
 * order, compacts, grows and reuses the one buffer, and rejects an overflowing batch whole.
 */
declare class EventQueue {
    readonly capacity: number;
    private readonly frames;
    private readonly order;
    private readonly ops;
    private serial;
    size: number;
    /** The bytes of the queued SysEx messages; sysex events index it (offset, length) until they are taken. */
    payload: Uint8Array<ArrayBuffer>;
    private payloadEnd;
    private payloadLive;
    constructor(capacity?: number);
    get nextFrame(): number;
    /** The SysEx bytes that queued events hold. */
    get sysexBytes(): number;
    clear(): void;
    /** Preflight the entire batch so rejection never leaves half a score scheduled. A sysex event ([frame, OP.sysex,
     *  index, 0, 0]) takes its message, F0 through F7, from payloads[index]. */
    pushBatch(events: readonly PackedEvent[], payloads?: readonly Uint8Array[]): void;
    /** Moves the live SysEx messages to the front of a store with room for bytes more after them: the current store when
     *  it is large enough, else one twice as large or as large as needed. */
    private reserve;
    /** Write into caller-owned scratch, never allocate while popping. A sysex event's message stays in payload at the
     *  offset and length of target[1] and target[2] until the next pushBatch or clear. */
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
    /** Adds a batch atomically; sysex events take their messages from payloads (packEvent). */
    schedule(events: readonly PackedEvent[], payloads?: readonly Uint8Array[]): void;
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
declare class OfflineSynth {
    readonly engine: Engine;
    private readonly loader;
    readonly session: RenderSession;
    private readonly stream;
    /** Engines being loaded, so concurrent useEngine calls share one load. VERIFIED: without it the second call's add
     *  threw 'already loaded'. */
    private readonly loading;
    private constructor();
    static create(options?: OfflineOptions): Promise<OfflineSynth>;
    get info(): SynthInfo;
    /** Makes a hardware profile play (SYNTH_PROFILES; the legacy 'fm' engine is not one), as useEngine does. A profile
     *  that is not available rejects with an Error naming it, and the engine that played plays on. sources (a native
     *  profile's pack or module, as in profileSources) apply when the profile loads; a profile loaded or loading rejects
     *  them, as its pack stays. */
    useProfile(profile: SynthProfile, sources?: ProfileSources): Promise<SynthInfo>;
    /** Makes kind's engine play, loading it first when needed; a loaded file plays on and scheduled events are cleared,
     *  as in the browser. */
    useEngine(kind: EngineKind): Promise<SynthInfo>;
    /** Replaces the SoundFont engine's SoundFont with SF2 bytes or a URL relative to baseUrl, plain or Brotli-compressed;
     *  scheduled events are cleared. Without the SoundFont engine it rejects before reading the file. */
    loadSoundFont(source: SoundFontSource): Promise<SynthInfo>;
    /** Selects the embedded bank (0 to 78, numbered as libADLMIDI's banks.ini) of every loaded FM engine: fm, sb16-opl3
     *  and sb16-cqm. */
    setFmBank(bank: number): SynthInfo;
    /** Replaces the instruments of every loaded FM engine (fm, sb16-opl3, sb16-cqm) with a WOPL bank file (bytes, or a
     *  URL relative to baseUrl). */
    loadFmBank(source: BankSource): Promise<SynthInfo>;
    /** Schedules a batch atomically, as in the browser; a sysex event carries one message F0 through F7. */
    schedule(events: readonly TimedEvent[]): void;
    /** Schedules the messages of a MIDI byte stream at time (seconds), system exclusive ones included; running status
     *  carries over between calls. */
    sendMidi(bytes: ArrayLike<number>, time: number): void;
    /** Loads a Standard MIDI, RMI or MUS file for playback from its start; options.tempo scales its clock. Scheduled
     *  events are cleared, as in the browser. */
    loadMidi(data: Uint8Array | ArrayBuffer, options?: MidiLoadOptions): PlaybackInfo;
    /** Plays the loaded file from its position as the following renders advance; loop restarts it at its end. */
    play(loop?: boolean): void;
    /** Allocating convenience method, up to the frames a WAV file holds. Use renderInto for repeated streaming blocks. */
    render(frames: number): StereoPcm;
    renderInto(left: Float32Array, right: Float32Array): void;
    /** MIDI and SysEx the active engine's input could not take since it loaded, as MidiSynth's status().dropped. */
    get dropped(): number;
    close(): void;
}
/** Encode signed 16-bit stereo RIFF/WAVE. Inputs remain untouched. */
declare function encodeWav(pcm: StereoPcm): Uint8Array;

export { BankSource, EngineKind, EngineOptions, MidiLoadOptions, OfflineSynth, PackedEvent, PlaybackInfo, Preset, ProfileSourceMap, ProfileSources, ProgressListener, RenderStats, SoundFontSource, SynthInfo, SynthProfile, TimedEvent, encodeWav };
export type { OfflineOptions, StereoPcm };
