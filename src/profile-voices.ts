/* The host of every native profile: one class drives ten cores through one ABI (native/profiles/profile_pack.h), each
 * core a WebAssembly reactor of its own with no imports beyond a diagnostics sink. The plausible alternative, each
 * emulator's own Emscripten JavaScript glue, would put ten loaders, file systems and memory models in the worklet;
 * this ABI keeps the worklet one renderer and lets a core touch nothing but its memory and the bytes it is given. */
import { GM_PROGRAMS } from './gm.ts';
import { NativeClock } from './profile-clock.ts';
import { soundCanvasPresets } from './profile-presets.ts';
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
  profile_sysex_buffer(): number;
  profile_sysex(bytes: number): number;
  profile_render(n: number): number;
  profile_voices(): number;
  profile_close(): void;
  /** Optional (the Sound Canvas cores): why the last profile_init failed. */
  profile_init_error?(): number;
}
/** profile_init_error's codes (native/profiles/roland_sc.c). */
const INIT_ERRORS = ['', 'the pack is malformed or of another model', 'a ROM role is missing or not expected', 'a ROM has the wrong size',
  'a ROM fails its CRC32 (another revision, or a bad dump)', 'the core ran out of memory', 'the firmware did not boot'];
export const MAX_PROFILE_ASSET_BYTES = 128 * 1024 * 1024;
/** The native ABI of native/profiles/profile_pack.h; SysEx messages up to PROFILE_SYSEX_MAX bytes. */
export const PROFILE_ABI = 2, PROFILE_SYSEX_MAX = 65536;
/** A DSPK v1 pack (profile_pack.h) of model with records [role, bytes]. */
export function dspk(model: number, records: readonly (readonly [number, Uint8Array])[]): Uint8Array {
  const size = 16 + records.reduce((n, [, data]) => n + 8 + data.length, 0), out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([0x44, 0x53, 0x50, 0x4b]); v.setUint32(4, 1, true); v.setUint32(8, model, true); v.setUint32(12, records.length, true);
  let at = 16;
  for (const [role, data] of records) { v.setUint32(at, role, true); v.setUint32(at + 4, data.length, true); out.set(data, at + 8); at += 8 + data.length; }
  return out;
}
/** The sb16-cqm pack that plays libADLMIDI's embedded bank (native/profiles/cqm.cpp: role 33, u32 LE bank number). */
export function cqmBankPack(bank: number): Uint8Array {
  const number = new Uint8Array(4);
  new DataView(number.buffer).setUint32(0, bank, true);
  return dspk(PROFILE_DESCRIPTORS['sb16-cqm'].id, [[33, number]]);
}
/** The embedded bank of an sb16-cqm pack: its role 33 record, else -1 (a WOPL bank, role 32). */
function cqmBank(pack: Uint8Array): number {
  const v = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  for (let at = 16; at + 8 <= pack.length; at += 8 + v.getUint32(at + 4, true)) {
    if (v.getUint32(at, true) === 33 && v.getUint32(at + 4, true) === 4 && at + 12 <= pack.length) return v.getUint32(at + 8, true);
  }
  return -1;
}
const REQUIRED = ['profile_abi', 'profile_model', 'profile_buffer', 'profile_init', 'profile_rate', 'profile_message', 'profile_sysex_buffer', 'profile_sysex', 'profile_render', 'profile_voices', 'profile_close'] as const;
/** One module instance per physical synth. All native modules use the same audited, no-host-I/O ABI.
 *  VERIFIED: tests/native-profile-abi.test.ts rejects a module with any other import or without an exported memory. */
