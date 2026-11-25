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
/** Load the requested native profile. Explicit sources override the package defaults independently. */
export async function nativePart(kind: NativeProfile, base: URL, sources: ProfileSourceMap | undefined, compile: boolean, timeout?: number, progress?: ProgressListener, withWasm = true, readWasm = readBytes): Promise<NativePart> {
  const override = sources?.[kind], d = PROFILE_DESCRIPTORS[kind];
  const stem = `assets/profiles/${kind}`, key = moduleKey(kind);
  const wasmSource = override?.wasm ?? (d.availability === 'local-build-required' ? undefined : `${stem}.wasm`);
  if (withWasm && wasmSource === undefined) throw unavailable(kind, 'module', new Error('no local build was given'));
  // CQM embeds its default FM bank in the core. Other optional packs live beside their core.
  const packSource = override?.assets ?? (kind !== 'sb16-cqm' ? `${stem}.dspack` : undefined);
  // Both settle before either reports, so a missing module, the more basic gap, names the error whichever ends first.
  const [module, pack] = await Promise.allSettled([
    withWasm && wasmSource !== undefined ? bytes(wasmSource, base, MAX_PROFILE_WASM_BYTES, timeout, progress, readWasm) : undefined,
    packSource !== undefined ? bytes(packSource, base, MAX_PROFILE_ASSET_BYTES, timeout, progress) : new ArrayBuffer(0),
  ]);
  if (module.status === 'rejected') throw unavailable(kind, 'module', module.reason);
  if (pack.status === 'rejected') throw unavailable(kind, 'asset pack', pack.reason);
  const wasm = module.value, assets = pack.value;
  if (!wasm) return { kind, key, assets };
  if (!compile) return { kind, key, wasm, assets };
  try { return { kind, key, module: await WebAssembly.compile(wasm), assets }; }
  catch (error) { throw unavailable(kind, 'module', error); }
}
