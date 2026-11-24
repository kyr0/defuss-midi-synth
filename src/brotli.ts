/*
 * A Brotli decoder that reports its progress and yields between steps, over the decompressor.wasm of defuss-brotli
 * 0.4.0 (shipped as assets/brotli-decompressor.wasm). The calls into the module follow the JavaScript that
 * wasm-bindgen generated for that version (dist/decompressor-slim.js), whose one-shot decompress() reports nothing
 * and holds the thread until the end.
 *
 * Copyright (c) 2026 Aron Homberg (defuss-brotli). MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
 * notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** The exports of defuss-brotli 0.4.0's decompressor.wasm. A Result comes back through three i32 at a stack slot:
 *  the value, the error's handle, and 1 when it is an error. */
interface DecoderExports {
  memory: WebAssembly.Memory;
  __wbindgen_add_to_stack_pointer(delta: number): number;
  decoder_create(ret: number, inputLength: number, maxOutput: number): void;
  decoder_decode(ret: number, decoder: number, inputBytes: number, last: number): void;
  decoder_finished(decoder: number): number;
  decoder_input_capacity(decoder: number): number;
  decoder_input_ptr(decoder: number): number;
  decoder_needs_input(decoder: number): number;
  decoder_output_ptr(decoder: number): number;
  __wbg_decoder_free(decoder: number, flag: number): void;
}

/** Bytes between two progress reports and yields: often enough for a smooth bar, rarely enough to cost nothing. */
const STEP = 4 * 1024 * 1024;

/** A decoder module: its exports and the errors it hands to JavaScript by handle. */
export class BrotliDecoder {
  private readonly errors = new Map<number, Error>();
  private nextError = 1;
  private readonly wasm: DecoderExports;
  private constructor(instance: WebAssembly.Instance) { this.wasm = instance.exports as unknown as DecoderExports; }
  /** Instantiates the module from its bytes. */
  static async load(bytes: Uint8Array): Promise<BrotliDecoder> {
    let decoder: BrotliDecoder | undefined;
    const text = (at: number, length: number) => new TextDecoder().decode(new Uint8Array(decoder!.wasm.memory.buffer, at >>> 0, length));
    const imports = { './defuss_brotli_decompressor_bg.js': {
      __wbg_Error_83742b46f01ce22d: (at: number, length: number) => { const id = decoder!.nextError++; decoder!.errors.set(id, new Error(text(at, length))); return id; },
      __wbg___wbindgen_throw_6ddd609b62940d55: (at: number, length: number) => { throw new Error(text(at, length)); },
    } };
    const { instance } = await WebAssembly.instantiate(bytes as Uint8Array<ArrayBuffer>, imports);
    decoder = new BrotliDecoder(instance);
    return decoder;
  }
  /** Calls fn with a stack slot for a Result and returns its value, or throws its error. */
  private result(fn: (slot: number) => void): number {
    const w = this.wasm, slot = w.__wbindgen_add_to_stack_pointer(-16);
    try {
      fn(slot);
      const view = new DataView(w.memory.buffer), value = view.getInt32(slot, true), error = view.getInt32(slot + 4, true);
      if (view.getInt32(slot + 8, true)) {
        const thrown = this.errors.get(error) ?? new Error('Brotli decoding failed');
        this.errors.delete(error);
        throw thrown;
      }
      return value >>> 0;
    } finally { w.__wbindgen_add_to_stack_pointer(16); }
  }
  /**
   * Decompresses input (at most max bytes of output). onProgress gets the input consumed and its length after each
   * STEP bytes and at the end; between steps the decoder yields to the event loop, so a page repaints its bar.
   * Truncated or corrupt input and output beyond max throw.
   */
  async decode(input: Uint8Array, max: number, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    const w = this.wasm, handle = this.result(slot => w.decoder_create(slot, input.length, max));
    try {
      const inputAt = w.decoder_input_ptr(handle), outputAt = w.decoder_output_ptr(handle), capacity = w.decoder_input_capacity(handle);
      const parts: Uint8Array[] = [];
      let read = 0, written = 0, reported = 0;
      do {
        let fed = 0;
        if (w.decoder_needs_input(handle)) {
          fed = Math.min(capacity, input.length - read);
          new Uint8Array(w.memory.buffer, inputAt, fed).set(input.subarray(read, read + fed));
          read += fed;
        }
        const produced = this.result(slot => w.decoder_decode(slot, handle, fed, read === input.length ? 1 : 0));
        if (produced) { parts.push(new Uint8Array(w.memory.buffer, outputAt, produced).slice()); written += produced; }
        if (onProgress && read - reported >= STEP) {
          reported = read; onProgress(read, input.length);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } while (!w.decoder_finished(handle));
      onProgress?.(input.length, input.length);
      if (parts.length === 1) return parts[0]!;
      const out = new Uint8Array(written);
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    } finally { w.__wbg_decoder_free(handle, 0); }
  }
}
