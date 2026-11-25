import { GM_PROGRAMS } from './gm.ts';
import { NativeClock } from './profile-clock.ts';
import { PROFILE_DESCRIPTORS, type NativeProfile } from './profiles.ts';
import type { Preset } from './types.ts';
import type { Voices } from './voices.ts';

interface ProfileExports {
  memory: WebAssembly.Memory;
  _initialize?(): void;
  profile_abi(): number;
  profile_model(): number;
  profile_buffer(bytes: number): number;
  profile_init(bytes: number): number;
  profile_rate(): number;
  profile_message(status: number, a: number, b: number): number;
  profile_render(n: number): number;
  profile_voices(): number;
  profile_close(): void;
}
export const MAX_PROFILE_ASSET_BYTES = 128 * 1024 * 1024;
const REQUIRED = ['profile_abi', 'profile_model', 'profile_buffer', 'profile_init', 'profile_rate', 'profile_message', 'profile_render', 'profile_voices', 'profile_close'] as const;
/** One module instance per physical synth. All native modules use the same audited, no-host-I/O ABI. */
export class NativeProfileVoices implements Voices {
  readonly name: string;
  private readonly w: ProfileExports;
  private readonly clock: NativeClock;
  private closed = false;
  private readonly list: Preset[];
  private readonly voiceLimit: number;
  private view?: Float32Array;
  constructor(readonly kind: NativeProfile, instance: WebAssembly.Instance, asset: Uint8Array, outputRate: number) {
    const desc = PROFILE_DESCRIPTORS[kind];
    this.name = desc.label;
    const w = instance.exports as unknown as ProfileExports;
    if (!(w.memory instanceof WebAssembly.Memory) || REQUIRED.some(k => typeof w[k] !== 'function')) throw new Error('Invalid native synth ABI exports');
    this.w = w;
    w._initialize?.();
    if (w.profile_abi() !== 1 || w.profile_model() !== desc.id) throw new Error(`WASM ABI/model mismatch for ${kind}`);
    if (asset.byteLength > MAX_PROFILE_ASSET_BYTES) throw new RangeError('Profile asset too large');
    try {
      if (asset.byteLength) {
        const at = w.profile_buffer(asset.byteLength) >>> 0;
        if (!at || at + asset.byteLength > w.memory.buffer.byteLength) throw new Error('Profile allocation failed');
        new Uint8Array(w.memory.buffer, at, asset.byteLength).set(asset);
      }
      if (w.profile_init(asset.byteLength) !== 1) throw new Error(`Invalid/missing assets or initialization failed for ${kind}`);
      this.clock = new NativeClock(w.profile_rate(), outputRate);
      this.voiceLimit = kind === 'gus-gf1' ? Math.round(617400 / w.profile_rate()) : desc.maxVoices;
    } catch (e) { w.profile_close(); throw e; }
    // MT-32 is not GM. Numeric names are intentional; no fictitious GM patch mapping.
    this.list = Array.from({ length: 128 }, (_, program) => ({ bank: 0, program, name: kind === 'roland-mt32' ? `MT-32 patch ${program + 1}` : GM_PROGRAMS[program]! }));
    if (kind !== 'roland-mt32') this.list.push({ bank: 128, program: 0, name: 'Percussion' });
  }
  presets(): Preset[] { return this.list.map(p => ({ ...p })); }
  maxVoices(): number { return this.voiceLimit; }
  voices(): number { return this.w.profile_voices(); } // -1: not exposed by the chip API
  message(status: number, data1: number, data2: number): void {
    if (this.closed) throw new Error('Profile is closed');
    if (this.w.profile_message(status, data1, data2) !== 1) throw new Error(`${this.kind}: MIDI rejected or queue full`);
  }
  setPreset(channel: number, bank: number, program: number): boolean {
    if (!this.list.some(p => p.bank === bank && p.program === program) || (bank === 128 && channel !== 9)) return false;
    if (this.kind !== 'roland-mt32' && bank === 0) {
      this.message(0xb0 | channel, 0, 0); this.message(0xb0 | channel, 32, 0);
    }
    this.message(0xc0 | channel, program, 0); return true;
  }
  private readonly pull = (l: Float32Array, r: Float32Array, n: number): void => {
    const ptr = this.w.profile_render(n) >>> 0, mem = this.w.memory.buffer;
    if (!ptr || ptr % 4 || ptr + n * 8 > mem.byteLength) throw new Error('Native synth returned invalid PCM pointer');
    if (!this.view || this.view.buffer !== mem || this.view.byteOffset !== ptr || this.view.length < n * 2) this.view = new Float32Array(mem, ptr, Math.min(256, (mem.byteLength - ptr) / 4));
    const v = this.view;
    for (let i = 0; i < n; i++) { l[i] = v[i]!; r[i] = v[n + i]!; }
  };
  render(left: Float32Array, right: Float32Array, at: number, n: number): void {
    if (this.closed) throw new Error('Profile is closed');
    this.clock.render(left, right, at, n, this.pull);
  }
  close(): void { if (!this.closed) { this.closed = true; this.w.profile_close(); } }
}

/** Emscripten standalone reactors may import a small WASI libc surface. Never expose host files or environment. */
export function instantiateProfile(module: WebAssembly.Module): WebAssembly.Instance {
  let memory: WebAssembly.Memory | undefined;
  const data = (): DataView => {
    if (!memory) throw new Error('Native profile must be a reactor without a start function');
    return new DataView(memory.buffer);
  };
  const wasi = {
    proc_exit: (code: number): never => { throw new Error(`Native profile exited (${code})`); },
    environ_sizes_get: (count: number, size: number): number => { const d = data(); d.setUint32(count, 0, true); d.setUint32(size, 0, true); return 0; },
    environ_get: (): number => 0,
    fd_close: (): number => 8, // EBADF: no host file descriptors
    fd_seek: (): number => 70, // ESPIPE
    fd_write: (fd: number, iovs: number, count: number, written: number): number => {
      if (fd !== 1 && fd !== 2) return 8;
      const d = data(); let total = 0;
      if (count < 0 || count > 4096 || iovs < 0 || iovs + 8 * count > d.byteLength || written < 0 || written + 4 > d.byteLength) return 21;
      for (let i = 0; i < count; i++) {
        const p = d.getUint32(iovs + 8 * i, true), n = d.getUint32(iovs + 8 * i + 4, true);
        if (p + n > d.byteLength || total + n > 0xffffffff) return 21;
        total += n;
      }
      d.setUint32(written, total, true); return 0; // sink diagnostic output only
    },
  };
  const imports = { env: { emscripten_notify_memory_growth: () => undefined }, wasi_snapshot_preview1: wasi };
  for (const entry of WebAssembly.Module.imports(module)) {
    const ns = (imports as unknown as Record<string, Record<string, unknown>>)[entry.module];
    if (entry.kind !== 'function' || !ns || !Object.hasOwn(ns, entry.name)) throw new Error(`Unsupported profile import ${entry.module}.${entry.name}`);
  }
  const instance = new WebAssembly.Instance(module, imports);
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Profile exports no memory');
  memory = instance.exports.memory;
  return instance;
}
