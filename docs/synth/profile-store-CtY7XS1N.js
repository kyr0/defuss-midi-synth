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

const SYNTH_PROFILES = ["soundfont", "sb16-opl3", "sb16-cqm", "awe32", "awe64", "sb-pci128", "gus-gf1"];
const PROFILE_DESCRIPTORS = Object.freeze({
  soundfont: Object.freeze({ id: 0, label: "General MIDI SoundFont", technology: "TinySoundFont / SF2", availability: "bundled", userAssets: "none", maxVoices: 256 }),
  "sb16-opl3": Object.freeze({ id: 1, label: "Sound Blaster 16 (Yamaha OPL3)", technology: "Single YMF262 / libADLMIDI", availability: "bundled", userAssets: "none", maxVoices: 18 }),
  "sb16-cqm": Object.freeze({ id: 2, label: "Sound Blaster 16 (Creative CQM)", technology: "Nuked CQM / libADLMIDI", availability: "bundled", userAssets: "optional", maxVoices: 18 }),
  awe32: Object.freeze({ id: 3, label: "Sound Blaster AWE32", technology: "EMU8000 / AWE32Emu", availability: "local-build-required", userAssets: "optional", maxVoices: 32 }),
  awe64: Object.freeze({ id: 4, label: "Sound Blaster AWE64 (hardware voices)", technology: "EMU8000 / AWE32Emu", availability: "local-build-required", userAssets: "optional", maxVoices: 32 }),
  "sb-pci128": Object.freeze({ id: 5, label: "Sound Blaster PCI 128", technology: "AudioPCI ECW reconstruction (experimental)", availability: "bundled", userAssets: "optional", maxVoices: 64 }),
  "gus-gf1": Object.freeze({ id: 6, label: "Gravis UltraSound (GF1)", technology: "GUSEMU32 GF1 / PAT driver (experimental)", availability: "bundled", userAssets: "optional", maxVoices: 32 })
});
function isSynthProfile(value) {
  return typeof value === "string" && Object.hasOwn(PROFILE_DESCRIPTORS, value);
}
function isNativeProfile(value) {
  return isSynthProfile(value) && value !== "soundfont" && value !== "sb16-opl3";
}
function withProfileSources(map, profile, sources, loading) {
  if (!isNativeProfile(profile)) throw new RangeError(`The ${profile} profile takes no profile sources`);
  if (loading) throw new Error(`The ${profile} profile is loading; give its sources once it has loaded`);
  return { ...map, [profile]: { ...map?.[profile], ...sources } };
}
function selectEngine(engine, profile) {
  if (profile !== void 0 && !isSynthProfile(profile)) throw new RangeError("Unknown synth profile");
  if (engine !== void 0 && profile !== void 0 && engine !== profile) throw new RangeError("engine and profile disagree");
  return profile ?? engine;
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
  reset: 8,
  sysex: 9
};
const OP_COUNT = 10;
const SYSEX_MAX = 65536;
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
  if (kind !== "fm" && !isSynthProfile(kind)) throw new RangeError("Unknown synthesizer engine");
  return kind;
}
function isSysEx(bytes, offset = 0, length = bytes.length - offset) {
  if (!Number.isSafeInteger(length) || length < 2 || length > SYSEX_MAX || bytes[offset] !== 240 || bytes[offset + length - 1] !== 247) return false;
  for (let i = offset + 1; i < offset + length - 1; i++) {
    const b = bytes[i];
    if (!Number.isInteger(b) || b < 0 || b > 127) return false;
  }
  return true;
}
function sysexBytes(data) {
  if (!(data instanceof Uint8Array) && !Array.isArray(data)) throw new TypeError("SysEx data must be a Uint8Array or an array of bytes");
  if (!isSysEx(data)) throw new RangeError(`SysEx data must be one message F0 .. F7 of 2 to ${SYSEX_MAX} bytes with data bytes below 80h`);
  return Uint8Array.from(data);
}
function packEvent(event, sampleRate, payloads) {
  const frame = integer(Math.round(finite(event.time, 0, Number.MAX_SAFE_INTEGER / sampleRate, "event time") * sampleRate), 0, Number.MAX_SAFE_INTEGER, "frame");
  if (event.type === "reset") return [frame, OP.reset, 0, 0, 0];
  if (event.type === "sysex") {
    if (!payloads) throw new TypeError("A sysex event needs a payload list");
    return [frame, OP.sysex, payloads.push(sysexBytes(event.data)) - 1, 0, 0];
  }
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

class NativeClock {
  constructor(nativeRate, outputRate) {
    this.nativeRate = nativeRate;
    this.outputRate = outputRate;
    if (!Number.isSafeInteger(nativeRate) || nativeRate < 8e3 || nativeRate > 192e3 || !Number.isSafeInteger(outputRate) || outputRate < 8e3 || outputRate > 192e3) throw new RangeError("Invalid PCM clock");
  }
  nativeRate;
  outputRate;
  phase = 0;
  pl = 0;
  pr = 0;
  cl = 0;
  cr = 0;
  l = new Float32Array(128);
  r = new Float32Array(128);
  render(left, right, offset, frames, pull) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 128 || !Number.isInteger(offset) || offset < 0 || offset + frames > Math.min(left.length, right.length)) throw new RangeError("Invalid render range");
    let remaining = Math.floor((this.phase + frames * this.nativeRate) / this.outputRate);
    let at = 0, count = 0;
    for (let i = 0; i < frames; i++) {
      this.phase += this.nativeRate;
      while (this.phase >= this.outputRate) {
        this.phase -= this.outputRate;
        if (at === count) {
          count = Math.min(128, remaining);
          pull(this.l, this.r, count);
          remaining -= count;
          at = 0;
        }
        this.pl = this.cl;
        this.pr = this.cr;
        this.cl = this.l[at];
        this.cr = this.r[at++];
      }
      const f = this.phase / this.outputRate;
      left[offset + i] = this.pl + (this.cl - this.pl) * f;
      right[offset + i] = this.pr + (this.cr - this.pr) * f;
    }
  }
  reset() {
    this.phase = 0;
    this.pl = this.pr = this.cl = this.cr = 0;
  }
}

