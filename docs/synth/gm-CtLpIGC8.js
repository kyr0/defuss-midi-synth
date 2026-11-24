const STEP = 4 * 1024 * 1024;
class BrotliDecoder {
  errors = /* @__PURE__ */ new Map();
  nextError = 1;
  wasm;
  constructor(instance) {
    this.wasm = instance.exports;
  }
  /** Instantiates the module from its bytes. */
  static async load(bytes) {
    let decoder;
    const text = (at, length) => new TextDecoder().decode(new Uint8Array(decoder.wasm.memory.buffer, at >>> 0, length));
    const imports = { "./defuss_brotli_decompressor_bg.js": {
      __wbg_Error_83742b46f01ce22d: (at, length) => {
        const id = decoder.nextError++;
        decoder.errors.set(id, new Error(text(at, length)));
        return id;
      },
      __wbg___wbindgen_throw_6ddd609b62940d55: (at, length) => {
        throw new Error(text(at, length));
      }
    } };
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    decoder = new BrotliDecoder(instance);
    return decoder;
  }
  /** Calls fn with a stack slot for a Result and returns its value, or throws its error. */
  result(fn) {
    const w = this.wasm, slot = w.__wbindgen_add_to_stack_pointer(-16);
    try {
      fn(slot);
      const view = new DataView(w.memory.buffer), value = view.getInt32(slot, true), error = view.getInt32(slot + 4, true);
      if (view.getInt32(slot + 8, true)) {
        const thrown = this.errors.get(error) ?? new Error("Brotli decoding failed");
        this.errors.delete(error);
        throw thrown;
      }
      return value >>> 0;
    } finally {
      w.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * Decompresses input (at most max bytes of output). onProgress gets the input consumed and its length after each
   * STEP bytes and at the end; between steps the decoder yields to the event loop, so a page repaints its bar.
   * Truncated or corrupt input and output beyond max throw.
   */
  async decode(input, max, onProgress) {
    const w = this.wasm, handle = this.result((slot) => w.decoder_create(slot, input.length, max));
    try {
      const inputAt = w.decoder_input_ptr(handle), outputAt = w.decoder_output_ptr(handle), capacity = w.decoder_input_capacity(handle);
      const parts = [];
      let read = 0, written = 0, reported = 0;
      do {
        let fed = 0;
        if (w.decoder_needs_input(handle)) {
          fed = Math.min(capacity, input.length - read);
          new Uint8Array(w.memory.buffer, inputAt, fed).set(input.subarray(read, read + fed));
          read += fed;
        }
        const produced = this.result((slot) => w.decoder_decode(slot, handle, fed, read === input.length ? 1 : 0));
        if (produced) {
          parts.push(new Uint8Array(w.memory.buffer, outputAt, produced).slice());
          written += produced;
        }
        if (onProgress && read - reported >= STEP) {
          reported = read;
          onProgress(read, input.length);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } while (!w.decoder_finished(handle));
      onProgress?.(input.length, input.length);
      if (parts.length === 1) return parts[0];
      const out = new Uint8Array(written);
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    } finally {
      w.__wbg_decoder_free(handle, 0);
    }
  }
}

const OP = {
  noteOn: 0,
  noteOff: 1,
  controlChange: 2,
  programChange: 3,
  pitchBend: 4,
  channelPressure: 5,
  polyPressure: 6,
  preset: 7,
  reset: 8
};
const OP_COUNT = 9;
const OPERAND_MAX = 16383;
const MAX_SONG_BYTES = 16 * 1024 * 1024;
const MAX_SOUNDFONT_BYTES = 256 * 1024 * 1024;
const MAX_BANK_BYTES = 8 * 1024 * 1024;
const FM_BANKS = 79;
const MAX_CHIPS = 8;
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}
function finite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
function normalizeOptions(options = {}) {
  return {
    sampleRate: integer(options.sampleRate ?? 48e3, 8e3, 192e3, "sampleRate"),
    maxVoices: integer(options.maxVoices ?? 256, 1, 4096, "maxVoices"),
    engine: engineKind(options.engine ?? "soundfont"),
    chips: integer(options.chips ?? 2, 1, MAX_CHIPS, "chips"),
    fmBank: integer(options.fmBank ?? 0, 0, FM_BANKS - 1, "fmBank")
  };
}
function engineKind(kind) {
  if (kind !== "soundfont" && kind !== "fm") throw new RangeError(`engine must be 'soundfont' or 'fm'`);
  return kind;
}
function packEvent(event, sampleRate) {
  const frame = integer(Math.round(finite(event.time, 0, Number.MAX_SAFE_INTEGER / sampleRate, "event time") * sampleRate), 0, Number.MAX_SAFE_INTEGER, "frame");
  if (event.type === "reset") return [frame, OP.reset, 0, 0, 0];
  const ch = integer(event.channel, 0, 15, "channel");
  switch (event.type) {
    case "noteOn":
      return [frame, OP.noteOn, ch, integer(event.note, 0, 127, "note"), integer(event.velocity, 0, 127, "velocity")];
    case "noteOff":
      return [frame, OP.noteOff, ch, integer(event.note, 0, 127, "note"), 0];
    case "controlChange":
      return [frame, OP.controlChange, ch, integer(event.controller, 0, 127, "controller"), integer(event.value, 0, 127, "value")];
    case "programChange":
      return [frame, OP.programChange, ch, integer(event.program, 0, 127, "program"), 0];
    case "pitchBend":
      return [frame, OP.pitchBend, ch, integer(event.value, 0, 16383, "pitch bend"), 0];
    case "channelPressure":
      return [frame, OP.channelPressure, ch, integer(event.value, 0, 127, "pressure"), 0];
    case "polyPressure":
      return [frame, OP.polyPressure, ch, integer(event.note, 0, 127, "note"), integer(event.value, 0, 127, "pressure")];
    case "preset":
      return [frame, OP.preset, ch, integer(event.bank, 0, OPERAND_MAX, "bank"), integer(event.program, 0, 127, "program")];
    default:
      throw new TypeError("Unknown event type");
  }
}
function inputBytes(data, max, label) {
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new TypeError(`${label} must be a Uint8Array or ArrayBuffer`);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  integer(bytes.byteLength, 1, max, label);
  return bytes;
}

const WASM_ASSET = "assets/midi-synth.wasm";
const FM_WASM_ASSET = "assets/fm-synth.wasm";
const SOUNDFONT_ASSET = "assets/TimGM6mb.sf2.br";
const BROTLI_WASM_ASSET = "assets/brotli-decompressor.wasm";
async function readBytes(url, timeoutMs, onProgress) {
  if (url.protocol === "file:") {
    const host = globalThis.process;
    const fs = host?.getBuiltinModule?.("node:fs/promises");
    if (!fs) throw new Error("Reading a file: URL needs Node.js 22.3 or later, or Bun");
    const bytes2 = new Uint8Array(await fs.readFile(url));
    onProgress?.({ phase: "download", url: url.href, loaded: bytes2.length, total: bytes2.length });
    return bytes2;
  }
  if (onProgress && typeof XMLHttpRequest !== "undefined") return download(url, timeoutMs, onProgress);
  const response = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : void 0);
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status} for ${url.href}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  onProgress?.({ phase: "download", url: url.href, loaded: bytes.length, total: bytes.length });
  return bytes;
}
function download(url, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url.href);
    request.responseType = "arraybuffer";
    if (timeoutMs) request.timeout = timeoutMs;
    request.onprogress = (event) => onProgress({ phase: "download", url: url.href, loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
    request.onload = () => {
      if (request.status < 200 || request.status > 299) {
        reject(new Error(`Fetch failed: HTTP ${request.status} for ${url.href}`));
        return;
      }
      const bytes = new Uint8Array(request.response);
      onProgress({ phase: "download", url: url.href, loaded: bytes.length, total: bytes.length });
      resolve(bytes);
    };
    request.onerror = () => reject(new Error(`Fetch failed: network error for ${url.href}`));
    request.ontimeout = () => reject(new Error(`Fetch failed: no answer within ${timeoutMs} ms for ${url.href}`));
    request.send();
  });
}
async function soundFontBytes(source, base, fallback, timeoutMs, onProgress) {
  const label = source instanceof Uint8Array || source instanceof ArrayBuffer ? "SoundFont" : new URL(source ?? fallback, base).href;
  return unpack(await packedSoundFont(source, base, fallback, timeoutMs, onProgress), "RIFF", MAX_SOUNDFONT_BYTES, base, timeoutMs, onProgress, label);
}
async function packedSoundFont(source, base, fallback, timeoutMs, onProgress) {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return inputBytes(source, MAX_SOUNDFONT_BYTES, "SoundFont length");
  return inputBytes(await readBytes(new URL(source ?? fallback, base), timeoutMs, onProgress), MAX_SOUNDFONT_BYTES, "SoundFont length");
}
async function bankBytes(source, base, timeoutMs, onProgress) {
  const named = !(source instanceof Uint8Array || source instanceof ArrayBuffer);
  const bytes = named ? inputBytes(await readBytes(new URL(source, base), timeoutMs, onProgress), MAX_BANK_BYTES, "bank length") : inputBytes(source, MAX_BANK_BYTES, "bank length");
  return unpack(bytes, "WOPL3-BANK", MAX_BANK_BYTES, base, timeoutMs, onProgress, named ? new URL(source, base).href : "FM bank");
}
let decoder;
function brotli(base, timeoutMs) {
  decoder ??= readBytes(new URL(BROTLI_WASM_ASSET, base), timeoutMs).then((bytes) => BrotliDecoder.load(bytes)).catch((error) => {
    decoder = void 0;
    throw error;
  });
  return decoder;
}
async function unpack(bytes, magic, max, base, timeoutMs, onProgress, label = "") {
  if (bytes.length >= magic.length && [...magic].every((c, i) => bytes[i] === c.charCodeAt(0))) return bytes;
  const brotliDecoder = await brotli(base, timeoutMs);
  const report = onProgress && ((loaded, total) => onProgress({ phase: "decompress", url: label, loaded, total }));
  try {
    return await brotliDecoder.decode(bytes, max, report);
  } catch (error) {
    if (error instanceof Error && error.message.includes("max_output_size")) throw new RangeError(`${label || "File"} decompresses to more than ${max} bytes`);
    return bytes;
  }
}

