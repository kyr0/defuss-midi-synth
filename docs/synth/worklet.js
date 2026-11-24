// src/types.ts
var OP = {
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
var OP_COUNT = 9;
var OPERAND_MAX = 16383;
var MAX_SONG_BYTES = 16 * 1024 * 1024;
var MAX_SOUNDFONT_BYTES = 256 * 1024 * 1024;
var MAX_BANK_BYTES = 8 * 1024 * 1024;
var FM_BANKS = 79;
var MAX_CHIPS = 8;
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
function inputBytes(data, max, label) {
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new TypeError(`${label} must be a Uint8Array or ArrayBuffer`);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  integer(bytes.byteLength, 1, max, label);
  return bytes;
}

// src/parser.ts
var MIDI_RESET = 255;
function packMessage(status, data1 = 0, data2 = 0) {
  return (status | data1 << 8 | data2 << 16) >>> 0;
}
function dataBytes(status) {
  const kind = status & 240;
  return kind === 192 || kind === 208 ? 1 : 2;
}
var RESETS = [
  [126, -1, 9, 1],
  [65, -1, 66, 18, 64, 0, 127, 0, 65],
  [67, -1, 76, 0, 0, 126, 0]
];
function isReset(bytes) {
  return RESETS.some((known) => known.length === bytes.length && known.every((value, i) => value < 0 || value === bytes[i]));
}

// src/midifile.ts
var Reader = class {
  constructor(bytes, at, end, label) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
    this.label = label;
  }
  need(n) {
    if (this.at + n > this.end) throw new Error(`Truncated ${this.label}`);
  }
  u8() {
    this.need(1);
    return this.bytes[this.at++];
  }
  u16be() {
    this.need(2);
    const v = this.bytes[this.at] << 8 | this.bytes[this.at + 1];
    this.at += 2;
    return v;
  }
  u16le() {
    this.need(2);
    const v = this.bytes[this.at] | this.bytes[this.at + 1] << 8;
    this.at += 2;
    return v;
  }
  u32be() {
    this.need(4);
    const v = (this.bytes[this.at] << 24 | this.bytes[this.at + 1] << 16 | this.bytes[this.at + 2] << 8 | this.bytes[this.at + 3]) >>> 0;
    this.at += 4;
    return v;
  }
  /** A variable-length quantity of at most four bytes (Standard MIDI Files 1.0). */
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error(`Malformed ${this.label}: variable-length quantity over four bytes`);
  }
  text(n) {
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.at + i]);
    this.at += n;
    return s;
  }
};
var ascii = (bytes, at, text2) => text2.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
function parseSong(bytes) {
  if (ascii(bytes, 0, "MThd")) return parseSmf(bytes);
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "RMID")) return parseSmf(rmiData(bytes));
  if (ascii(bytes, 0, "MUS")) return parseMus(bytes);
  throw new Error("Unsupported file format: expected a MIDI (MThd), RMI (RIFF RMID) or MUS header");
}
function rmiData(bytes) {
  const r = new Reader(bytes, 12, bytes.length, "RMI file");
  while (r.at + 8 <= r.end) {
    const id = r.text(4), size = r.u16le() + r.u16le() * 65536;
    r.need(size);
    if (id === "data") return bytes.subarray(r.at, r.at + size);
    r.at += size + (size & 1);
  }
  throw new Error("Malformed RMI file: no data chunk");
}
function parseSmf(bytes) {
  const r = new Reader(bytes, 0, bytes.length, "MIDI header");
  r.at = 4;
  const headerLength = r.u32be();
  if (headerLength < 6) throw new Error("Malformed MIDI header");
  const format = r.u16be(), tracks = r.u16be(), division = r.u16be();
  if (format > 1) throw new Error(`Unsupported MIDI format ${format}: formats 0 and 1 play`);
  if (!tracks) throw new Error("Malformed MIDI header: no tracks");
  let secondsPerTick;
  if (division & 32768) {
    const fps = 256 - (division >> 8), perFrame = division & 255;
    if (![24, 25, 29, 30].includes(fps) || !perFrame) throw new Error("Malformed MIDI header: SMPTE division");
    const rate = (fps === 29 ? 29.97 : fps) * perFrame;
    secondsPerTick = () => 1 / rate;
  } else {
    if (!division) throw new Error("Malformed MIDI header: zero ticks per quarter note");
    secondsPerTick = (tempo2) => tempo2 / 1e6 / division;
  }
  r.at = 8 + headerLength;
  const entries = [];
  let title = "", endTick = 0, track = 0, order = 0;
  while (track < tracks && r.at + 8 <= bytes.length) {
    const id = r.text(4), length = r.u32be();
    if (id !== "MTrk") {
      r.need(length);
      r.at += length;
      continue;
    }
    const t = new Reader(bytes, r.at, Math.min(bytes.length, r.at + length), "MIDI track");
    r.at = t.end;
    let tick = 0, status = 0;
    while (t.at < t.end) {
      tick += t.vlq();
      let byte = t.u8();
      if (byte === 255) {
        const type = t.u8(), size = t.vlq();
        t.need(size);
        if (type === 47) {
          t.at += size;
          break;
        }
        if (type === 81 && size === 3) {
          const tempo2 = t.u8() << 16 | t.u8() << 8 | t.u8();
          if (tempo2) entries.push({ tick, track, order: order++, tempo: tempo2, message: 0 });
        } else if (type === 3 && track === 0 && !title) title = t.text(size).split(String.fromCharCode(0))[0].trimEnd();
        else t.at += size;
        continue;
      }
      if (byte === 240 || byte === 247) {
        const size = t.vlq();
        t.need(size);
        let data = t.bytes.subarray(t.at, t.at + size);
        t.at += size;
        if (byte === 240 && data[data.length - 1] === 247) data = data.subarray(0, data.length - 1);
        if (byte === 240 && isReset(data)) entries.push({ tick, track, order: order++, tempo: 0, message: MIDI_RESET });
        continue;
      }
      if (byte & 128) {
        if (byte >= 240) throw new Error(`Malformed MIDI track: status ${byte.toString(16)}h`);
        status = byte;
        byte = t.u8();
      } else if (!status) throw new Error("Malformed MIDI track: data byte without a status");
      const data2 = dataBytes(status) === 2 ? t.u8() & 127 : 0;
      entries.push({ tick, track, order: order++, tempo: 0, message: packMessage(status, byte & 127, data2) });
    }
    endTick = Math.max(endTick, tick);
    track++;
  }
  if (!track) throw new Error("Malformed MIDI file: no MTrk chunk");
  entries.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const times = [], messages = [];
  let tempo = 5e5, lastTick = 0, seconds = 0;
  for (const entry of entries) {
    seconds += (entry.tick - lastTick) * secondsPerTick(tempo);
    lastTick = entry.tick;
    if (entry.tempo) tempo = entry.tempo;
    else {
      times.push(seconds);
      messages.push(entry.message);
    }
  }
  const duration = seconds + Math.max(0, endTick - lastTick) * secondsPerTick(tempo);
  return { title, duration, times: Float64Array.from(times), messages: Uint32Array.from(messages) };
}
var MUS_CONTROLLERS = [0, 0, 1, 7, 10, 11, 91, 93, 64, 67];
var MUS_SYSTEM = { 10: 120, 11: 123, 12: 126, 13: 127, 14: 121 };
var MUS_RATE = 140;
function parseMus(bytes) {
  const h = new Reader(bytes, 4, bytes.length, "MUS header");
  const length = h.u16le(), start = h.u16le();
  const r = new Reader(bytes, start, Math.min(bytes.length, start + length), "MUS score");
  const velocity = Array.from({ length: 16 }, () => 127);
  const times = [], messages = [];
  let tick = 0;
  for (; ; ) {
    const event = r.u8(), kind = event >> 4 & 7, mus = event & 15;
    const channel = mus === 15 ? 9 : mus >= 9 ? mus + 1 : mus;
    const push = (status, d1 = 0, d2 = 0) => {
      times.push(tick / MUS_RATE);
      messages.push(packMessage(status | channel, d1, d2));
    };
    if (kind === 6) break;
    switch (kind) {
      case 0:
        push(128, r.u8() & 127);
        break;
      case 1: {
        const note = r.u8();
        if (note & 128) velocity[channel] = r.u8() & 127;
        push(144, note & 127, velocity[channel]);
        break;
      }
      case 2: {
        const bend = r.u8() * 64;
        push(224, bend & 127, bend >> 7);
        break;
      }
      case 3: {
        const mode = MUS_SYSTEM[r.u8()];
        if (mode !== void 0) push(176, mode, 0);
        break;
      }
      case 4: {
        const controller = r.u8(), value = Math.min(127, r.u8());
        if (controller === 0) push(192, value);
        else if (controller < MUS_CONTROLLERS.length) push(176, MUS_CONTROLLERS[controller], value);
        break;
      }
      case 5:
        break;
      default:
        throw new Error(`Malformed MUS score: event type ${kind}`);
    }
    if (event & 128) tick += r.vlq();
  }
  return { title: "", duration: tick / MUS_RATE, times: Float64Array.from(times), messages: Uint32Array.from(messages) };
}

