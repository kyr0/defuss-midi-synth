/** gus-gf1 test helpers: the raw ABI 2 core at its native rate, DSPK/GPAT packing, and a
 * GF1PATCH110 reader and writer after the Gravis UltraSound SDK 2.10 patch format (ULTRADOC.TXT
 * Appendix F). Synthetic patches cover format branches that the original Gravis set lacks
 * (reverse, signed data, layers, overlapping ranges); the original set is tested by
 * scripts/profile-gf1-test.mjs. */
import { readFileSync } from 'node:fs';

export const GUS_MODEL = 6;
/** SDK 2.10 voice rate table, 14 to 32 active voices. */
export const SDK_RATES = [44100, 41160, 38587, 36317, 34300, 32494, 30870, 29400, 28063, 26843, 25725, 24696, 23746, 22866, 22050, 21289, 20580, 19916, 19293];
export const FLAG_16BIT = 1, FLAG_PRELOAD = 2;
export const MODE = { bit16: 1, unsigned: 2, loop: 4, bidir: 8, reverse: 16, sustain: 32, envelope: 64, fastRelease: 128 } as const;

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export function dspack(model: number, records: [number, Uint8Array][]): Buffer {
  return Buffer.concat([Buffer.from('DSPK'), u32(1), u32(model), u32(records.length), ...records.flatMap(([role, data]) => [u32(role), u32(data.length), Buffer.from(data)])]);
}
/** GPAT v1: indexed, unmodified PAT records; index = program 0..127 or 128 + drum note. */
export function gpat(records: [number, Uint8Array][]): Buffer {
  return Buffer.concat([Buffer.from('GPAT'), u32(1), u32(records.length), ...records.flatMap(([i, d]) => [u32(i), u32(d.length), Buffer.from(d)])]);
}
export function gusPack(records: [number, Uint8Array][], voices = 32, flags = 0): Buffer {
  return dspack(GUS_MODEL, [[32, gpat(records)], [33, Uint8Array.from(flags ? [voices, flags] : [voices])]]);
}

export interface PatWave {
  fractions: number; size: number; loopStart: number; loopEnd: number; rate: number;
  low: number; high: number; root: number; tune: number; balance: number;
  rates: number[]; offsets: number[]; tremolo: number[]; vibrato: number[];
  modes: number; scaleNote: number; scaleFactor: number; data: Buffer;
}
export interface Pat { header: string; instruments: number; voices: number; waveForms: number; dataSize: number; layers: PatWave[][] }
/** Reads the first instrument, as the SDK describes the layout. Throws on truncation. */
export function parsePat(b: Buffer): Pat {
  const need = (n: number) => { if (n > b.length) throw new RangeError('truncated PAT'); };
  need(129 + 63);
  const header = b.toString('latin1', 0, 12).split(String.fromCharCode(0))[0]!;
  let off = 129;
  const layerCount = b[off + 22]!; off += 63;
  const layers: PatWave[][] = [];
  for (let j = 0; j < layerCount; j++) {
    need(off + 47);
    const count = b[off + 6]!; off += 47;
    const waves: PatWave[] = [];
    for (let k = 0; k < count; k++) {
      need(off + 96);
      const h = b.subarray(off, off + 96), size = h.readUInt32LE(8); off += 96; need(off + size);
      waves.push({ fractions: h[7]!, size, loopStart: h.readUInt32LE(12), loopEnd: h.readUInt32LE(16), rate: h.readUInt16LE(20),
        low: h.readUInt32LE(22), high: h.readUInt32LE(26), root: h.readUInt32LE(30), tune: h.readInt16LE(34), balance: h[36]!,
        rates: [...h.subarray(37, 43)], offsets: [...h.subarray(43, 49)], tremolo: [...h.subarray(49, 52)], vibrato: [...h.subarray(52, 55)],
        modes: h[55]!, scaleNote: h.readInt16LE(56), scaleFactor: h.readUInt16LE(58), data: b.subarray(off, off + size) });
      off += size;
    }
    layers.push(waves);
  }
  return { header, instruments: b[82]!, voices: b[83]!, waveForms: b.readUInt16LE(85), dataSize: b.readUInt32LE(89), layers };
}
export interface SynthWave { pcm: Int16Array; rate?: number; root?: number; low?: number; high?: number; modes?: number; loop?: [number, number];
  rates?: number[]; offsets?: number[]; balance?: number; scaleNote?: number; scaleFactor?: number; eightBit?: boolean; unsigned?: boolean }