const MIDI_RESET = 255;
function packMessage(status, data1 = 0, data2 = 0) {
  return (status | data1 << 8 | data2 << 16) >>> 0;
}
function dataBytes(status) {
  const kind = status & 240;
  return kind === 192 || kind === 208 ? 1 : 2;
}
const RESETS = [
  [126, -1, 9, 1],
  [65, -1, 66, 18, 64, 0, 127, 0, 65],
  [67, -1, 76, 0, 0, 126, 0]
];
function isReset(bytes) {
  return RESETS.some((known) => known.length === bytes.length && known.every((value, i) => value < 0 || value === bytes[i]));
}
class MidiParser {
  constructor(message, sysex = () => void 0) {
    this.message = message;
    this.sysex = sysex;
  }
  message;
  sysex;
  status = 0;
  data = [0, 0];
  have = 0;
  skip = 0;
  sysexBytes = null;
  /** Takes byte, which arrived at time. */
  feed(byte, time) {
    if (byte >= 248) {
      this.message(time, byte, 0, 0);
      return;
    }
    if (byte & 128) {
      if (this.sysexBytes) {
        const bytes = Uint8Array.from(this.sysexBytes);
        this.sysexBytes = null;
        if (byte === 247) {
          this.sysex(time, bytes);
          return;
        }
      }
      this.have = 0;
      this.skip = 0;
      if (byte < 240) {
        this.status = byte;
        return;
      }
      this.status = 0;
      if (byte === 240) this.sysexBytes = [];
      else if (byte === 241 || byte === 243) this.skip = 1;
      else if (byte === 242) this.skip = 2;
      return;
    }
    if (this.sysexBytes) {
      if (this.sysexBytes.length < 65536) this.sysexBytes.push(byte);
      return;
    }
    if (this.skip) {
      this.skip--;
      return;
    }
    if (!this.status) return;
    this.data[this.have++] = byte;
    const needed = dataBytes(this.status);
    if (this.have === needed) {
      this.have = 0;
      this.message(time, this.status, this.data[0], needed === 2 ? this.data[1] : 0);
    }
  }
}
function messageEvent(time, status, data1, data2) {
  const channel = status & 15;
  switch (status & 240) {
    case 128:
      return { time, type: "noteOff", channel, note: data1 };
    case 144:
      return { time, type: "noteOn", channel, note: data1, velocity: data2 };
    case 160:
      return { time, type: "polyPressure", channel, note: data1, value: data2 };
    case 176:
      return { time, type: "controlChange", channel, controller: data1, value: data2 };
    case 192:
      return { time, type: "programChange", channel, program: data1 };
    case 208:
      return { time, type: "channelPressure", channel, value: data1 };
    case 224:
      return { time, type: "pitchBend", channel, value: data1 | data2 << 7 };
    default:
      return status === 255 ? { time, type: "reset" } : null;
  }
}
class MidiStream {
  out = [];
  parser = new MidiParser(
    (time, status, data1, data2) => {
      const event = messageEvent(time, status, data1, data2);
      if (event) this.out.push(event);
    },
    (time, bytes) => {
      if (isReset(bytes)) this.out.push({ time, type: "reset" });
    }
  );
  /** The events that bytes (each an integer from 0 to 255) complete, all at time. Every byte is checked before any is
   *  fed. VERIFIED: tests/core.test.ts shows a rejected call then leaks no events and no running status into the next. */
  events(bytes, time) {
    for (let i = 0; i < bytes.length; i++) integer(bytes[i], 0, 255, "MIDI byte");
    for (let i = 0; i < bytes.length; i++) this.parser.feed(bytes[i], time);
    const out = this.out;
    this.out = [];
    return out;
  }
}