// src/gm.ts
var GM_PROGRAMS = [
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

// src/voices.ts
var SYNTH_IMPORTS = { env: { emscripten_notify_memory_growth: () => void 0 } };
var RENDER_BLOCK = 128;
var SOUNDFONT_ENGINE = "TinySoundFont 0.9";
var FM_ENGINE = "libADLMIDI 1.6.2, Nuked OPL3";
var DRUMS = 9;
var PlanarOutput = class {
  constructor(memory, out) {
    this.memory = memory;
    this.out = out;
    this.view = new Float32Array(memory.buffer, out, RENDER_BLOCK * 2);
  }
  view;
  copy(left, right, at, n, gain) {
    if (this.view.buffer !== this.memory.buffer) this.view = new Float32Array(this.memory.buffer, this.out, RENDER_BLOCK * 2);
    const view = this.view;
    for (let i = 0; i < n; i++) {
      left[at + i] = view[i] * gain;
      right[at + i] = view[n + i] * gain;
    }
  }
};
function text(memory, at, max) {
  const heap = new Uint8Array(memory.buffer);
  let value = "";
  for (let p = at; heap[p] && value.length < max; p++) value += String.fromCharCode(heap[p]);
  return value;
}
var SoundFontVoices = class {
  constructor(instance, soundfont, options) {
    this.options = options;
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.synth_render(0));
    this.load(soundfont);
  }
  kind = "soundfont";
  name = SOUNDFONT_ENGINE;
  wasm;
  output;
  list = [];
  /** Replaces the SoundFont; a rejected one leaves the loaded SoundFont in place (synth_load parses it first). */
  load(data) {
    const w = this.wasm, bytes = inputBytes(data, MAX_SOUNDFONT_BYTES, "SoundFont length");
    const at = w.synth_buffer(bytes.byteLength);
    if (!at) throw new Error("SoundFont buffer allocation failed");
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.synth_load(at, bytes.byteLength, this.options.sampleRate, SOUNDFONT_GAIN_DB, this.options.maxVoices)) throw new Error("Invalid SoundFont: not an SF2 file, or out of memory");
    const presets = [];
    for (let i = 0, count = w.synth_preset_count(); i < count; i++) {
      presets.push({ bank: w.synth_preset_bank(i), program: w.synth_preset_program(i), name: text(w.memory, w.synth_preset_name(i), 20).trim() });
    }
    this.list = presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  }
  presets() {
    return this.list.map((p) => ({ ...p }));
  }
  maxVoices() {
    return this.options.maxVoices;
  }
  message(status, data1, data2) {
    this.wasm.synth_message(status, data1, data2);
  }
  setPreset(channel, bank, program) {
    return this.wasm.synth_set_preset(channel, bank, program) === 1;
  }
  render(left, right, at, n) {
    if (!this.wasm.synth_voices()) {
      left.fill(0, at, at + n);
      right.fill(0, at, at + n);
      return;
    }
    this.wasm.synth_render(n);
    this.output.copy(left, right, at, n, 1);
  }
  voices() {
    return this.wasm.synth_voices();
  }
  close() {
  }
};
var SOUNDFONT_GAIN_DB = -6;
var FM_GAIN = 2.5;
var FmVoices = class {
  kind = "fm";
  name = FM_ENGINE;
  wasm;
  output;
  names = [];
  current;
  constructor(instance, options) {
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    if (!this.wasm.fm_init(options.sampleRate, options.chips, options.fmBank)) throw new Error("The FM synthesizer rejected its settings");
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.fm_render(0));
    for (let i = 0, count = this.wasm.fm_bank_count(); i < count; i++) this.names.push(text(this.wasm.memory, this.wasm.fm_bank_name(i), 120));
    this.current = options.fmBank;
  }
  info() {
    return { banks: [...this.names], bank: this.current, chips: this.wasm.fm_chips() };
  }
  /** Selects embedded bank (banks.ini's number); every voice ends. */
  setBank(bank) {
    integer(bank, 0, this.names.length - 1, "FM bank");
    if (!this.wasm.fm_set_bank(bank)) throw new Error(`The FM synthesizer rejected bank ${bank}`);
    this.current = bank;
  }
  /** Replaces the instruments with a WOPL bank file; a rejected file keeps the instruments. Every voice ends. */
  loadBank(data) {
    const w = this.wasm, bytes = inputBytes(data, MAX_BANK_BYTES, "bank length");
    const at = w.fm_buffer(bytes.byteLength);
    if (!at) throw new Error("Bank buffer allocation failed");
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.fm_load_bank(at, bytes.byteLength)) throw new Error("Invalid FM bank: not a WOPL file");
    this.current = -1;
  }
  /** The General MIDI programs on bank 0 and the percussion of channel 10 as bank 128. */
  presets() {
    return [...GM_PROGRAMS.map((name, program) => ({ bank: 0, program, name })), { bank: 128, program: 0, name: "Percussion" }];
  }
  maxVoices() {
    return this.wasm.fm_chips() * 18;
  }
  /** VERIFIED: FFh's libADLMIDI reset (adl_rt_resetState, adlmidi_midiplay.cpp) resets the controllers but keeps each channel's bank and program, so
   *  the General MIDI state's bank 0, program 1 follows it here. */
  message(status, data1, data2) {
    this.wasm.fm_message(status, data1, data2);
    if (status !== MIDI_RESET) return;
    for (let channel = 0; channel < 16; channel++) {
      this.wasm.fm_message(176 | channel, 0, 0);
      this.wasm.fm_message(176 | channel, 32, 0);
      this.wasm.fm_message(192 | channel, 0, 0);
    }
  }
  /** Bank 128 is the percussion, which plays on channel 10 only; other banks go out as bank select and program. */
  setPreset(channel, bank, program) {
    if (bank === 128) {
      if (channel !== DRUMS) return false;
      this.wasm.fm_message(192 | channel, program, 0);
      return true;
    }
    if (bank !== 0) return false;
    this.wasm.fm_message(176 | channel, 0, 0);
    this.wasm.fm_message(176 | channel, 32, 0);
    this.wasm.fm_message(192 | channel, program, 0);
    return true;
  }
  render(left, right, at, n) {
    this.wasm.fm_render(n);
    this.output.copy(left, right, at, n, FM_GAIN);
  }
  voices() {
    return this.wasm.fm_voices();
  }
  close() {
    this.wasm.fm_message(MIDI_RESET & 255, 0, 0);
  }
};