const MAX_PROFILE_ASSET_BYTES = 128 * 1024 * 1024;
const PROFILE_ABI = 2, PROFILE_SYSEX_MAX = 65536;
function dspk(model, records) {
  const size = 16 + records.reduce((n, [, data]) => n + 8 + data.length, 0), out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([68, 83, 80, 75]);
  v.setUint32(4, 1, true);
  v.setUint32(8, model, true);
  v.setUint32(12, records.length, true);
  let at = 16;
  for (const [role, data] of records) {
    v.setUint32(at, role, true);
    v.setUint32(at + 4, data.length, true);
    out.set(data, at + 8);
    at += 8 + data.length;
  }
  return out;
}
function cqmBankPack(bank) {
  const number = new Uint8Array(4);
  new DataView(number.buffer).setUint32(0, bank, true);
  return dspk(PROFILE_DESCRIPTORS["sb16-cqm"].id, [[33, number]]);
}
function cqmBank(pack) {
  const v = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  for (let at = 16; at + 8 <= pack.length; at += 8 + v.getUint32(at + 4, true)) {
    if (v.getUint32(at, true) === 33 && v.getUint32(at + 4, true) === 4 && at + 12 <= pack.length) return v.getUint32(at + 8, true);
  }
  return -1;
}
const REQUIRED = ["profile_abi", "profile_model", "profile_buffer", "profile_init", "profile_rate", "profile_message", "profile_sysex_buffer", "profile_sysex", "profile_render", "profile_voices", "profile_close"];
class NativeProfileVoices {
  /** fmBank: the embedded bank an sb16-cqm without a pack of its own plays, as the FM engine's option selects it. */
  constructor(kind, instance, asset, outputRate, fmBank = 0) {
    this.kind = kind;
    const desc = PROFILE_DESCRIPTORS[kind];
    this.name = desc.label;
    const w = instance.exports;
    if (!(w.memory instanceof WebAssembly.Memory) || REQUIRED.some((k) => typeof w[k] !== "function")) throw new Error("Invalid native synth ABI exports");
    this.w = w;
    w._initialize?.();
    if (w.profile_abi() !== PROFILE_ABI || w.profile_model() !== desc.id) throw new Error(`WASM ABI/model mismatch for ${kind}`);
    if (asset.byteLength > MAX_PROFILE_ASSET_BYTES) throw new RangeError("Profile asset too large");
    if (kind === "sb16-cqm") {
      if (!asset.byteLength) asset = cqmBankPack(fmBank);
      this.bank = cqmBank(asset);
    }
    this.asset = kind === "sb16-cqm" ? asset : new Uint8Array(0);
    try {
      this.init(asset);
      this.clock = new NativeClock(w.profile_rate(), outputRate);
      this.voiceLimit = kind === "gus-gf1" ? Math.round(617400 / w.profile_rate()) : desc.maxVoices;
    } catch (e) {
      w.profile_close();
      throw e;
    }
    this.list = GM_PROGRAMS.map((name, program) => ({ bank: 0, program, name }));
    this.list.push({ bank: 128, program: 0, name: "Percussion" });
  }
  kind;
  name;
  w;
  clock;
  closed = false;
  list;
  voiceLimit;
  view;
  heap;
  /** Messages rejected by the core since initialization. */
  dropped = 0;
  /** sb16-cqm: the embedded bank it plays (banks.ini's number), -1 for a WOPL bank; -1 on the other profiles. */
  bank = -1;
  /** The pack the core runs on, kept to restore it when a bank change fails. */
  asset;
  /** Copies asset into the core and initializes it; an Error names why it failed. */
  init(asset) {
    const w = this.w;
    if (asset.byteLength) {
      const at = w.profile_buffer(asset.byteLength) >>> 0;
      if (!at || at + asset.byteLength > w.memory.buffer.byteLength) throw new Error("Profile allocation failed");
      new Uint8Array(w.memory.buffer, at, asset.byteLength).set(asset);
    }
    if (w.profile_init(asset.byteLength) !== 1) {
      throw new Error(`Invalid/missing assets or initialization failed for ${this.kind}`);
    }
  }
  /** sb16-cqm: starts the core again on pack, at its power-on state; a pack it rejects restores the one before. */
  reload(pack) {
    if (this.closed) throw new Error("Profile is closed");
    if (this.kind !== "sb16-cqm") throw new Error(`The ${this.kind} profile has no FM bank`);
    this.w.profile_close();
    try {
      this.init(pack);
    } catch (error) {
      this.w.profile_close();
      this.init(this.asset);
      throw error;
    }
    this.asset = pack;
    this.bank = cqmBank(pack);
  }
  /** sb16-cqm: plays libADLMIDI's embedded bank (banks.ini's number), as FmVoices.setBank does. */
  setBank(bank) {
    this.reload(cqmBankPack(bank));
  }
  /** sb16-cqm: plays the instruments of a WOPL bank file (role 32); a file the core rejects keeps the bank. */
  loadBank(data) {
    this.reload(dspk(PROFILE_DESCRIPTORS["sb16-cqm"].id, [[32, data]]));
  }
  presets() {
    return this.list.map((p) => ({ ...p }));
  }
  maxVoices() {
    return this.voiceLimit;
  }
  voices() {
    return this.closed ? 0 : this.w.profile_voices();
  }
  // -1: not exposed by the chip API
  message(status, data1, data2) {
    if (this.closed) throw new Error("Profile is closed");
    if (this.w.profile_message(status, data1, data2) !== 1) this.dropped++;
  }
  /** One SysEx message, F0 through F7, of length bytes at offset in bytes; the core applies it or deliberately ignores
   *  it (profile_sysex 1), and resets on the GM, GM2, GS and XG resets itself; 0 (malformed, or no room) counts in
   *  dropped. Allocates nothing once the memory stopped growing. */
  sysex(bytes, offset = 0, length = bytes.length - offset) {
    if (this.closed) throw new Error("Profile is closed");
    if (!Number.isSafeInteger(length) || length < 2 || length > PROFILE_SYSEX_MAX || offset < 0 || offset + length > bytes.length) throw new RangeError("SysEx message length out of range");
    const at = this.w.profile_sysex_buffer() >>> 0;
    if (!this.heap || this.heap.buffer !== this.w.memory.buffer) this.heap = new Uint8Array(this.w.memory.buffer);
    const heap = this.heap;
    if (!at || at + length > heap.length) throw new Error("Native synth returned an invalid SysEx buffer");
    for (let i = 0; i < length; i++) heap[at + i] = bytes[offset + i];
    if (this.w.profile_sysex(length) !== 1) this.dropped++;
  }
  setPreset(channel, bank, program) {
    if (!this.list.some((p) => p.bank === bank && p.program === program) || bank === 128 && channel !== 9) return false;
    if (bank !== 128) {
      this.message(176 | channel, 0, bank);
      this.message(176 | channel, 32, 0);
    }
    this.message(192 | channel, program, 0);
    return true;
  }
  pull = (l, r, n) => {
    const ptr = this.w.profile_render(n) >>> 0, mem = this.w.memory.buffer;
    if (!ptr || ptr % 4 || ptr + n * 8 > mem.byteLength) throw new Error("Native synth returned invalid PCM pointer");
    if (!this.view || this.view.buffer !== mem || this.view.byteOffset !== ptr || this.view.length < n * 2) this.view = new Float32Array(mem, ptr, Math.min(256, (mem.byteLength - ptr) / 4));
    const v = this.view;
    for (let i = 0; i < n; i++) {
      l[i] = v[i];
      r[i] = v[n + i];
    }
  };
  render(left, right, at, n) {
    if (this.closed) throw new Error("Profile is closed");
    this.clock.render(left, right, at, n, this.pull);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.w.profile_close();
    }
  }
}
function instantiateProfile(module) {
  let memory;
  const data = () => {
    if (!memory) throw new Error("Native profile must be a reactor without a start function");
    return new DataView(memory.buffer);
  };
  const wasi = {
    proc_exit: (code) => {
      throw new Error(`Native profile exited (${code})`);
    },
    environ_sizes_get: (count, size) => {
      const d = data();
      d.setUint32(count, 0, true);
      d.setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    fd_close: () => 8,
    // EBADF: no host file descriptors
    fd_seek: () => 70,
    // ESPIPE
    fd_write: (fd, iovs, count, written) => {
      if (fd !== 1 && fd !== 2) return 8;
      const d = data();
      let total = 0;
      if (count < 0 || count > 4096 || iovs < 0 || iovs + 8 * count > d.byteLength || written < 0 || written + 4 > d.byteLength) return 21;
      for (let i = 0; i < count; i++) {
        const p = d.getUint32(iovs + 8 * i, true), n = d.getUint32(iovs + 8 * i + 4, true);
        if (p + n > d.byteLength || total + n > 4294967295) return 21;
        total += n;
      }
      d.setUint32(written, total, true);
      return 0;
    }
  };
  const imports = { env: { emscripten_notify_memory_growth: () => void 0 }, wasi_snapshot_preview1: wasi };
  for (const entry of WebAssembly.Module.imports(module)) {
    const ns = imports[entry.module];
    if (entry.kind !== "function" || !ns || !Object.hasOwn(ns, entry.name)) throw new Error(`Unsupported profile import ${entry.module}.${entry.name}`);
  }
  const instance = new WebAssembly.Instance(module, imports);
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error("Profile exports no memory");
  memory = instance.exports.memory;
  return instance;
}

const MAX_PROFILE_WASM_BYTES = 64 * 1024 * 1024;
function moduleKey(kind) {
  return kind === "fm" || kind === "sb16-opl3" ? FM_WASM_ASSET : kind === "soundfont" ? WASM_ASSET : `assets/profiles/${kind}.wasm`;
}
async function bytes$1(source, base, limit, timeout, progress, read = readBytes) {
  const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source instanceof Uint8Array ? source : await read(new URL(source, base), timeout, progress);
  if (!data.length || data.length > limit) throw new RangeError(`its length must be 1 to ${limit} bytes, not ${data.length}`);
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}
function unavailable(kind, what, error) {
  const d = PROFILE_DESCRIPTORS[kind];
  const hint = what === "asset pack" ? ` Supply its DSPK pack as profileSources['${kind}'].assets (scripts/profile-assets.py packs one).` : d.availability === "bundled" ? "" : d.availability === "build-required" ? ` It is not bundled: build it with scripts/build-native-profiles.py and supply it as profileSources['${kind}'].wasm.` : ` It builds only locally (scripts/build-native-profiles.py --local-awe) and is supplied as profileSources['${kind}'].wasm.`;
  return new Error(`The ${kind} profile (${d.label}) is unavailable: its ${what} did not load: ${error instanceof Error ? error.message : String(error)}.${hint}`, { cause: error });
}
async function nativePart(kind, base, sources, compile, timeout, progress, withWasm = true, readWasm = readBytes) {
  const override = sources?.[kind], d = PROFILE_DESCRIPTORS[kind];
  const stem = `assets/profiles/${kind}`, key = moduleKey(kind);
  const wasmSource = override?.wasm ?? (d.availability === "local-build-required" ? void 0 : `${stem}.wasm`);
  if (withWasm && wasmSource === void 0) throw unavailable(kind, "module", new Error("no local build was given"));
  const packSource = override?.assets ?? (kind !== "sb16-cqm" ? `${stem}.dspack` : void 0);
  const [module, pack] = await Promise.allSettled([
    withWasm && wasmSource !== void 0 ? bytes$1(wasmSource, base, MAX_PROFILE_WASM_BYTES, timeout, progress, readWasm) : void 0,
    packSource !== void 0 ? bytes$1(packSource, base, MAX_PROFILE_ASSET_BYTES, timeout, progress) : new ArrayBuffer(0)
  ]);
  if (module.status === "rejected") throw unavailable(kind, "module", module.reason);
  if (pack.status === "rejected") throw unavailable(kind, "asset pack", pack.reason);
  const wasm = module.value, assets = pack.value;
  if (!wasm) return { kind, key, assets };
  if (!compile) return { kind, key, wasm, assets };
  try {
    return { kind, key, module: await WebAssembly.compile(wasm), assets };
  } catch (error) {
    throw unavailable(kind, "module", error);
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
  [126, -1, 9, 3],
  [65, -1, 66, 18, 64, 0, 127, 0, 65],
  [67, -1, 76, 0, 0, 126, 0]
];
function matchesReset(bytes, offset, length) {
  next: for (const known of RESETS) {
    if (known.length !== length) continue;
    for (let i = 0; i < length; i++) if (known[i] >= 0 && known[i] !== bytes[offset + i]) continue next;
    return true;
  }
  return false;
}
function isReset(bytes) {
  return matchesReset(bytes, 0, bytes.length);
}
function isResetMessage(bytes, offset, length) {
  return length >= 2 && bytes[offset] === 240 && bytes[offset + length - 1] === 247 && matchesReset(bytes, offset + 1, length - 2);
}
function masterVolume(bytes, offset, length) {
  if (length !== 8 || bytes[offset] !== 240 || bytes[offset + 1] !== 127 || bytes[offset + 3] !== 4 || bytes[offset + 4] !== 1 || bytes[offset + 7] !== 247) return -1;
  return bytes[offset + 5] | bytes[offset + 6] << 7;
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
  /** The system exclusive message in progress has outgrown SYSEX_MAX and is dropped at its end. */
  overflow = false;
  /** Takes byte, which arrived at time. */
  feed(byte, time) {
    if (byte >= 248) {
      this.message(time, byte, 0, 0);
      return;
    }
    if (byte & 128) {
      if (this.sysexBytes) {
        const bytes = this.sysexBytes, whole = !this.overflow;
        this.sysexBytes = null;
        this.overflow = false;
        if (byte === 247) {
          if (whole) this.sysex(time, Uint8Array.from(bytes));
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
      if (byte === 240) {
        this.sysexBytes = [];
        this.overflow = false;
      } else if (byte === 241 || byte === 243) this.skip = 1;
      else if (byte === 242) this.skip = 2;
      return;
    }
    if (this.sysexBytes) {
      if (this.sysexBytes.length < SYSEX_MAX - 2) this.sysexBytes.push(byte);
      else this.overflow = true;
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
  /** Ends a message in progress as another status byte would, without one: a system exclusive message is dropped and
   *  the running status ends. A Standard MIDI File track uses it when a channel event interrupts a divided SysEx. */
  cancel() {
    this.sysexBytes = null;
    this.overflow = false;
    this.status = 0;
    this.have = 0;
    this.skip = 0;
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
      const data = new Uint8Array(bytes.length + 2);
      data[0] = 240;
      data.set(bytes, 1);
      data[bytes.length + 1] = 247;
      this.out.push({ time, type: "sysex", data });
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

const PARTS = [["assets", "dspack"], ["wasm", "wasm"]];
const WRITE_CHUNK = 64 * 1024 * 1024, MIN_WRITE = 64 * 1024;
const fileName = (profile, ext) => `${profile}.${ext}`;
const notFound = (error) => error?.code === "NOT_FOUND";
const bytes = (data) => data instanceof Uint8Array ? data : new Uint8Array(data);
function checkProfile(profile) {
  if (!isNativeProfile(profile)) throw new RangeError(`The profile store holds native profiles' files, not ${String(profile)}`);
}
function wholePack(data) {
  if (data.length < 16 || data[0] !== 68 || data[1] !== 83 || data[2] !== 80 || data[3] !== 75) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 16;
  for (let i = view.getUint32(12, true); i > 0; i--) {
    if (at + 8 > data.length) return false;
    at += 8 + view.getUint32(at + 4, true);
  }
  return at === data.length;
}
async function withFile(storage, name, options, fn) {
  const file = await storage.open(name, options);
  try {
    return await fn(file);
  } finally {
    await file.close();
  }
}
async function readAll(file, name) {
  const size = await file.size();
  if (size > MAX_PROFILE_ASSET_BYTES) throw new RangeError(`${name} is larger than any pack a core takes (${size} bytes)`);
  const data = new Uint8Array(size);
  for (let at = 0; at < size; ) {
    const n = await file.readInto(at, data.subarray(at, Math.min(size, at + file.maxReadBytes)));
    if (n <= 0) throw new Error(`${name} ended at ${at} of ${size} bytes`);
    at += n;
  }
  return data;
}
function createProfileStore(storage) {
  return {
    async save(profile, sources) {
      checkProfile(profile);
      for (const [part, ext] of PARTS) {
        const given = sources[part];
        if (given === void 0) continue;
        const data = bytes(given);
        if (data.length > MAX_PROFILE_ASSET_BYTES) throw new RangeError(`The ${part} of ${profile} is larger than any core takes (${data.length} bytes)`);
        await withFile(storage, fileName(profile, ext), { create: true }, async (file) => {
          let chunk = WRITE_CHUNK;
          for (let at = 0; at < data.length; ) {
            try {
              await file.write(at, data.subarray(at, at + chunk));
            } catch (error) {
              if (!(error instanceof RangeError) || chunk <= MIN_WRITE) throw error;
              chunk /= 2;
              continue;
            }
            if (at === 0) await file.truncate(Math.min(chunk, data.length));
            at += chunk;
          }
          if (!data.length) await file.truncate(0);
          await file.flush();
        });
      }
    },
    async load(profile) {
      checkProfile(profile);
      const found = {};
      for (const [part, ext] of PARTS) {
        const name = fileName(profile, ext);
        try {
          const data = await withFile(storage, name, { readOnly: true }, (file) => readAll(file, name));
          if (part === "wasm" ? WebAssembly.validate(data) : wholePack(data)) found[part] = data;
        } catch (error) {
          if (!notFound(error)) throw error;
        }
      }
      return found.assets || found.wasm ? found : void 0;
    },
    async profiles() {
      const kinds = /* @__PURE__ */ new Set();
      for (const name of await storage.list()) {
        const match = /^(.+)\.(dspack|wasm)$/.exec(name);
        if (match && isNativeProfile(match[1])) kinds.add(match[1]);
      }
      return [...kinds].sort();
    },
    async remove(profile) {
      checkProfile(profile);
      let removed = false;
      for (const [, ext] of PARTS) removed = await storage.remove(fileName(profile, ext)) || removed;
      return removed;
    }
  };
}
async function openProfileStore(name = "defuss-midi-synth") {
  const storage = globalThis.navigator?.storage;
  if (!storage?.getDirectory) throw new Error("openProfileStore needs a browser with the origin private file system; elsewhere use createProfileStore with a defuss-storage adapter");
  const { createDirectoryStorage } = await import('./directory-C3TRdeBx.js');
  const root = await (await (await storage.getDirectory()).getDirectoryHandle("defuss-storage", { create: true })).getDirectoryHandle(name, { create: true });
  return createProfileStore(await createDirectoryStorage(root));
}

export { isResetMessage as A, MAX_SOUNDFONT_BYTES as B, masterVolume as C, FM_BANKS as D, OP as E, FM_WASM_ASSET as F, GM_PROGRAMS as G, OP_COUNT as H, isSysEx as I, instantiateProfile as J, MidiStream as M, NativeProfileVoices as N, OPERAND_MAX as O, PROFILE_DESCRIPTORS as P, SOUNDFONT_ASSET as S, WASM_ASSET as W, isNativeProfile as a, nativePart as b, soundFontBytes as c, isSynthProfile as d, engineKind as e, finite as f, bankBytes as g, inputBytes as h, integer as i, MAX_SONG_BYTES as j, MidiParser as k, SYNTH_PROFILES as l, moduleKey as m, normalizeOptions as n, createProfileStore as o, packEvent as p, isReset as q, readBytes as r, selectEngine as s, openProfileStore as t, dataBytes as u, MIDI_RESET as v, withProfileSources as w, packMessage as x, SYSEX_MAX as y, MAX_BANK_BYTES as z };
