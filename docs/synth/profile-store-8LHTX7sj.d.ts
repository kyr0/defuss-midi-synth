/** Stable hardware model identifiers. 'fm' remains a legacy multi-chip OPL3 engine. VERIFIED: tests/profiles.test.ts
 *  checks the ten unique ids and that prototype keys such as '__proto__' are no profile. */
declare const SYNTH_PROFILES: readonly ["soundfont", "sb16-opl3", "sb16-cqm", "awe32", "awe64", "sb-pci128", "gus-gf1", "roland-sc55", "roland-sc55mk2", "roland-mt32"];
type SynthProfile = typeof SYNTH_PROFILES[number];
type NativeProfile = Exclude<SynthProfile, 'soundfont' | 'sb16-opl3'>;
/** A native profile's module or pack: a URL (relative to baseUrl) or its bytes. */
type ProfileSource = string | URL | Uint8Array | ArrayBuffer;
/** wasm replaces the package's module (a local build, such as AWE's); assets is the DSPK pack
 *  (native/profiles/profile_pack.h) of the user's own ROMs, wavesets or patches, which the package never ships. */
interface ProfileSources {
    wasm?: ProfileSource;
    assets?: ProfileSource;
}
/** The sources of each native profile, as profileSources and useProfile take them. */
type ProfileSourceMap = Partial<Record<NativeProfile, ProfileSources>>;
/** Whether the package ships the profile's core: 'bundled' cores are in dist/assets/profiles (or built in), the others
 *  must be built (scripts/build-native-profiles.py) and supplied as profileSources[id].wasm. */
type ProfileAvailability = 'bundled' | 'build-required' | 'local-build-required';
/** What the user supplies as profileSources[id].assets: 'none', an 'optional' bank, or 'required' private assets
 *  (ROMs, a waveset, a patch set), without which the profile rejects. A profile plays without user assets exactly when
 *  its core is bundled and userAssets is not 'required'. */
type ProfileUserAssets = 'none' | 'optional' | 'required';
interface ProfileDescriptor {
    readonly id: number;
    readonly label: string;
    readonly technology: string;
    readonly availability: ProfileAvailability;
    readonly userAssets: ProfileUserAssets;
    readonly maxVoices: number;
}
/** Each profile's model id (profile_model), label, core, whether the package ships its core, and whether it needs the
 *  user's files: a page offers as playable only what is bundled and needs no 'required' assets. */
declare const PROFILE_DESCRIPTORS: Readonly<Record<SynthProfile, ProfileDescriptor>>;

/** The two synthesizers: TinySoundFont with a General MIDI SoundFont, or libADLMIDI on emulated OPL3 FM chips. */
type EngineKind = SynthProfile | 'fm';
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
}
/** One system exclusive message, F0 through F7 (at most SYSEX_MAX bytes, data bytes below 80h). Each engine applies
 *  what it knows and ignores the rest: the GM, GM2, GS and XG resets on every engine, GM Master Volume on the
 *  SoundFont and FM engines, libADLMIDI's GS and XG messages on the FM engine, the native core's own on a profile. */
 | {
    type: 'sysex';
    data: Uint8Array | readonly number[];
};
/** Time is absolute AudioContext time in the browser, seconds from zero offline. */
type TimedEvent = SynthEvent & {
    time: number;
};
/** Fixed-width protocol: output frame, operation, three integer operands. A sysex event's first operand indexes the
 *  batch's payloads (packEvent), the other two are 0. */
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
    profile?: SynthProfile;
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
interface MidiMetadata {
    format: number;
    trackCount: number;
    initialBpm?: number;
    timeSignature?: string;
    copyright?: string;
    text?: string;
}
interface PlaybackInfo {
    metadata?: MidiMetadata;
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

/** The parts of a defuss-storage file handle the store uses; any adapter's StorageFile has them. */
interface ProfileStorageFile {
    readonly maxReadBytes: number;
    size(): Promise<number>;
    readInto(offset: number, target: Uint8Array): Promise<number>;
    write(offset: number, data: Uint8Array): Promise<void>;
    truncate(size: number): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
/** The parts of a defuss-storage adapter the store uses: MemoryStorage, createFileStorage (Node), createOPFSStorage
 *  (a dedicated worker) and createDirectoryStorage each fit. */
interface ProfileStorage {
    open(name: string, options?: {
        create?: boolean;
        readOnly?: boolean;
    }): Promise<ProfileStorageFile>;
    list(): Promise<string[]>;
    remove(name: string): Promise<boolean>;
}
/** A profile's stored files: its pack (assets) and its module (wasm), as profileSources takes them. */
interface StoredProfileSources {
    assets?: Uint8Array;
    wasm?: Uint8Array;
}
interface ProfileStore {
    /** Stores profile's pack, module or both; a part not given keeps what was stored. Rejects with the adapter's error
     *  (QUOTA_EXCEEDED, UNSUPPORTED where a browser cannot write OPFS files from this thread). */
    save(profile: NativeProfile, sources: {
        assets?: Uint8Array | ArrayBuffer;
        wasm?: Uint8Array | ArrayBuffer;
    }): Promise<void>;
    /** profile's stored files, or undefined when none is stored. A pack whose records do not add up to its size, or a
     *  module WebAssembly.validate refuses, the trace of a save that stopped partway, counts as not stored. */
    load(profile: NativeProfile): Promise<StoredProfileSources | undefined>;
    /** The profiles with a stored file. */
    profiles(): Promise<NativeProfile[]>;
    /** Removes profile's files; resolves whether there were any. */
    remove(profile: NativeProfile): Promise<boolean>;
}
/** A profile store on storage, a defuss-storage adapter (or anything with its open, list and remove). */
declare function createProfileStore(storage: ProfileStorage): ProfileStore;
/** The profile store of this origin's private file system, in its directory defuss-storage/<name>: the directory that
 *  defuss-storage's createOPFSStorage({ name }) uses, so a dedicated worker with that adapter sees the same files. It
 *  goes through the directory adapter because the OPFS adapter needs a dedicated worker's sync access handles, and a
 *  page calls this on its main thread. The two adapters lock files under different names, so they do not exclude each
 *  other: use one of them for a store at a time. VERIFIED (review probe, Chromium 141, 2026-11-25): a page's load read
 *  a file a worker's OPFS adapter held open. Rejects outside a browser with OPFS. */
declare function openProfileStore(name?: string): Promise<ProfileStore>;

export { PROFILE_DESCRIPTORS as i, SYNTH_PROFILES as q, createProfileStore as s, openProfileStore as t };
export type { BankSource as B, EngineOptions as E, FmInfo as F, LoadProgress as L, MidiLoadOptions as M, ProfileSourceMap as P, RenderStats as R, SynthProfile as S, TimedEvent as T, SoundFontSource as a, ProgressListener as b, SynthInfo as c, ProfileSources as d, SynthEvent as e, EngineKind as f, PlaybackInfo as g, MidiMetadata as h, Preset as j, ProfileAvailability as k, ProfileDescriptor as l, ProfileStorage as m, ProfileStorageFile as n, ProfileStore as o, ProfileUserAssets as p, StoredProfileSources as r, PackedEvent as u };