// src/engine.ts
var CHANNELS = 16;
var Engine = class _Engine {
  options;
  maxFrames = RENDER_BLOCK;
  active;
  soundfont = null;
  fm = null;
  song = null;
  songFrames = new Float64Array(0);
  endFrame = 0;
  index = 0;
  /** The file's position in its own frames; it advances rate frames per output frame. */
  position = 0;
  rate = 1;
  state = "idle";
  loop = false;
  /** The velocity of each note the file holds now (channel * 128 + note), so a new engine strikes it again. */
  held = new Uint8Array(CHANNELS * 128);
  /** Starts with voices, made from options by SoundFontVoices or FmVoices. */
  constructor(voices, options = {}) {
    this.options = normalizeOptions({ ...options, engine: voices.kind });
    this.active = voices;
    this.attach(voices);
    this.active.message(MIDI_RESET, 0, 0);
  }
  /** An engine with TinySoundFont on instance (midi-synth.wasm) and the SoundFont 2 file soundfont. */
  static withSoundFont(instance, soundfont, options = {}) {
    return new _Engine(new SoundFontVoices(instance, soundfont, normalizeOptions(options)), options);
  }
  /** An engine with libADLMIDI on instance (fm-synth.wasm), options.chips chips and embedded bank options.fmBank. */
  static withFm(instance, options = {}) {
    return new _Engine(new FmVoices(instance, normalizeOptions(options)), options);
  }
  attach(voices) {
    if (voices instanceof SoundFontVoices) this.soundfont = voices;
    else this.fm = voices;
  }
  ensure() {
    if (!this.active) throw new Error("Synth is disposed");
    return this.active;
  }
  info() {
    const v = this.ensure();
    const engines = [];
    if (this.soundfont) engines.push("soundfont");
    if (this.fm) engines.push("fm");
    return { engine: v.name, kind: v.kind, engines, sampleRate: this.options.sampleRate, maxVoices: v.maxVoices(), presets: v.presets(), ...this.fm ? { fm: this.fm.info() } : {} };
  }
  /** The engines loaded so far. */
  has(kind) {
    return kind === "soundfont" ? !!this.soundfont : !!this.fm;
  }
  /** Adds the other engine, made by SoundFontVoices or FmVoices with this engine's options. */
  add(voices) {
    this.ensure();
    if (this.has(voices.kind)) throw new Error(`The ${voices.kind} engine is already loaded`);
    this.attach(voices);
    voices.message(MIDI_RESET, 0, 0);
  }
  /** Makes kind's engine play. The voices of the other one end; a loaded file keeps its position and plays on, with
   *  its controllers and programs up to the position replayed into the new engine and its held notes struck again. */
  use(kind) {
    const current = this.ensure(), next = engineKind(kind) === "soundfont" ? this.soundfont : this.fm;
    if (!next) throw new Error(`The ${kind} engine is not loaded`);
    if (next === current) return;
    const held = this.held.slice();
    this.silence();
    this.held.set(held);
    this.active = next;
    this.restore();
  }
  /** Replaces the SoundFont engine's SoundFont; a rejected one leaves the loaded SoundFont in place. Stops file
   *  playback first when that engine plays. */
  loadSoundFont(data) {
    this.ensure();
    if (!this.soundfont) throw new Error("The soundfont engine is not loaded");
    if (this.active === this.soundfont) this.stop();
    this.soundfont.load(data);
  }
  /** Selects the FM engine's embedded bank; a file keeps playing with its state replayed. */
  setFmBank(bank) {
    this.ensure();
    if (!this.fm) throw new Error("The fm engine is not loaded");
    this.fm.setBank(bank);
    if (this.active === this.fm) this.restore();
  }
  /** Replaces the FM engine's instruments with a WOPL bank file; a rejected file keeps the bank. */
  loadFmBank(data) {
    this.ensure();
    if (!this.fm) throw new Error("The fm engine is not loaded");
    this.fm.loadBank(data);
    if (this.active === this.fm) this.restore();
  }
  /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
   *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
  voices() {
    return this.ensure().voices();
  }
  hasPreset(bank, program) {
    return this.ensure().presets().some((p) => p.bank === bank && p.program === program);
  }
  /** Parses a MIDI, RMI or MUS file and positions it at its start. Stops the previous file; a rejected file leaves
   *  none loaded. Every channel returns to its General MIDI state. */
  loadMidi(data, options = {}) {
    const bytes = inputBytes(data, MAX_SONG_BYTES, "file length");
    const tempo = finite(options.tempo ?? 1, 0.25, 4, "tempo");
    this.stop();
    this.song = null;
    const parsed = parseSong(bytes), rate = this.options.sampleRate;
    const song = tempo === 1 ? parsed : { ...parsed, times: parsed.times.map((time) => time / tempo), duration: parsed.duration / tempo };
    this.songFrames = song.times.map((time) => Math.round(time * rate));
    this.endFrame = Math.round(song.duration * rate);
    this.song = song;
    this.index = 0;
    this.position = 0;
    this.message(MIDI_RESET);
    return this.playbackInfo();
  }
  requireSong() {
    this.ensure();
    if (!this.song) throw new Error("Load a MIDI file first");
    return this.song;
  }
  play(loop = false) {
    this.requireSong();
    this.loop = loop;
    if (this.state === "ended") this.seek(0);
    this.state = "playing";
  }
  /** Freezes file playback and the synthesizer; render emits silence until play. */
  pause() {
    this.ensure();
    if (this.state === "playing") this.state = "paused";
  }
  /** Ends every sound at once and rewinds a loaded file to its start, in the General MIDI state. */
  stop() {
    this.ensure();
    this.silence();
    if (this.song) {
      this.index = 0;
      this.position = 0;
      this.message(MIDI_RESET);
    }
    this.state = "idle";
  }
  /** Ends every sound at once; queued and file events still follow. */
  panic() {
    this.ensure();
    this.silence();
  }
  /** Moves the file to seconds: resets the channels and applies every non-note message before that time. */
  seek(seconds) {
    const song = this.requireSong();
    finite(seconds, 0, song.duration, "seek position");
    this.silence();
    const target = Math.round(seconds * this.options.sampleRate);
    let i = 0;
    while (i < song.messages.length && this.songFrames[i] < target) i++;
    this.chase(i);
    this.index = i;
    this.position = target;
    if (this.state === "ended") this.state = "idle";
  }
  /** Sets the file's playback rate, 0.25 to 4: 2 plays it twice as fast at the same pitch. */
  setRate(rate) {
    this.ensure();
    this.rate = finite(rate, 0.25, 4, "playback rate");
  }
  /** The General MIDI state, then every non-note message of the file before index count, so a new engine or bank
   *  continues the file as it stood. */
  chase(count) {
    this.message(MIDI_RESET);
    const song = this.song;
    if (!song) return;
    for (let i = 0; i < count; i++) {
      const message = song.messages[i], kind = message & 240;
      if (kind !== 128 && kind !== 144 && kind !== 160) this.message(message);
    }
  }
  /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
  restore() {
    this.chase(this.song ? this.index : 0);
    for (let i = 0; i < this.held.length; i++) if (this.held[i]) this.ensure().message(144 | i >> 7, i & 127, this.held[i]);
  }
  /** Plays a file message and keeps note on and off in held. */
  play1(message) {
    const kind = message & 240, key = (message & 15) << 7 | message >>> 8 & 127, velocity = message >>> 16 & 127;
    if (kind === 144) this.held[key] = velocity;
    else if (kind === 128) this.held[key] = 0;
    else if (kind === 176 && ((message >>> 8 & 127) === 123 || (message >>> 8 & 127) === 120)) this.held.fill(0, key & ~127, (key & ~127) + 128);
    this.message(message);
  }
  playbackInfo() {
    this.ensure();
    const song = this.song, rate = this.options.sampleRate;
    return { title: song?.title ?? "", duration: song?.duration ?? 0, position: song ? Math.min(song.duration, this.position / rate) : 0, ended: this.state === "ended", rate: this.rate };
  }
  /** Plays one packed message (status, data 1 << 8, data 2 << 16) or MIDI_RESET at once. */
  message(packed) {
    this.ensure().message(packed & 255, packed >>> 8 & 255, packed >>> 16 & 255);
  }
  /** Called by the validated scheduler with scalar operands, avoiding event objects. */
  dispatch(op, a, b, c) {
    const v = this.ensure();
    switch (op) {
      case OP.noteOn:
        v.message(144 | a, b, c);
        break;
      case OP.noteOff:
        v.message(128 | a, b, 0);
        break;
      case OP.controlChange:
        v.message(176 | a, b, c);
        break;
      case OP.programChange:
        v.message(192 | a, b, 0);
        break;
      case OP.pitchBend:
        v.message(224 | a, b & 127, b >> 7);
        break;
      case OP.channelPressure:
        v.message(208 | a, b, 0);
        break;
      case OP.polyPressure:
        v.message(160 | a, b, c);
        break;
      case OP.preset:
        v.setPreset(a, b, c);
        break;
      case OP.reset:
        v.message(MIDI_RESET, 0, 0);
        break;
      default:
        throw new RangeError("Unknown event operation");
    }
  }
  controlAll(controller) {
    const v = this.ensure();
    for (let channel = 0; channel < CHANNELS; channel++) {
      v.message(176 | channel, 64, 0);
      v.message(176 | channel, controller, 0);
    }
  }
  /** Sustain off and All Sound Off (120) on every channel: voices end at once. */
  silence() {
    this.controlAll(120);
    this.held.fill(0);
  }
  /** Sustain off and All Notes Off (123) on every channel: voices release. */
  notesOff() {
    this.controlAll(123);
    this.held.fill(0);
  }
  /** The file reached its end: start again when looping, else end with the notes released. */
  finish() {
    if (this.loop && this.endFrame > 0) {
      this.notesOff();
      this.index = 0;
      this.position = 0;
    } else {
      this.state = "ended";
      this.notesOff();
    }
  }
  /** Writes frames (at most maxFrames) of planar Float32 PCM into left and right from offset, playing the file's
   *  messages at their frames: a message at file frame f plays at the first output frame where the file position,
   *  advancing rate frames per output frame, has reached f. */
  render(left, right, offset, frames) {
    const v = this.ensure();
    integer(frames, 0, this.maxFrames, "render frames");
    integer(offset, 0, Math.min(left.length, right.length) - frames, "render offset");
    if (this.state === "paused") {
      left.fill(0, offset, offset + frames);
      right.fill(0, offset, offset + frames);
      return;
    }
    let done = 0;
    while (done < frames) {
      let n = frames - done;
      if (this.state === "playing") {
        const song = this.song;
        while (this.index < song.messages.length && this.songFrames[this.index] <= this.position) this.play1(song.messages[this.index++]);
        if (this.index >= song.messages.length && this.position >= this.endFrame) {
          this.finish();
          continue;
        }
        const next = this.index < song.messages.length ? this.songFrames[this.index] : this.endFrame;
        n = Math.min(n, Math.ceil((next - this.position) / this.rate));
      }
      v.render(left, right, offset + done, n);
      if (this.state === "playing") this.position += n * this.rate;
      done += n;
    }
  }
  close() {
    this.soundfont?.close();
    this.fm?.close();
    this.active = null;
    this.soundfont = null;
    this.fm = null;
    this.song = null;
  }
};

