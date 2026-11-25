import { readBytes } from './assets.ts';
import { MAX_PROFILE_ASSET_BYTES } from './profile-voices.ts';
import { type NativeProfile, type ProfileSource, type ProfileSourceMap } from './profiles.ts';
import type { ProgressListener } from './types.ts';
export interface NativePart { kind: NativeProfile; wasm?: ArrayBuffer; module?: WebAssembly.Module; assets: ArrayBuffer }
async function bytes(source: ProfileSource, base: URL, limit: number, timeout?: number, progress?: ProgressListener): Promise<ArrayBuffer> {
  const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source instanceof Uint8Array ? source : await readBytes(new URL(source, base), timeout, progress);
  if (!data.length || data.length > limit) throw new RangeError('Invalid profile asset length');
  return data.slice().buffer as ArrayBuffer;
}
export async function nativePart(kind: NativeProfile, base: URL, sources: ProfileSourceMap | undefined, compile: boolean, timeout?: number, progress?: ProgressListener): Promise<NativePart> {
  const override = sources?.[kind];
  const stem = `assets/profiles/${kind}`;
  const [wasm, assets] = await Promise.all([
    bytes(override?.wasm ?? `${stem}.wasm`, base, 64 * 1024 * 1024, timeout, progress),
    kind === 'sb16-cqm' && !override?.assets ? Promise.resolve(new ArrayBuffer(0)) : bytes(override?.assets ?? `${stem}.dspack`, base, MAX_PROFILE_ASSET_BYTES, timeout, progress),
  ]);
  return compile ? { kind, module: await WebAssembly.compile(wasm), assets } : { kind, wasm, assets };
}
