import { FM_WASM_ASSET, readBytes, WASM_ASSET } from './assets.ts';
import { MAX_PROFILE_ASSET_BYTES } from './profile-voices.ts';
import { PROFILE_DESCRIPTORS, type NativeProfile, type ProfileSource, type ProfileSourceMap } from './profiles.ts';
import type { EngineKind, ProgressListener } from './types.ts';
/** A native profile's module (compiled, as bytes, or neither when the worklet holds it under key) and its DSPK pack. */
export interface NativePart { kind: NativeProfile; key: string; wasm?: ArrayBuffer; module?: WebAssembly.Module; assets: ArrayBuffer }
/** An engine's module as the worklet takes it: compiled in the processor's options, as bytes in a later message, or
 *  by key alone when the worklet compiled that module before (moduleKey); with the SoundFont for the soundfont engine
 *  and the pack for a native profile. Chrome delivers a WebAssembly.Module in processorOptions but not through the
 *  node's port (the processor never receives that message). */
export type EnginePart = NativePart | { kind: 'soundfont' | 'fm' | 'sb16-opl3'; key: string; module?: WebAssembly.Module; wasm?: ArrayBuffer; soundfont?: ArrayBuffer };
const MAX_PROFILE_WASM_BYTES = 64 * 1024 * 1024;

/** The module an engine runs on, as a key: 'fm' and 'sb16-opl3' share fm-synth.wasm, so a synthesizer that holds one
 *  compiles it once for both. */
export function moduleKey(kind: EngineKind): string {
  return kind === 'fm' || kind === 'sb16-opl3' ? FM_WASM_ASSET : kind === 'soundfont' ? WASM_ASSET : `assets/profiles/${kind}.wasm`;
}
async function bytes(source: ProfileSource, base: URL, limit: number, timeout?: number, progress?: ProgressListener, read = readBytes): Promise<ArrayBuffer> {
  const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source instanceof Uint8Array ? source : await read(new URL(source, base), timeout, progress);
  if (!data.length || data.length > limit) throw new RangeError(`its length must be 1 to ${limit} bytes, not ${data.length}`);
  // A copy of exactly these bytes: Node's Buffer.slice is a view, so slice().buffer can be a whole pooled ArrayBuffer.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}
/** The error of a profile whose module or pack did not load: which profile, which file, why, and what makes it
 *  available, so no caller mistakes it for another engine's failure or falls back silently. */
function unavailable(kind: NativeProfile, what: 'module' | 'asset pack', error: unknown): Error {
  const d = PROFILE_DESCRIPTORS[kind];
  const hint = what === 'asset pack' ? ` Supply its DSPK pack as profileSources['${kind}'].assets (scripts/profile-assets.py packs one).`
    : d.availability === 'bundled' ? '' : d.availability === 'build-required' ? ` It is not bundled: build it with scripts/build-native-profiles.py and supply it as profileSources['${kind}'].wasm.`
      : ` It builds only locally (scripts/build-native-profiles.py --local-awe) and is supplied as profileSources['${kind}'].wasm.`;
  return new Error(`The ${kind} profile (${d.label}) is unavailable: its ${what} did not load: ${error instanceof Error ? error.message : String(error)}.${hint}`, { cause: error });
}
/** The module (unless withWasm is false: the caller holds it) and the DSPK pack of a native profile, from
 *  profileSources or the package's assets/profiles/<kind>.wasm; compile makes the module here. sb16-cqm needs no pack.
 *  The package ships no pack and no local-only module, so a profile whose pack is the user's (userAssets 'required')
 *  or whose module is a local build fails without a request when profileSources lacks it. Any failure is an Error
 *  naming the profile and the file. VERIFIED: scripts/e2e.mjs, which fails on any failed request or HTTP error,
 *  asks for roland-mt32 without a pack and gets the error naming it; tests/profiles.test.ts checks what it needs. */
export async function nativePart(kind: NativeProfile, base: URL, sources: ProfileSourceMap | undefined, compile: boolean, timeout?: number, progress?: ProgressListener, withWasm = true, readWasm = readBytes): Promise<NativePart> {
  const override = sources?.[kind], d = PROFILE_DESCRIPTORS[kind];
  const stem = `assets/profiles/${kind}`, key = moduleKey(kind);
  const none = (what: string) => Promise.reject(new Error(`no ${what} was given, and the package has none`));
  const wasmSource = override?.wasm ?? (d.availability === 'local-build-required' ? undefined : `${stem}.wasm`);
  // Both settle before either reports, so a missing module, the more basic gap, names the error whichever ends first.
  const [module, pack] = await Promise.allSettled([
    withWasm ? wasmSource === undefined ? none('local build') : bytes(wasmSource, base, MAX_PROFILE_WASM_BYTES, timeout, progress, readWasm) : undefined,
    override?.assets ? bytes(override.assets, base, MAX_PROFILE_ASSET_BYTES, timeout, progress) : d.userAssets === 'required' ? none('pack of your files') : new ArrayBuffer(0),
  ]);
  if (module.status === 'rejected') throw unavailable(kind, 'module', module.reason);
  if (pack.status === 'rejected') throw unavailable(kind, 'asset pack', pack.reason);
  const wasm = module.value, assets = pack.value;
  if (!wasm) return { kind, key, assets };
  if (!compile) return { kind, key, wasm, assets };
  try { return { kind, key, module: await WebAssembly.compile(wasm), assets }; }
  catch (error) { throw unavailable(kind, 'module', error); }
}