// src/queue.ts
var EventQueue = class {
  constructor(capacity = 8192) {
    this.capacity = capacity;
    integer(capacity, 1, 1048576, "queue capacity");
    this.frames = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.ops = new Int32Array(capacity * 4);
  }
  frames;
  order;
  ops;
  serial = 0;
  size = 0;
  get nextFrame() {
    return this.size ? this.frames[0] : Infinity;
  }
  clear() {
    this.size = 0;
    this.serial = 0;
  }
  /** Preflight the entire batch so rejection never leaves half a score scheduled. */
  pushBatch(events) {
    if (events.length > this.capacity - this.size) throw new RangeError("Event queue full");
    if (this.serial + events.length > Number.MAX_SAFE_INTEGER) throw new RangeError("Event sequence exhausted");
    for (const event of events) {
      if (!Array.isArray(event) || event.length !== 5) throw new TypeError("Invalid packed event");
      integer(event[0], 0, Number.MAX_SAFE_INTEGER, "frame");
      integer(event[1], 0, OP_COUNT - 1, "operation");
      for (let j = 2; j < 5; j++) integer(event[j], 0, OPERAND_MAX, "operand");
    }
    for (const e of events) {
      let i = this.size++;
      this.frames[i] = e[0];
      this.order[i] = this.serial++;
      for (let j = 0; j < 4; j++) this.ops[i * 4 + j] = e[j + 1];
      while (i > 0) {
        const p = i - 1 >>> 1;
        if (!this.before(i, p)) break;
        this.swap(i, p);
        i = p;
      }
    }
  }
  /** Write into caller-owned scratch, never allocate while popping. */
  pop(target) {
    if (!this.size) throw new RangeError("Empty event queue");
    for (let j = 0; j < 4; j++) target[j] = this.ops[j];
    this.size--;
    if (!this.size) return;
    this.frames[0] = this.frames[this.size];
    this.order[0] = this.order[this.size];
    for (let j = 0; j < 4; j++) this.ops[j] = this.ops[this.size * 4 + j];
    let i = 0;
    while (i * 2 + 1 < this.size) {
      let c = i * 2 + 1;
      if (c + 1 < this.size && this.before(c + 1, c)) c++;
      if (!this.before(c, i)) break;
      this.swap(c, i);
      i = c;
    }
  }
  before(a, b) {
    return this.frames[a] < this.frames[b] || this.frames[a] === this.frames[b] && this.order[a] < this.order[b];
  }
  swap(a, b) {
    let t = this.frames[a];
    this.frames[a] = this.frames[b];
    this.frames[b] = t;
    t = this.order[a];
    this.order[a] = this.order[b];
    this.order[b] = t;
    for (let j = 0; j < 4; j++) {
      t = this.ops[a * 4 + j];
      this.ops[a * 4 + j] = this.ops[b * 4 + j];
      this.ops[b * 4 + j] = t;
    }
  }
};