export class NativeProfileVoices implements Voices {
  readonly name: string;
  private readonly w: ProfileExports;
  private readonly clock: NativeClock;
  private closed = false;
  private readonly list: Preset[];
  private readonly voiceLimit: number;
  private view?: Float32Array;
  private heap?: Uint8Array;
  /** Messages and SysEx the core could not take (profile_message or profile_sysex 0): the host sends only valid ones,
   *  so they are input a core's queue had no room for, such as the Sound Canvas cores' 16 KiB MIDI IN at 3,125 bytes
   *  per second. They are dropped as a MIDI receiver drops what overflows it, instead of stopping the synthesizer. */
  dropped = 0;
  /** sb16-cqm: the embedded bank it plays (banks.ini's number), -1 for a WOPL bank; -1 on the other profiles. */
  bank = -1;
  /** The pack the core runs on, kept to restore it when a bank change fails. */
  private asset: Uint8Array;
  /** fmBank: the embedded bank an sb16-cqm without a pack of its own plays, as the FM engine's option selects it. */
  constructor(readonly kind: NativeProfile, instance: WebAssembly.Instance, asset: Uint8Array, outputRate: number, fmBank = 0) {
    const desc = PROFILE_DESCRIPTORS[kind];
    this.name = desc.label;
    const w = instance.exports as unknown as ProfileExports;
    if (!(w.memory instanceof WebAssembly.Memory) || REQUIRED.some(k => typeof w[k] !== 'function')) throw new Error('Invalid native synth ABI exports');
    this.w = w;
    w._initialize?.();
    if (w.profile_abi() !== PROFILE_ABI || w.profile_model() !== desc.id) throw new Error(`WASM ABI/model mismatch for ${kind}`);
    if (asset.byteLength > MAX_PROFILE_ASSET_BYTES) throw new RangeError('Profile asset too large');
    if (kind === 'sb16-cqm') { if (!asset.byteLength) asset = cqmBankPack(fmBank); this.bank = cqmBank(asset); }
    this.asset = kind === 'sb16-cqm' ? asset : new Uint8Array(0);
    try {
      this.init(asset);
      this.clock = new NativeClock(w.profile_rate(), outputRate);
      this.voiceLimit = kind === 'gus-gf1' ? Math.round(617400 / w.profile_rate()) : desc.maxVoices;
    } catch (e) { w.profile_close(); throw e; }
    // MT-32 is not GM. Numeric names are intentional; no fictitious GM patch mapping. The Sound Canvas units list their
    // GS tones on their variation banks and their drum sets on bank 128 (src/profile-presets.ts).
    if (kind === 'roland-sc55' || kind === 'roland-sc55mk2') this.list = soundCanvasPresets(kind);
    else {
      this.list = Array.from({ length: 128 }, (_, program) => ({ bank: 0, program, name: kind === 'roland-mt32' ? `MT-32 patch ${program + 1}` : GM_PROGRAMS[program]! }));
      if (kind !== 'roland-mt32') this.list.push({ bank: 128, program: 0, name: 'Percussion' });
    }
  }
  /** Copies asset into the core and initializes it; an Error names why it failed. */
  private init(asset: Uint8Array): void {
    const w = this.w;
    if (asset.byteLength) {
      const at = w.profile_buffer(asset.byteLength) >>> 0;
      if (!at || at + asset.byteLength > w.memory.buffer.byteLength) throw new Error('Profile allocation failed');
      new Uint8Array(w.memory.buffer, at, asset.byteLength).set(asset);
    }
    if (w.profile_init(asset.byteLength) !== 1) {
      const reason = INIT_ERRORS[w.profile_init_error?.() ?? 0];
      throw new Error(`Invalid/missing assets or initialization failed for ${this.kind}${reason ? `: ${reason}` : ''}`);
    }
  }
  /** sb16-cqm: starts the core again on pack, at its power-on state; a pack it rejects restores the one before. */
  private reload(pack: Uint8Array): void {
    if (this.closed) throw new Error('Profile is closed');
    if (this.kind !== 'sb16-cqm') throw new Error(`The ${this.kind} profile has no FM bank`);
    this.w.profile_close();
    try { this.init(pack); }
    catch (error) { this.w.profile_close(); this.init(this.asset); throw error; }
    this.asset = pack; this.bank = cqmBank(pack);
  }
  /** sb16-cqm: plays libADLMIDI's embedded bank (banks.ini's number), as FmVoices.setBank does. */
  setBank(bank: number): void { this.reload(cqmBankPack(bank)); }
  /** sb16-cqm: plays the instruments of a WOPL bank file (role 32); a file the core rejects keeps the bank. */
  loadBank(data: Uint8Array): void { this.reload(dspk(PROFILE_DESCRIPTORS['sb16-cqm'].id, [[32, data]])); }
  presets(): Preset[] { return this.list.map(p => ({ ...p })); }
  maxVoices(): number { return this.voiceLimit; }
  voices(): number { return this.closed ? 0 : this.w.profile_voices(); } // -1: not exposed by the chip API
  message(status: number, data1: number, data2: number): void {
    if (this.closed) throw new Error('Profile is closed');
    if (this.w.profile_message(status, data1, data2) !== 1) this.dropped++;
  }
  /** One SysEx message, F0 through F7, of length bytes at offset in bytes; the core applies it or deliberately ignores
   *  it (profile_sysex 1), and resets on the GM, GM2, GS and XG resets itself; 0 (malformed, or no room) counts in
   *  dropped. Allocates nothing once the memory stopped growing. */
  sysex(bytes: Uint8Array, offset = 0, length = bytes.length - offset): void {
    if (this.closed) throw new Error('Profile is closed');
    if (!Number.isSafeInteger(length) || length < 2 || length > PROFILE_SYSEX_MAX || offset < 0 || offset + length > bytes.length) throw new RangeError('SysEx message length out of range');
    const at = this.w.profile_sysex_buffer() >>> 0;
    if (!this.heap || this.heap.buffer !== this.w.memory.buffer) this.heap = new Uint8Array(this.w.memory.buffer);
    const heap = this.heap;
    if (!at || at + length > heap.length) throw new Error('Native synth returned an invalid SysEx buffer');
    for (let i = 0; i < length; i++) heap[at + i] = bytes[offset + i]!;
    if (this.w.profile_sysex(length) !== 1) this.dropped++;
  }
  /** A preset of presets(): bank 128 (drums) on channel 10 by program change; any other bank as bank select (CC0 the
   *  bank, CC32 0; a Sound Canvas variation bank too) and program change. The MT-32 ignores bank select and gets the
   *  program change alone, on the channel given: its parts listen on channels 2 to 9 and its rhythm on 10. */
  setPreset(channel: number, bank: number, program: number): boolean {
    if (!this.list.some(p => p.bank === bank && p.program === program) || (bank === 128 && channel !== 9)) return false;
    if (this.kind !== 'roland-mt32' && bank !== 128) {
      this.message(0xb0 | channel, 0, bank); this.message(0xb0 | channel, 32, 0);
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