/** Writes a GF1PATCH110 file with one instrument and the given layers. */
export function synthPat(layers: SynthWave[][], header = 'GF1PATCH110'): Buffer {
  const h = Buffer.alloc(129); h.write(header); h.write('ID#000002', 12); h[82] = 1; h[83] = 14;
  const parts: Buffer[] = [h];
  const inst = Buffer.alloc(63); inst[22] = layers.length; parts.push(inst);
  layers.forEach((waves, j) => {
    const l = Buffer.alloc(47); l[1] = j; l[6] = waves.length; parts.push(l);
    for (const w of waves) {
      const wide = !w.eightBit, unsigned = !!w.unsigned, n = w.pcm.length, data = Buffer.alloc(wide ? n * 2 : n);
      for (let i = 0; i < n; i++) {
        if (wide) data.writeUInt16LE(((w.pcm[i]! & 0xffff) ^ (unsigned ? 0x8000 : 0)) & 0xffff, 2 * i);
        else data[i] = ((w.pcm[i]! >> 8) & 0xff) ^ (unsigned ? 0x80 : 0);
      }
      const s = Buffer.alloc(96), unit = wide ? 2 : 1, loop = w.loop ?? [0, n - 1];
      s.writeUInt32LE(data.length, 8); s.writeUInt32LE(loop[0] * unit, 12); s.writeUInt32LE(loop[1] * unit, 16);
      s.writeUInt16LE(w.rate ?? 22050, 20); s.writeUInt32LE(w.low ?? 0, 22); s.writeUInt32LE(w.high ?? 20000000, 26); s.writeUInt32LE(w.root ?? 261626, 30);
      s.writeInt16LE(512, 34); s[36] = w.balance ?? 7;
      Buffer.from(w.rates ?? [63, 63, 63, 63, 63, 63]).copy(s, 37); Buffer.from(w.offsets ?? [246, 246, 246, 8, 8, 8]).copy(s, 43);
      s[55] = (w.modes ?? (MODE.loop | MODE.sustain | MODE.envelope)) | (wide ? MODE.bit16 : 0) | (unsigned ? MODE.unsigned : 0);
      s.writeInt16LE(w.scaleNote ?? 60, 56); s.writeUInt16LE(w.scaleFactor ?? 1024, 58);
      parts.push(s, data);
    }
  });
  return Buffer.concat(parts);
}
export function sine(period: number, frames: number, amplitude = 16000): Int16Array {
  return Int16Array.from({ length: frames }, (_, i) => Math.round(Math.sin(2 * Math.PI * i / period) * amplitude));
}

interface Exports {
  memory: WebAssembly.Memory; profile_abi(): number; profile_model(): number; profile_buffer(n: number): number; profile_init(n: number): number;
  profile_rate(): number; profile_message(s: number, a: number, b: number): number; profile_sysex_buffer(): number; profile_sysex(n: number): number;
  profile_render(n: number): number; profile_voices(): number; profile_close(): void;
}
export const gusModule = () => new WebAssembly.Module(readFileSync(new URL('../vendor/runtime/profiles/gus-gf1.wasm', import.meta.url)));
/** One isolated core instance, rendering at the native GF1 rate (no host resampler). */
export class Core {
  readonly e: Exports;
  readonly ok: boolean;
  constructor(module: WebAssembly.Module, pack: Uint8Array) {
    this.e = new WebAssembly.Instance(module).exports as unknown as Exports;
    const at = this.e.profile_buffer(pack.length) >>> 0;
    if (!at) throw new Error('profile_buffer failed');
    new Uint8Array(this.e.memory.buffer, at, pack.length).set(pack);
    this.ok = this.e.profile_init(pack.length) === 1;
  }
  get rate() { return this.e.profile_rate(); }
  voices() { return this.e.profile_voices(); }
  msg(s: number, a = 0, b = 0) { if (this.e.profile_message(s, a, b) !== 1) throw new Error(`message ${s} rejected`); return this; }
  sysex(bytes: number[]) { new Uint8Array(this.e.memory.buffer, this.e.profile_sysex_buffer() >>> 0, bytes.length).set(bytes); return this.e.profile_sysex(bytes.length); }
  render(frames: number, block = 128) {
    frames = Math.floor(frames);
    const l = new Float32Array(frames), r = new Float32Array(frames);
    for (let at = 0; at < frames; at += block) {
      const n = Math.min(block, frames - at), ptr = this.e.profile_render(n) >>> 0;
      if (!ptr) throw new Error('render failed');
      const out = new Float32Array(this.e.memory.buffer, ptr, 2 * n);
      l.set(out.subarray(0, n), at); r.set(out.subarray(n, 2 * n), at);
    }
    return { l, r };
  }
  close() { this.e.profile_close(); }
}
/** RMS after removing the mean (a constant DC offset is silence). */
export function acRms(x: Float32Array, from = 0, to = x.length): number {
  let m = 0; for (let i = from; i < to; i++) m += x[i]!; m /= Math.max(1, to - from);
  let s = 0; for (let i = from; i < to; i++) s += (x[i]! - m) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}
export const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
/** Fundamental by normalized autocorrelation (difference function, YIN-style) with parabolic refinement. */
export function fundamental(x: Float32Array, rate: number, minHz = 25, maxHz = 4500): number {
  const n = Math.min(x.length, 1 << 14), lo = Math.floor(rate / maxHz), hi = Math.min(Math.ceil(rate / minHz), n >> 1);
  const w = n - hi, d = new Float64Array(hi + 2);
  for (let tau = 1; tau <= hi + 1; tau++) { let s = 0; for (let i = 0; i < w; i++) { const v = x[i]! - x[i + tau]!; s += v * v; } d[tau] = s; }
  const cm = new Float64Array(hi + 2); let run = 0; cm[0] = 1;
  for (let tau = 1; tau <= hi + 1; tau++) { run += d[tau]!; cm[tau] = d[tau]! * tau / (run || 1); }
  let best = -1;
  for (let tau = Math.max(2, lo); tau <= hi; tau++) if (cm[tau]! < 0.15 && cm[tau]! <= cm[tau - 1]! && cm[tau]! <= cm[tau + 1]!) { best = tau; break; }
  if (best < 0) { let m = Infinity; for (let tau = Math.max(2, lo); tau <= hi; tau++) if (cm[tau]! < m) { m = cm[tau]!; best = tau; } }
  const a = cm[best - 1]!, b = cm[best]!, c = cm[best + 1]!, den = a - 2 * b + c;
  return rate / (best + (den > 0 ? (a - c) / (2 * den) : 0));
}
export const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);
export const noteHz = (n: number) => 440 * 2 ** ((n - 69) / 12);
