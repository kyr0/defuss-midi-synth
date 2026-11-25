import { E as EngineOptions, S as SynthProfile, P as ProfileSourceMap, a as SoundFontSource, b as ProgressListener, c as SynthInfo, d as ProfileSources, T as TimedEvent, e as SynthEvent, f as EngineKind, B as BankSource, M as MidiLoadOptions, g as PlaybackInfo, R as RenderStats } from './profile-store-8LHTX7sj.js';
export { F as FmInfo, L as LoadProgress, h as MidiMetadata, i as PROFILE_DESCRIPTORS, j as Preset, k as ProfileAvailability, l as ProfileDescriptor, m as ProfileStorage, n as ProfileStorageFile, o as ProfileStore, p as ProfileUserAssets, q as SYNTH_PROFILES, r as StoredProfileSources, s as createProfileStore, t as openProfileStore } from './profile-store-8LHTX7sj.js';

interface SynthOptions extends Omit<EngineOptions, 'sampleRate'> {
    profile?: SynthProfile;
    profileSources?: ProfileSourceMap;
    context?: AudioContext;
    /** Directory containing worklet.js and assets/. Defaults beside the installed JS. */
    baseUrl?: string | URL;
    /** SoundFont 2 bytes or URL (relative to baseUrl) for the soundfont engine; defaults to the bundled TimGM6mb.sf2. */
    soundfont?: SoundFontSource;
    /** Optional reader for engine WASM URLs, for instance from an application cache. */
    readWasm?(url: URL, timeoutMs?: number, onProgress?: ProgressListener): Promise<Uint8Array>;
    /** Hears each download and decompression of the files this synthesizer loads: modules, SoundFonts, banks. */
    onProgress?: ProgressListener;
    /** Connect to context.destination automatically; disable for custom graphs. */
    connect?: boolean;
    gain?: number;
    queueCapacity?: number;
    timeoutMs?: number;
}
/** File transport, scheduler counters and the voices sounding now. */
/** voices as Engine.voices; dropped: MIDI and SysEx the active engine's input could not take (Engine.dropped). */
type SynthStatus = PlaybackInfo & RenderStats & {
    voices: number;
    dropped: number;
};
/** Browser facade. Call create/resume from a user gesture to satisfy autoplay policy. */
declare class MidiSynth {
    readonly context: AudioContext;
    private readonly node;
    private readonly base;
    private readonly owned;
    private readonly timeout;
    private readonly options;
    readonly output: GainNode;
    /** The synthesizer's signal before output's gain, for meters and visualizers that should not follow the volume. */
    get source(): AudioNode;
    private current;
    private readonly pending;
    private readonly stream;
    private nextId;
    private disposed;
    private failure?;
    private disposeTask?;
    /** Engines being fetched and added, so concurrent useEngine calls share one load. */
    private readonly loading;
    /** The modules the worklet holds or is being sent, by moduleKey: true once it holds one, so an engine on a module
     *  it holds ('fm' and 'sb16-opl3' share one) goes without its bytes and is not compiled again. */
    private readonly modules;
    /** The native profiles' sources: the profileSources option, and those useProfile adds. */
    private sources;
    private constructor();
    static create(options?: SynthOptions): Promise<MidiSynth>;
    /** Fetches kind's module (unless withWasm is false: the worklet holds it), with the SoundFont for the soundfont
     *  engine and the pack for a native profile, and compiles it off the audio thread when compile is true. Structured
     *  cloning copies the buffers into the audio thread; slices keep a caller's untouched. */
    private static part;
    /** The active engine, the loaded engines, sample rate, voice limit, the presets selectPreset takes, and the FM
     *  engine's banks once it is loaded. */
    get info(): SynthInfo;
    /** Makes a hardware profile play (SYNTH_PROFILES; the legacy 'fm' engine is not one), as useEngine does: loaded on
     *  first use, a file keeps its position. A profile that is not available rejects with an Error naming it, and the
     *  engine that played plays on. sources (a native profile's pack or module, as in profileSources) join that
     *  profile's profileSources: an unloaded profile loads with them, a loaded one loads again with them in its place (a
     *  file plays on), and a pack or module its core rejects leaves the loaded one. A profile still loading rejects them. */
    useProfile(profile: SynthProfile, sources?: ProfileSources): Promise<SynthInfo>;
    /** Loads kind again on its profileSources, in place of the loaded engine; the worklet keeps the compiled module
     *  unless a new one comes (withWasm), so a new pack costs no new fetch or compile of its core. The previous sources
     *  are restored by useProfile when this rejects, so a refused pack leaves what plays and what a later reload uses.
     *  useSoundFont also uses this path to install the first SF2 directly or replace one during playback. */
    private reload;
    private fail;
    private request;
    /** Schedules a batch atomically. Resolve means accepted, not yet played. A sysex event carries one message F0
     *  through F7; its bytes travel beside the packed events. */
    schedule(events: readonly TimedEvent[]): Promise<void>;
    send(event: SynthEvent, time?: number): Promise<void>;
    noteOn(channel: number, note: number, velocity?: number, time?: number): Promise<void>;
    noteOff(channel: number, note: number, time?: number): Promise<void>;
    programChange(channel: number, program: number, time?: number): Promise<void>;
    controlChange(channel: number, controller: number, value: number, time?: number): Promise<void>;
    pitchBend(channel: number, value: number, time?: number): Promise<void>;
    /** Selects a preset of info.presets on a channel; a pair the SoundFont lacks is a RangeError. */
    selectPreset(channel: number, bank: number, program: number, time?: number): Promise<void>;
    /** Returns every channel to its General MIDI state. */
    reset(time?: number): Promise<void>;
    /** Schedules the messages of a MIDI byte stream (Web MIDI input, an emulated MPU-401) at time, system exclusive
     *  ones included; running status carries over between calls. */
    sendMidi(bytes: ArrayLike<number>, time?: number): Promise<void>;
    clearScheduled(): Promise<void>;
    panic(): Promise<void>;
    /** Replaces the SoundFont (bytes, or a URL relative to baseUrl) and resolves with the new info. Clears queued events
     *  and, while the SoundFont engine plays, stops file playback; a rejected SoundFont keeps the loaded one. Without
     *  the SoundFont engine it rejects before downloading. */
    loadSoundFont(source: SoundFontSource): Promise<SynthInfo>;
    /** Opens a SoundFont and selects it in one operation. A playing MIDI keeps its position across the change. */
    useSoundFont(source: SoundFontSource): Promise<SynthInfo>;
    /** Makes kind's engine play, fetching and compiling it first when needed, and resolves with the new info. A loaded
     *  file keeps its position and plays on; scheduled events are cleared. */
    useEngine(kind: EngineKind): Promise<SynthInfo>;
    /** Selects the embedded bank (0 to 78, numbered as libADLMIDI's banks.ini) of every loaded FM engine: fm, sb16-opl3
     *  and the sb16-cqm profile; a playing file plays on with the new instruments. */
    setFmBank(bank: number): Promise<SynthInfo>;
    /** Replaces the instruments of every loaded FM engine (fm, sb16-opl3, sb16-cqm) with a WOPL bank file (bytes, or a
     *  URL relative to baseUrl); a rejected file keeps the bank. */
    loadFmBank(source: BankSource): Promise<SynthInfo>;
    /** Plays the loaded file at rate (0.25 to 4) times its tempo, at the same pitch. */
    setPlaybackRate(rate: number): Promise<void>;
    /** Parses a MIDI, RMI or MUS file and makes it the file to play; tempo scales its clock (see MidiLoadOptions). */
    loadMidi(data: Uint8Array | ArrayBuffer, options?: MidiLoadOptions): Promise<PlaybackInfo>;
    play(loop?: boolean): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    seek(seconds: number): Promise<void>;
    status(): Promise<SynthStatus>;
    setGain(value: number): void;
    resume(): Promise<void>;
    /** Repeated calls share cleanup; a caller-owned AudioContext is never closed. */
    dispose(): Promise<void>;
}