// src/session.ts
var RENDER_GRID = 64;
var RenderSession = class {
  constructor(engine, capacity = 8192) {
    this.engine = engine;
    this.queue = new EventQueue(capacity);
  }
  queue;
  scratch = new Int32Array(4);
  frame = 0;
  lateEvents = 0;
  schedule(events) {
    this.queue.pushBatch(events);
  }
  clear() {
    this.queue.clear();
  }
  stats() {
    return { frame: this.frame, queuedEvents: this.queue.size, lateEvents: this.lateEvents };
  }
  process(left, right, startFrame = this.frame) {
    integer(startFrame, this.frame, Number.MAX_SAFE_INTEGER - left.length, "start frame");
    if (left.length !== right.length) throw new RangeError("Stereo buffers must have equal length");
    this.frame = startFrame;
    let offset = 0;
    while (offset < left.length) {
      while (this.queue.nextFrame <= this.frame) {
        if (this.queue.nextFrame < this.frame) this.lateEvents++;
        this.queue.pop(this.scratch);
        this.engine.dispatch(this.scratch[0], this.scratch[1], this.scratch[2], this.scratch[3]);
      }
      const frames = Math.min(left.length - offset, this.engine.maxFrames, this.queue.nextFrame - this.frame, RENDER_GRID - this.frame % RENDER_GRID);
      this.engine.render(left, right, offset, frames);
      offset += frames;
      this.frame += frames;
    }
  }
};