const GM_PROGRAMS = [
  "Acoustic Grand Piano",
  "Bright Acoustic Piano",
  "Electric Grand Piano",
  "Honky-tonk Piano",
  "Electric Piano 1",
  "Electric Piano 2",
  "Harpsichord",
  "Clavi",
  "Celesta",
  "Glockenspiel",
  "Music Box",
  "Vibraphone",
  "Marimba",
  "Xylophone",
  "Tubular Bells",
  "Dulcimer",
  "Drawbar Organ",
  "Percussive Organ",
  "Rock Organ",
  "Church Organ",
  "Reed Organ",
  "Accordion",
  "Harmonica",
  "Tango Accordion",
  "Acoustic Guitar (nylon)",
  "Acoustic Guitar (steel)",
  "Electric Guitar (jazz)",
  "Electric Guitar (clean)",
  "Electric Guitar (muted)",
  "Overdriven Guitar",
  "Distortion Guitar",
  "Guitar Harmonics",
  "Acoustic Bass",
  "Electric Bass (finger)",
  "Electric Bass (pick)",
  "Fretless Bass",
  "Slap Bass 1",
  "Slap Bass 2",
  "Synth Bass 1",
  "Synth Bass 2",
  "Violin",
  "Viola",
  "Cello",
  "Contrabass",
  "Tremolo Strings",
  "Pizzicato Strings",
  "Orchestral Harp",
  "Timpani",
  "String Ensemble 1",
  "String Ensemble 2",
  "SynthStrings 1",
  "SynthStrings 2",
  "Choir Aahs",
  "Voice Oohs",
  "Synth Voice",
  "Orchestra Hit",
  "Trumpet",
  "Trombone",
  "Tuba",
  "Muted Trumpet",
  "French Horn",
  "Brass Section",
  "SynthBrass 1",
  "SynthBrass 2",
  "Soprano Sax",
  "Alto Sax",
  "Tenor Sax",
  "Baritone Sax",
  "Oboe",
  "English Horn",
  "Bassoon",
  "Clarinet",
  "Piccolo",
  "Flute",
  "Recorder",
  "Pan Flute",
  "Blown Bottle",
  "Shakuhachi",
  "Whistle",
  "Ocarina",
  "Lead 1 (square)",
  "Lead 2 (sawtooth)",
  "Lead 3 (calliope)",
  "Lead 4 (chiff)",
  "Lead 5 (charang)",
  "Lead 6 (voice)",
  "Lead 7 (fifths)",
  "Lead 8 (bass + lead)",
  "Pad 1 (new age)",
  "Pad 2 (warm)",
  "Pad 3 (polysynth)",
  "Pad 4 (choir)",
  "Pad 5 (bowed)",
  "Pad 6 (metallic)",
  "Pad 7 (halo)",
  "Pad 8 (sweep)",
  "FX 1 (rain)",
  "FX 2 (soundtrack)",
  "FX 3 (crystal)",
  "FX 4 (atmosphere)",
  "FX 5 (brightness)",
  "FX 6 (goblins)",
  "FX 7 (echoes)",
  "FX 8 (sci-fi)",
  "Sitar",
  "Banjo",
  "Shamisen",
  "Koto",
  "Kalimba",
  "Bag pipe",
  "Fiddle",
  "Shanai",
  "Tinkle Bell",
  "Agogo",
  "Steel Drums",
  "Woodblock",
  "Taiko Drum",
  "Melodic Tom",
  "Synth Drum",
  "Reverse Cymbal",
  "Guitar Fret Noise",
  "Breath Noise",
  "Seashore",
  "Bird Tweet",
  "Telephone Ring",
  "Helicopter",
  "Applause",
  "Gunshot"
];

export { FM_WASM_ASSET as F, GM_PROGRAMS as G, MidiStream as M, OPERAND_MAX as O, SOUNDFONT_ASSET as S, WASM_ASSET as W, inputBytes as a, bankBytes as b, MAX_SONG_BYTES as c, MidiParser as d, engineKind as e, finite as f, isReset as g, dataBytes as h, integer as i, packMessage as j, MIDI_RESET as k, MAX_BANK_BYTES as l, MAX_SOUNDFONT_BYTES as m, normalizeOptions as n, OP as o, packEvent as p, OP_COUNT as q, readBytes as r, soundFontBytes as s };