/** Whether bytes (a system exclusive message without F0 and F7) reset a synthesizer to General MIDI. */
declare function isReset(bytes: Uint8Array): boolean;
/**
 * The parser of a MIDI byte stream (MIDI 1.0 Detailed Specification): a channel status byte (80h-EFh) starts a message
 * and becomes the running status, so further data bytes form further messages of it; a real-time byte (F8h-FFh) is a
 * message of its own and leaves a message in progress whole; F0h starts and F7h ends a system exclusive message (any
 * other status byte ends it too); F1h-F6h are system common messages, which end the running status; a data byte
 * without a status is ignored. Real-time bytes inside a system exclusive message are messages of their own and leave it
 * whole. message receives each channel message and each real-time byte, sysex the bytes of each system exclusive
 * message between F0h and F7h. A message longer than SYSEX_MAX bytes from F0h to F7h is dropped whole, never cut.
 */
declare class MidiParser {
    private readonly message;
    private readonly sysex;
    private status;
    private readonly data;
    private have;
    private skip;
    private sysexBytes;
    /** The system exclusive message in progress has outgrown SYSEX_MAX and is dropped at its end. */
    private overflow;
    constructor(message: (time: number, status: number, data1: number, data2: number) => void, sysex?: (time: number, bytes: Uint8Array) => void);
    /** Takes byte, which arrived at time. */
    feed(byte: number, time: number): void;
    /** Ends a message in progress as another status byte would, without one: a system exclusive message is dropped and
     *  the running status ends. A Standard MIDI File track uses it when a channel event interrupts a divided SysEx. */
    cancel(): void;
}

/** The 128 program names of the General MIDI 1 sound set (MMA, General MIDI System Level 1, 1991), program 1 first.
 *  The FM engine's banks carry no names, so its presets take these. */
declare const GM_PROGRAMS: readonly ["Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer", "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion", "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics", "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani", "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit", "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2", "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina", "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)", "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)", "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag pipe", "Fiddle", "Shanai", "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal", "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"];

export { BankSource, EngineKind, EngineOptions, GM_PROGRAMS, MidiLoadOptions, MidiParser, MidiSynth, PlaybackInfo, ProfileSourceMap, ProfileSources, ProgressListener, RenderStats, SoundFontSource, SynthEvent, SynthInfo, SynthProfile, TimedEvent, isReset };
export type { SynthOptions, SynthStatus };
