import { BrotliDecoder } from './brotli.ts';
import { inputBytes, MAX_BANK_BYTES, MAX_SOUNDFONT_BYTES, type ProgressListener } from './types.ts';

/** The served file names beside the package's JavaScript. */
export const WASM_ASSET = 'assets/midi-synth.wasm';
export const FM_WASM_ASSET = 'assets/fm-synth.wasm';
export const SOUNDFONT_ASSET = 'assets/TimGM6mb.sf2.br';
export const BROTLI_WASM_ASSET = 'assets/brotli-decompressor.wasm';

/** A SoundFont 2 file, plain or Brotli-compressed: its bytes, or a URL resolved against the package's asset directory. */
export type SoundFontSource = string | URL | ArrayBuffer | Uint8Array;
/** A WOPL bank file for the FM engine, plain or Brotli-compressed: its bytes, or a URL resolved against the package's
 *  asset directory. */
export type BankSource = string | URL | ArrayBuffer | Uint8Array;

interface FileSystem { readFile(path: URL): Promise<Uint8Array> }

/** Reads the bytes at url: file: URLs through the file system of Node.js (22.3 or later) or Bun, other URLs through
 *  fetch. process.getBuiltinModule needs no import statement, so browser bundles of this module stay free of Node.
 *  onProgress hears the download (total 0 while the server sends no length): step by step where XMLHttpRequest exists,
 *  else once at its end. */
export async function readBytes(url: URL, timeoutMs?: number, onProgress?: ProgressListener): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const fs = host?.getBuiltinModule?.('node:fs/promises') as FileSystem | undefined;
    if (!fs) throw new Error('Reading a file: URL needs Node.js 22.3 or later, or Bun');
    const bytes = new Uint8Array(await fs.readFile(url));
    onProgress?.({ phase: 'download', url: url.href, loaded: bytes.length, total: bytes.length });
    return bytes;
  }
  if (onProgress && typeof XMLHttpRequest !== 'undefined') return download(url, timeoutMs, onProgress);
  const response = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status} for ${url.href}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  onProgress?.({ phase: 'download', url: url.href, loaded: bytes.length, total: bytes.length });
  return bytes;
}
/** A download with progress events. Not fetch: Chromium reports a fetch whose body a stream reader reads to its end as
 *  canceled when it completes (a probe of 2026-11-24 under throttling: 6 of 6; arrayBuffer() and XMLHttpRequest 0). */
function download(url: URL, timeoutMs: number | undefined, onProgress: ProgressListener): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url.href);
    request.responseType = 'arraybuffer';
    if (timeoutMs) request.timeout = timeoutMs;
    request.onprogress = event => onProgress({ phase: 'download', url: url.href, loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
    request.onload = () => {
      if (request.status < 200 || request.status > 299) { reject(new Error(`Fetch failed: HTTP ${request.status} for ${url.href}`)); return; }
      const bytes = new Uint8Array(request.response as ArrayBuffer);
      onProgress({ phase: 'download', url: url.href, loaded: bytes.length, total: bytes.length });
      resolve(bytes);
    };
    request.onerror = () => reject(new Error(`Fetch failed: network error for ${url.href}`));
    request.ontimeout = () => reject(new Error(`Fetch failed: no answer within ${timeoutMs} ms for ${url.href}`));
    request.send();
  });
}

/** The bytes of source, read relative to base when it names a file; the package's TimGM6mb.sf2.br when undefined. */
export async function soundFontBytes(source: SoundFontSource | undefined, base: URL, fallback: string, timeoutMs?: number, onProgress?: ProgressListener): Promise<Uint8Array> {
  const label = source instanceof Uint8Array || source instanceof ArrayBuffer ? 'SoundFont' : new URL(source ?? fallback, base).href;
  return unpack(await packedSoundFont(source, base, fallback, timeoutMs, onProgress), 'RIFF', MAX_SOUNDFONT_BYTES, base, timeoutMs, onProgress, label);
}
async function packedSoundFont(source: SoundFontSource | undefined, base: URL, fallback: string, timeoutMs?: number, onProgress?: ProgressListener): Promise<Uint8Array> {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return inputBytes(source, MAX_SOUNDFONT_BYTES, 'SoundFont length');
  return inputBytes(await readBytes(new URL(source ?? fallback, base), timeoutMs, onProgress), MAX_SOUNDFONT_BYTES, 'SoundFont length');
}

/** The bytes of a WOPL bank file, read relative to base when it names a file. */
export async function bankBytes(source: BankSource, base: URL, timeoutMs?: number, onProgress?: ProgressListener): Promise<Uint8Array> {
  const named = !(source instanceof Uint8Array || source instanceof ArrayBuffer);
  const bytes = named ? inputBytes(await readBytes(new URL(source, base), timeoutMs, onProgress), MAX_BANK_BYTES, 'bank length')
    : inputBytes(source, MAX_BANK_BYTES, 'bank length');
  return unpack(bytes, 'WOPL3-BANK', MAX_BANK_BYTES, base, timeoutMs, onProgress, named ? new URL(source, base).href : 'FM bank');
}

let decoder: Promise<BrotliDecoder> | undefined;
/** The Brotli decoder (src/brotli.ts), loaded on first use with its WebAssembly from base's assets; a failed load is
 *  retried. */
function brotli(base: URL, timeoutMs?: number): Promise<BrotliDecoder> {
  decoder ??= readBytes(new URL(BROTLI_WASM_ASSET, base), timeoutMs).then(bytes => BrotliDecoder.load(bytes))
    .catch(error => { decoder = undefined; throw error; });
  return decoder;
}
/** bytes as they are when they start with magic (a SoundFont's RIFF, a WOPL file's signature), else Brotli-decompressed
 *  up to max bytes, with onProgress hearing the decompression of label. Bytes that are neither stay as they are, so the
 *  synthesizer's own check names the error. */
export async function unpack(bytes: Uint8Array, magic: string, max: number, base: URL, timeoutMs?: number, onProgress?: ProgressListener, label = ''): Promise<Uint8Array> {
  if (bytes.length >= magic.length && [...magic].every((c, i) => bytes[i] === c.charCodeAt(0))) return bytes;
  const brotliDecoder = await brotli(base, timeoutMs);
  const report = onProgress && ((loaded: number, total: number) => onProgress({ phase: 'decompress', url: label, loaded, total }));
  try { return await brotliDecoder.decode(bytes, max, report); } catch { return bytes; }
}
