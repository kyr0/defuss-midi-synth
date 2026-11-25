/** Stable hardware model identifiers. 'fm' remains a legacy multi-chip OPL3 engine. */
export const SYNTH_PROFILES = ['soundfont', 'sb16-opl3', 'sb16-cqm', 'awe32', 'awe64', 'sb-pci128', 'gus-gf1', 'roland-sc55', 'roland-sc55mk2', 'roland-mt32'] as const;
export type SynthProfile = typeof SYNTH_PROFILES[number];
export type NativeProfile = Exclude<SynthProfile, 'soundfont' | 'sb16-opl3'>;
export type ProfileSource = string | URL | Uint8Array | ArrayBuffer;
export interface ProfileSources { wasm?: ProfileSource; assets?: ProfileSource }
export type ProfileSourceMap = Partial<Record<NativeProfile, ProfileSources>>;
export type ProfileAvailability = 'bundled' | 'build-required' | 'local-build-required';
export interface ProfileDescriptor {
  readonly id: number;
  readonly label: string;
  readonly technology: string;
  readonly availability: ProfileAvailability;
  readonly maxVoices: number;
}
export const PROFILE_DESCRIPTORS: Readonly<Record<SynthProfile, ProfileDescriptor>> = Object.freeze({
  soundfont: Object.freeze({ id: 0, label: 'General MIDI SoundFont', technology: 'TinySoundFont / SF2', availability: 'bundled', maxVoices: 256 }),
  'sb16-opl3': Object.freeze({ id: 1, label: 'Sound Blaster 16 (Yamaha OPL3)', technology: 'Single YMF262 / libADLMIDI', availability: 'bundled', maxVoices: 18 }),
  'sb16-cqm': Object.freeze({ id: 2, label: 'Sound Blaster 16 (Creative CQM)', technology: 'Nuked CQM / libADLMIDI', availability: 'build-required', maxVoices: 18 }),
  awe32: Object.freeze({ id: 3, label: 'Sound Blaster AWE32', technology: 'EMU8000 / AWE32Emu', availability: 'local-build-required', maxVoices: 32 }),
  awe64: Object.freeze({ id: 4, label: 'Sound Blaster AWE64 (hardware voices)', technology: 'EMU8000 / AWE32Emu', availability: 'local-build-required', maxVoices: 32 }),
  'sb-pci128': Object.freeze({ id: 5, label: 'Sound Blaster PCI 128', technology: 'AudioPCI ECW reconstruction (experimental)', availability: 'bundled', maxVoices: 64 }),
  'gus-gf1': Object.freeze({ id: 6, label: 'Gravis UltraSound (GF1)', technology: 'GUSEMU32 GF1 / PAT driver (experimental)', availability: 'bundled', maxVoices: 32 }),
  'roland-sc55': Object.freeze({ id: 7, label: 'Roland SC-55', technology: 'SoundCarcass / original firmware', availability: 'build-required', maxVoices: 24 }),
  'roland-sc55mk2': Object.freeze({ id: 8, label: 'Roland SC-55mkII', technology: 'SoundCarcass / original firmware', availability: 'build-required', maxVoices: 28 }),
  'roland-mt32': Object.freeze({ id: 9, label: 'Roland MT-32', technology: 'Munt / LA synthesis', availability: 'build-required', maxVoices: 32 }),
});
export function isSynthProfile(value: unknown): value is SynthProfile {
  return typeof value === 'string' && Object.hasOwn(PROFILE_DESCRIPTORS, value);
}
export function isNativeProfile(value: unknown): value is NativeProfile {
  return isSynthProfile(value) && value !== 'soundfont' && value !== 'sb16-opl3';
}
/** Prevent contradictory legacy/profile selection instead of silently choosing one. */
export function selectEngine(engine: SynthProfile | 'fm' | undefined, profile: SynthProfile | undefined): SynthProfile | 'fm' | undefined {
  if (profile !== undefined && !isSynthProfile(profile)) throw new RangeError('Unknown synth profile');
  if (engine !== undefined && profile !== undefined && engine !== profile) throw new RangeError('engine and profile disagree');
  return profile ?? engine;
}
