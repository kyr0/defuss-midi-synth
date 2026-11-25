/** Stable hardware model identifiers. 'fm' remains a legacy multi-chip OPL3 engine. VERIFIED: tests/profiles.test.ts
 *  checks the ten unique ids and that prototype keys such as '__proto__' are no profile. */
export const SYNTH_PROFILES = ['soundfont', 'sb16-opl3', 'sb16-cqm', 'awe32', 'awe64', 'sb-pci128', 'gus-gf1', 'roland-sc55', 'roland-sc55mk2', 'roland-mt32'] as const;
export type SynthProfile = typeof SYNTH_PROFILES[number];
export type NativeProfile = Exclude<SynthProfile, 'soundfont' | 'sb16-opl3'>;
/** A native profile's module or pack: a URL (relative to baseUrl) or its bytes. */
export type ProfileSource = string | URL | Uint8Array | ArrayBuffer;
/** wasm replaces the package's module (a local build, such as AWE's); assets is the DSPK pack
 *  (native/profiles/profile_pack.h) of the user's own ROMs, wavesets or patches, which the package never ships. */
export interface ProfileSources { wasm?: ProfileSource; assets?: ProfileSource }
/** The sources of each native profile, as profileSources and useProfile take them. */
export type ProfileSourceMap = Partial<Record<NativeProfile, ProfileSources>>;
/** Whether the package ships the profile's core: 'bundled' cores are in dist/assets/profiles (or built in), the others
 *  must be built (scripts/build-native-profiles.py) and supplied as profileSources[id].wasm. */
export type ProfileAvailability = 'bundled' | 'build-required' | 'local-build-required';
/** What the user supplies as profileSources[id].assets: 'none', an 'optional' bank, or 'required' private assets
 *  (ROMs, a waveset, a patch set), without which the profile rejects. A profile plays without user assets exactly when
 *  its core is bundled and userAssets is not 'required'. */
export type ProfileUserAssets = 'none' | 'optional' | 'required';
export interface ProfileDescriptor {
  readonly id: number;
  readonly label: string;
  readonly technology: string;
  readonly availability: ProfileAvailability;
  readonly userAssets: ProfileUserAssets;
  readonly maxVoices: number;
}
/** Each profile's model id (profile_model), label, core, whether the package ships its core, and whether it needs the
 *  user's files: a page offers as playable only what is bundled and needs no 'required' assets. */
export const PROFILE_DESCRIPTORS: Readonly<Record<SynthProfile, ProfileDescriptor>> = Object.freeze({
  soundfont: Object.freeze({ id: 0, label: 'General MIDI SoundFont', technology: 'TinySoundFont / SF2', availability: 'bundled', userAssets: 'none', maxVoices: 256 }),
  'sb16-opl3': Object.freeze({ id: 1, label: 'Sound Blaster 16 (Yamaha OPL3)', technology: 'Single YMF262 / libADLMIDI', availability: 'bundled', userAssets: 'none', maxVoices: 18 }),
  'sb16-cqm': Object.freeze({ id: 2, label: 'Sound Blaster 16 (Creative CQM)', technology: 'Nuked CQM / libADLMIDI', availability: 'bundled', userAssets: 'optional', maxVoices: 18 }),
  awe32: Object.freeze({ id: 3, label: 'Sound Blaster AWE32', technology: 'EMU8000 / AWE32Emu', availability: 'local-build-required', userAssets: 'required', maxVoices: 32 }),
  awe64: Object.freeze({ id: 4, label: 'Sound Blaster AWE64 (hardware voices)', technology: 'EMU8000 / AWE32Emu', availability: 'local-build-required', userAssets: 'required', maxVoices: 32 }),
  'sb-pci128': Object.freeze({ id: 5, label: 'Sound Blaster PCI 128', technology: 'AudioPCI ECW reconstruction (experimental)', availability: 'bundled', userAssets: 'required', maxVoices: 64 }),
  'gus-gf1': Object.freeze({ id: 6, label: 'Gravis UltraSound (GF1)', technology: 'GUSEMU32 GF1 / PAT driver (experimental)', availability: 'bundled', userAssets: 'required', maxVoices: 32 }),
  'roland-sc55': Object.freeze({ id: 7, label: 'Roland SC-55', technology: 'SoundCarcass / original firmware', availability: 'bundled', userAssets: 'required', maxVoices: 24 }),
  'roland-sc55mk2': Object.freeze({ id: 8, label: 'Roland SC-55mkII', technology: 'SoundCarcass / original firmware', availability: 'bundled', userAssets: 'required', maxVoices: 28 }),
  'roland-mt32': Object.freeze({ id: 9, label: 'Roland MT-32', technology: 'Munt / LA synthesis', availability: 'bundled', userAssets: 'required', maxVoices: 32 }),
});
/** Whether value names a profile; an own key only, so '__proto__' and 'constructor' are none. */
export function isSynthProfile(value: unknown): value is SynthProfile {
  return typeof value === 'string' && Object.hasOwn(PROFILE_DESCRIPTORS, value);
}
/** Whether value names a profile that runs in its own native module (all but the SoundFont and the one-OPL3 FM engine). */
export function isNativeProfile(value: unknown): value is NativeProfile {
  return isSynthProfile(value) && value !== 'soundfont' && value !== 'sb16-opl3';
}
/** The profile sources with sources for profile, given to useProfile: a native profile's pack (and module) you supply
 *  after the synth exists, such as ROMs a user picks in a page. They apply when the profile loads; a profile loaded
 *  or loading keeps what it has, so another pack takes a new synth. */
export function withProfileSources(map: ProfileSourceMap | undefined, profile: SynthProfile, sources: ProfileSources, busy: boolean): ProfileSourceMap {
  if (!isNativeProfile(profile)) throw new RangeError(`The ${profile} profile takes no profile sources`);
  if (busy) throw new Error(`The ${profile} profile is loaded; its sources apply to a new synth`);
  return { ...map, [profile]: { ...map?.[profile], ...sources } };
}
/** Prevent contradictory legacy/profile selection instead of silently choosing one. */
export function selectEngine(engine: SynthProfile | 'fm' | undefined, profile: SynthProfile | undefined): SynthProfile | 'fm' | undefined {
  if (profile !== undefined && !isSynthProfile(profile)) throw new RangeError('Unknown synth profile');
  if (engine !== undefined && profile !== undefined && engine !== profile) throw new RangeError('engine and profile disagree');
  return profile ?? engine;
}