// src/worklet.ts
var MidiProcessor = class extends AudioWorkletProcessor {
  session;
  settings;
  closed = false;
  constructor(options) {
    super();
    this.port.onmessage = (event) => this.command(event.data);
    const config = options.processorOptions;
    this.settings = normalizeOptions({ ...config.settings, sampleRate });
    try {
      const engine = new Engine(this.voices(config.part), this.settings);
      this.session = new RenderSession(engine, config.capacity);
      this.port.postMessage({ type: "ready", info: engine.info() });
    } catch (error) {
      this.fail(error);
    }
  }
  voices(part, module = part.module) {
    if (!module) throw new Error("The engine part has no module");
    const instance = new WebAssembly.Instance(module, SYNTH_IMPORTS);
    if (part.kind === "fm") return new FmVoices(instance, this.settings);
    if (!part.soundfont) throw new Error("The soundfont engine needs a SoundFont");
    return new SoundFontVoices(instance, new Uint8Array(part.soundfont), this.settings);
  }
  fail(error) {
    this.port.postMessage({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
    this.closed = true;
    this.session?.engine.close();
  }
  command(request) {
    try {
      if (request.method === "dispose") {
        this.closed = true;
        this.session?.engine.close();
        this.port.postMessage({ id: request.id, result: null });
        return;
      }
      if (this.closed || !this.session) throw new Error("Processor is not ready");
      if (request.method === "addEngine") {
        void this.addEngine(request);
        return;
      }
      const s = this.session, e = s.engine, a = request.args;
      let result = null;
      switch (request.method) {
        case "schedule":
          s.schedule(a[0]);
          break;
        case "clear":
          s.clear();
          break;
        case "panic":
          s.clear();
          e.panic();
          break;
        case "useEngine":
          s.clear();
          e.use(a[0]);
          result = e.info();
          break;
        case "loadSoundFont":
          s.clear();
          e.loadSoundFont(a[0]);
          result = e.info();
          break;
        case "setFmBank":
          e.setFmBank(a[0]);
          result = e.info();
          break;
        case "loadFmBank":
          e.loadFmBank(a[0]);
          result = e.info();
          break;
        case "loadMidi":
          s.clear();
          result = e.loadMidi(a[0], a[1]);
          break;
        case "play":
          e.play(a[0]);
          break;
        case "pause":
          e.pause();
          break;
        case "stop":
          s.clear();
          e.stop();
          break;
        case "seek":
          s.clear();
          e.seek(a[0]);
          break;
        case "rate":
          e.setRate(a[0]);
          break;
        case "status":
          result = { ...s.stats(), ...e.playbackInfo(), voices: e.voices() };
          break;
        default:
          throw new Error(`Unknown command: ${request.method}`);
      }
      this.port.postMessage({ id: request.id, result });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Compiles the bytes of a later engine without blocking the audio thread, then adds the engine; the reply waits
   *  for both, and the synthesizer sends no other engine command meanwhile. */
  async addEngine(request) {
    try {
      const part = request.args[0];
      const module = part.module ?? await WebAssembly.compile(part.wasm ?? new ArrayBuffer(0));
      if (this.closed || !this.session) throw new Error("Processor is not ready");
      const engine = this.session.engine;
      engine.add(this.voices(part, module));
      this.port.postMessage({ id: request.id, result: engine.info() });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process(_inputs, outputs) {
    if (this.closed) return false;
    const out = outputs[0];
    if (!out || out.length < 2 || !this.session) return true;
    try {
      this.session.process(out[0], out[1], Math.max(currentFrame, this.session.frame));
    } catch (error) {
      out[0].fill(0);
      out[1].fill(0);
      this.fail(error);
      return false;
    }
    return true;
  }
};
registerProcessor("defuss-midi-synth", MidiProcessor);
//# sourceMappingURL=worklet.js.map
