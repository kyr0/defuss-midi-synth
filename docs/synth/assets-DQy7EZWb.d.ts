/** The two synthesizers: TinySoundFont with a General MIDI SoundFont, or libADLMIDI on emulated OPL3 FM chips. */
type EngineKind = 'soundfont' | 'fm';
interface EngineOptions {
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
type SynthEvent = {
    type: 'noteOn';
    channel: number;
    note: number;
    velocity: number;
} | {
    type: 'noteOff';
    channel: number;
    note: number;
} | {
    type: 'controlChange';
    channel: number;
    controller: number;
    value: number;
} | {
    type: 'programChange';
    channel: number;
    program: number;
} | {
    type: 'pitchBend';
    channel: number;
    value: number;
} | {
    type: 'channelPressure';
    channel: number;
    value: number;
} | {
    type: 'polyPressure';
    channel: number;
    note: number;
    value: number;
}
/** Any preset of the SoundFont on any channel, also a drum kit of bank 128 outside channel 10. */
 | {
    type: 'preset';
    channel: number;
    bank: number;
    program: number;
}
/** Every channel back to its General MIDI state (the GM, GS and XG reset messages do this too). */
 | {
    type: 'reset';
};
/** Time is absolute AudioContext time in the browser, seconds from zero offline. */
type TimedEvent = SynthEvent & {
    time: number;
};
/** Fixed-width protocol: output frame, operation, three integer operands. */
type PackedEvent = [number, number, number, number, number];
/** One preset of the loaded SoundFont: bank 0 holds the General MIDI programs, bank 128 the drum kits. */
interface Preset {
    bank: number;
    program: number;
    name: string;
}
/** The FM engine's embedded banks (index = bank number), the selected bank (-1: a loaded WOPL file) and its chips. */
interface FmInfo {
    banks: string[];
    bank: number;
    chips: number;
}
/** engine names the active synthesizer; presets are what selectPreset accepts on it. fm is set once the FM engine
 *  is loaded. */
interface SynthInfo {
    engine: string;
    kind: EngineKind;
    engines: EngineKind[];
    sampleRate: number;
    maxVoices: number;
    presets: Preset[];
    fm?: FmInfo;
}
/** rate is the file's playback rate: 2 plays it twice as fast, at the same pitch. */
/** How a file loads. tempo scales the file's own clock: 0.5 plays it at half the tempo its header and tempo events
 *  state, for files converted at a wrong clock (Raptor's MUS music ran at 70 Hz, and MIDI files converted from it at
 *  Doom's 140 Hz play twice too fast), or a MUS file of such a game. Positions, seeking and the duration then count
 *  real seconds. 0.25 to 4, default 1. */
interface MidiLoadOptions {
    tempo?: number;
}
/** Progress of loading a file: its download, then, for a Brotli-compressed one, its decompression (loaded counts the
 *  compressed bytes consumed). total is 0 while a server sends no length. url names the file. */
interface LoadProgress {
    phase: 'download' | 'decompress';
    url: string;
    loaded: number;
    total: number;
}
type ProgressListener = (progress: LoadProgress) => void;
interface PlaybackInfo {
    title: string;
    duration: number;
    position: number;
    ended: boolean;
    rate: number;
}
interface RenderStats {
    frame: number;
    queuedEvents: number;
    lateEvents: number;
}

/** A SoundFont 2 file, plain or Brotli-compressed: its bytes, or a URL resolved against the package's asset directory. */
type SoundFontSource = string | URL | ArrayBuffer | Uint8Array;
/** A WOPL bank file for the FM engine, plain or Brotli-compressed: its bytes, or a URL resolved against the package's
 *  asset directory. */
type BankSource = string | URL | ArrayBuffer | Uint8Array;

export type { BankSource as B, EngineOptions as E, FmInfo as F, LoadProgress as L, MidiLoadOptions as M, ProgressListener as P, RenderStats as R, SoundFontSource as S, TimedEvent as T, SynthInfo as a, SynthEvent as b, EngineKind as c, PlaybackInfo as d, Preset as e, PackedEvent as f };
