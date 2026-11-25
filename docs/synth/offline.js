import { k as MidiParser, u as dataBytes, v as MIDI_RESET, x as packMessage, y as SYSEX_MAX, q as isReset, i as integer, h as inputBytes, z as MAX_BANK_BYTES, G as GM_PROGRAMS, A as isResetMessage, B as MAX_SOUNDFONT_BYTES, C as masterVolume, N as NativeProfileVoices, n as normalizeOptions, e as engineKind, D as FM_BANKS, j as MAX_SONG_BYTES, f as finite, E as OP, H as OP_COUNT, I as isSysEx, O as OPERAND_MAX, M as MidiStream, s as selectEngine, d as isSynthProfile, w as withProfileSources, c as soundFontBytes, S as SOUNDFONT_ASSET, g as bankBytes, p as packEvent, r as readBytes, a as isNativeProfile, b as nativePart, J as instantiateProfile, m as moduleKey } from './profile-store-DcWn1JWP.js';
export { P as PROFILE_DESCRIPTORS, l as SYNTH_PROFILES, o as createProfileStore, t as openProfileStore } from './profile-store-DcWn1JWP.js';

const FM_BANK_NAMES = Object.freeze([
  "AIL (The Fat Man 2op set, default AIL)",
  "Bisqwit (selection of 4op and 2op)",
  "HMI (Descent, Asterix)",
  "HMI (Descent:: Int) :NON-GM:",
  "HMI (Descent:: Ham) :NON-GM:",
  "HMI (Descent:: Rick) :NON-GM:",
  "HMI (Descent 2) :NON-GM:",
  "HMI (Normality)",
  "HMI (Shattered Steel)",
  "HMI (Theme Park)",
  "HMI (MegaPatch by LoudMouth)",
  "HMI (MegaPatch - Aces of the Deep)",
  "HMI (MegaPatch - Earthsiege)",
  "HMI (Anvil of Dawn)",
  "DMX (Bobby Prince v2)",
  "DMX (Cygnus Studios, default DMX)",
  "DMX (Bobby Prince v1)",
  "AIL (Discworld, Grandest Fleet, etc.)",
  "AIL (Warcraft 2)",
  "AIL (Syndicate) :MT-32:",
  "AIL (Guilty, Orion Conspiracy, TNSFC ::4op)",
  "AIL (Magic Carpet 2) :MT-32:",
  "AIL (Eric Heberling - Nemesis)",
  "AIL (Jagged Alliance) :MT-32:",
  "AIL (When Two Worlds War) :MT-32: :MISS-INS:",
  "AIL (Bards Tale Construction) :MT-32: :MISS-INS:",
  "AIL (Return to Zork) :MT-32:",
  "AIL (Theme Hospital)",
  "AIL (MegaPatch - National Hockey League PA)",
  "AIL (Inherit The Earth) :MT-32:",
  "AIL (Inherit The Earth, file two) :MT-32:",
  "AIL (Little Big Adventure) :4op:",
  "AIL (Heroes of Might and Magic II) :MT-32:",
  "AIL (Eric Heberling - Death Gate)",
  "AIL (FIFA International Soccer)",
  "AIL (Starship Invasion)",
  "AIL (Super Street Fighter 2 :4op:)",
  "AIL (Lords of the Realm) :MISS-INS:",
  "AIL (SimFarm, SimHealth) :4op:",
  "AIL (SimFarm, Settlers, Serf City)",
  "AIL (Caesar 2) :p4op: :MISS-INS:",
  "AIL (Syndicate Wars) :MT-32:",
  "AIL (MegaPatch mod by Probe Ent.)",
  "AIL (Warcraft) :NON-GM:",
  "AIL (Terra Nova Strike Force Centuri) :p4op:",
  "AIL (System Shock) :p4op:",
  "AIL (Eric Heberling - Advanced Civilization)",
  "AIL (Battle Chess 4000) :MT-32:",
  "AIL (Ultimate Soccer Manager :p4op:)",
  "AIL (Air Bucks, Blue And The Gray, etc) :MT-32:",
  "AIL (Ultima Underworld 2) :MT-32:",
  "AIL (FatMan MT32) :MT-32:",
  "AIL (High Seas Trader) :MISS-INS:",
  "AIL (Master of Magic) :4op:",
  "AIL (Master of Magic) :4op: orchestral drums",
  "SB (Action Soccer)",
  "SB (3d Cyberpuck :: melodic only)",
  "SB (Simon the Sorcerer) :MT-32:",
  "WOPL (The Fat Man 2op set; Win9x)",
  "WOPL (The Fat Man 4op set)",
  "OP3 (JungleVision 2op set :: melodic only)",
  "OP3 (Wallace 2op set, Nitemare 3D :: melodic only)",
  "TMB (Duke Nukem 3D)",
  "TMB (Shadow Warrior)",
  "DMX (Scott Host)",
  "SB (Modded GMOPL by Wohlstand)",
  "SB (Jamie O'Connell's bank)",
  "TMB (Apogee Sound System Default bank) :broken drums:",
  "WOPL (4op bank by James Alan Nguyen and Wohlstand)",
  "TMB (MegaPatch - Blood)",
  "TMB (Rise of the Triad)",
  "TMB (Nam)",
  "WOPL (DMXOPL3 bank by Sneakernets)",
  "EA (Cartooners)",
  "WOPL (Apogee IMF 90-ish)",
  "AIL (The Lost Vikings) :NON-GM:",
  "DMX (Strife)",
  "WOPL (MS-AdLib, Windows 3.x)",
  "AIL (Monopoly Deluxe)"
]);

const SYSEX_STATUS = 240;
const MAX_FILE_SYSEX = 65536;
class Reader {
  constructor(bytes, at, end, label) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
    this.label = label;
  }
  bytes;
  at;
  end;
  label;
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
}
function metaText(reader, size) {
  const length = Math.min(size, 2048);
  const raw = reader.text(length).split(String.fromCharCode(0))[0];
  reader.at += size - length;
  if (Array.from(raw).some((char) => char.charCodeAt(0) > 127)) {
    const encoded = Array.from(raw, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    try {
      return decodeURIComponent(encoded).trim();
    } catch {
    }
  }
  return raw.trim();
}
const ascii = (bytes, at, text) => text.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
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
  const metadata = { format, trackCount: tracks };
  const entries = [];
  let sysexCount = 0;
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
    const sysex2 = (at, data) => {
      if (++sysexCount > MAX_FILE_SYSEX) throw new RangeError(`MIDI file holds more than ${MAX_FILE_SYSEX} system exclusive messages`);
      entries.push({ tick: at, track, order: order++, tempo: 0, message: isReset(data.subarray(1, data.length - 1)) ? MIDI_RESET : SYSEX_STATUS, data });
    };
    const escape = new MidiParser((at, s, d1, d2) => {
      if (s === 255) entries.push({ tick: at, track, order: order++, tempo: 0, message: MIDI_RESET });
      else if (s < 240) entries.push({ tick: at, track, order: order++, tempo: 0, message: packMessage(s, d1, d2) });
    }, (at, inner) => {
      const data = new Uint8Array(inner.length + 2);
      data[0] = 240;
      data.set(inner, 1);
      data[inner.length + 1] = 247;
      sysex2(at, data);
    });
    let open = null, openTick = 0, overflow = false;
    const close = () => {
      if (open && !overflow) {
        open.push(247);
        sysex2(openTick, Uint8Array.from(open));
      }
      open = null;
      overflow = false;
    };
    const packet = (from, end, escaped) => {
      let i = from;
      for (; open && i < end; i++) {
        const b = t.bytes[i];
        if (b >= 248) {
          if (b === 255) entries.push({ tick, track, order: order++, tempo: 0, message: MIDI_RESET });
          continue;
        }
        if (b === 247) {
          open.push(247);
          if (!overflow) sysex2(tick, Uint8Array.from(open));
          open = null;
          overflow = false;
          i++;
          break;
        }
        if (b & 128) {
          open = null;
          overflow = false;
          break;
        }
        if (open.length < SYSEX_MAX - 1) open.push(b);
        else overflow = true;
      }
      if (open) openTick = tick;
      else if (escaped || i < end) for (; i < end; i++) escape.feed(t.bytes[i], tick);
    };
    while (t.at < t.end) {
      tick += t.vlq();
      let byte = t.u8();
      if (byte === 255) {
        const type = t.u8();
        if (type === 47 && t.at + 2 === t.end && t.bytes[t.at] === 255 && t.bytes[t.at + 1] === 0) break;
        const size = t.vlq();
        t.need(size);
        if (type === 47) {
          t.at += size;
          break;
        }
        if (type === 81 && size === 3) {
          const tempo2 = t.u8() << 16 | t.u8() << 8 | t.u8();
          if (tick === 0 && tempo2) metadata.initialBpm = 6e7 / tempo2;
          if (tempo2) entries.push({ tick, track, order: order++, tempo: tempo2, message: 0 });
        } else if (type === 3 && track === 0 && !title) title = metaText(t, size);
        else if (type === 2 && !metadata.copyright) metadata.copyright = metaText(t, size);
        else if (type === 1 && !metadata.text) metadata.text = metaText(t, size);
        else if (type === 88 && tick === 0 && size === 4) {
          const numerator = t.u8(), exponent = t.u8();
          if (numerator && exponent < 16) metadata.timeSignature = `${numerator}/${2 ** exponent}`;
          t.at += 2;
        } else t.at += size;
        continue;
      }
      if (byte === 240 || byte === 247) {
        const size = t.vlq();
        t.need(size);
        if (byte === 240) {
          close();
          escape.cancel();
          open = [240];
        }
        packet(t.at, t.at + size, !open);
        t.at += size;
        continue;
      }
      if (byte & 128) {
        if (byte >= 240) throw new Error(`Malformed MIDI track: status ${byte.toString(16)}h`);
        status = byte;
        byte = t.u8();
      } else if (!status) throw new Error("Malformed MIDI track: data byte without a status");
      close();
      escape.cancel();
      const data2 = dataBytes(status) === 2 ? t.u8() & 127 : 0;
      entries.push({ tick, track, order: order++, tempo: 0, message: packMessage(status, byte & 127, data2) });
    }
    close();
    endTick = Math.max(endTick, tick);
    track++;
  }
  if (!track) throw new Error("Malformed MIDI file: no MTrk chunk");
  entries.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const times = [], messages = [], sysex = /* @__PURE__ */ new Map();
  let tempo = 5e5, lastTick = 0, seconds = 0;
  for (const entry of entries) {
    seconds += (entry.tick - lastTick) * secondsPerTick(tempo);
    lastTick = entry.tick;
    if (entry.tempo) tempo = entry.tempo;
    else {
      if (entry.data) sysex.set(messages.length, entry.data);
      times.push(seconds);
      messages.push(entry.message);
    }
  }
  const duration = seconds + Math.max(0, endTick - lastTick) * secondsPerTick(tempo);
  return { title, duration, metadata, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex };
}
const MUS_CONTROLLERS = [0, 0, 1, 7, 10, 11, 91, 93, 64, 67];
const MUS_SYSTEM = { 10: 120, 11: 123, 12: 126, 13: 127, 14: 121 };
const MUS_RATE = 140;
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
  return { title: "", duration: tick / MUS_RATE, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex: /* @__PURE__ */ new Map() };
}

const SYNTH_IMPORTS = { env: { emscripten_notify_memory_growth: () => void 0 } };
const RENDER_BLOCK = 128;
const SOUNDFONT_ENGINE = "TinySoundFont 0.9";
const FM_ENGINE = "libADLMIDI 1.6.2, Nuked OPL3";
const DRUMS = 9;
class PlanarOutput {
  constructor(memory, out) {
    this.memory = memory;
    this.out = out;
    this.view = new Float32Array(memory.buffer, out, RENDER_BLOCK * 2);
  }
  memory;
  out;
  view;
  copy(left, right, at, n, gain) {
    if (this.view.buffer !== this.memory.buffer) this.view = new Float32Array(this.memory.buffer, this.out, RENDER_BLOCK * 2);
    const view = this.view;
    for (let i = 0; i < n; i++) {
      left[at + i] = view[i] * gain;
      right[at + i] = view[n + i] * gain;
    }
  }
}
function text(memory, at, max) {
  const heap = new Uint8Array(memory.buffer);
  let value = "";
  for (let p = at; heap[p] && value.length < max; p++) value += String.fromCharCode(heap[p]);
  return value;
}
class HeapWriter {
  constructor(memory) {
    this.memory = memory;
    this.heap = new Uint8Array(memory.buffer);
  }
  memory;
  heap;
  write(at, bytes, offset, length) {
    if (this.heap.buffer !== this.memory.buffer) this.heap = new Uint8Array(this.memory.buffer);
    if (!at || at + length > this.heap.length) throw new Error("The synthesizer returned an invalid SysEx buffer");
    const heap = this.heap;
    for (let i = 0; i < length; i++) heap[at + i] = bytes[offset + i];
  }
}
class SoundFontVoices {
  constructor(instance, soundfont, options) {
    this.options = options;
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.synth_render(0));
    this.load(soundfont);
  }
  options;
  kind = "soundfont";
  name = SOUNDFONT_ENGINE;
  wasm;
  output;
  list = [];
  /** The GM Master Volume as an amplitude factor; FFh and the resets return it to 1. */
  master = 1;
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
    if (status === MIDI_RESET) this.master = 1;
    this.wasm.synth_message(status, data1, data2);
  }
  /** TinySoundFont has no SysEx: the resets act as FFh, and GM Master Volume (F0 7F <device> 04 01 <lsb> <msb> F7)
   *  scales the output at once, on the curve that TinySoundFont gives channel volume (tsf.h: the cube of the 14-bit
   *  level over 16383), so master volume v sounds as channel volume v would. Other messages are ignored. */
  sysex(bytes, offset, length) {
    if (isResetMessage(bytes, offset, length)) {
      this.message(MIDI_RESET, 0, 0);
      return;
    }
    const level = masterVolume(bytes, offset, length);
    if (level >= 0) this.master = (level / 16383) ** 3;
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
    this.output.copy(left, right, at, n, this.master);
  }
  voices() {
    return this.wasm.synth_voices();
  }
  close() {
  }
}
const SOUNDFONT_GAIN_DB = -6;
const FM_GAIN = 2.5;
class FmVoices {
  kind;
  name;
  wasm;
  output;
  heap;
  sysexAt;
  names = [];
  current;
  constructor(instance, options, kind = "fm") {
    this.kind = kind;
    this.name = kind === "sb16-opl3" ? "Sound Blaster 16 (Yamaha OPL3)" : FM_ENGINE;
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    if (!this.wasm.fm_init(options.sampleRate, kind === "sb16-opl3" ? 1 : options.chips, options.fmBank)) throw new Error("The FM synthesizer rejected its settings");
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.fm_render(0));
    this.heap = new HeapWriter(this.wasm.memory);
    this.sysexAt = this.wasm.fm_sysex_buffer() >>> 0;
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
  /** libADLMIDI's realTime_SysEx receives the message (fm.cpp fm_sysex): GM System On and Off, the GS reset and its
   *  rhythm part assignment, XG System On, GM Master Volume. A reset first resets as FFh does, since libADLMIDI's own
   *  keeps the voices sounding and each channel's bank and program. */
  sysex(bytes, offset, length) {
    if (isResetMessage(bytes, offset, length)) this.message(MIDI_RESET, 0, 0);
    this.heap.write(this.sysexAt, bytes, offset, length);
    if (!this.wasm.fm_sysex(length)) throw new Error("The FM synthesizer rejected a SysEx message");
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
}

const CHANNELS = 16;
class Engine {
  options;
  maxFrames = RENDER_BLOCK;
  active;
  soundfont = null;
  loaded = /* @__PURE__ */ new Map();
  get fm() {
    if (this.active instanceof FmVoices) return this.active;
    const v = this.loaded.get("fm") ?? this.loaded.get("sb16-opl3");
    return v instanceof FmVoices ? v : null;
  }
  /** The loaded engines on libADLMIDI's banks: 'fm', 'sb16-opl3' and the 'sb16-cqm' profile, which setFmBank and
   *  loadFmBank keep on one bank. */
  fmFamily() {
    const out = [];
    for (const v of this.loaded.values()) if (v instanceof FmVoices || v instanceof NativeProfileVoices && v.kind === "sb16-cqm") out.push(v);
    return out;
  }
  /** The embedded bank the FM engines play (an engine loaded later starts on it), options.fmBank before one is loaded
   *  or while they play a WOPL file. */
  fmBank() {
    for (const v of this.fmFamily()) {
      const bank = v instanceof FmVoices ? v.info().bank : v.bank;
      if (bank >= 0) return bank;
    }
    return this.options.fmBank;
  }
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
    try {
      this.active.message(MIDI_RESET, 0, 0);
      this.attach(voices);
    } catch (error) {
      voices.close();
      throw error;
    }
  }
  /** An engine with TinySoundFont on instance (midi-synth.wasm) and the SoundFont 2 file soundfont. */
  static withSoundFont(instance, soundfont, options = {}) {
    return new Engine(new SoundFontVoices(instance, soundfont, normalizeOptions(options)), options);
  }
  /** An engine with libADLMIDI on instance (fm-synth.wasm), options.chips chips and embedded bank options.fmBank. */
  static withFm(instance, options = {}) {
    return new Engine(new FmVoices(instance, normalizeOptions(options), options.engine === "sb16-opl3" ? "sb16-opl3" : "fm"), options);
  }
  attach(voices) {
    this.loaded.set(voices.kind, voices);
    if (voices instanceof SoundFontVoices) this.soundfont = voices;
  }
  ensure() {
    if (!this.active) throw new Error("Synth is disposed");
    return this.active;
  }
  info() {
    const v = this.ensure();
    const engines = [...this.loaded.keys()].sort((a, b) => (a === "soundfont" ? -2 : a === "fm" ? -1 : 0) - (b === "soundfont" ? -2 : b === "fm" ? -1 : 0));
    const fm = v instanceof NativeProfileVoices && v.kind === "sb16-cqm" ? { banks: [...FM_BANK_NAMES], bank: v.bank, chips: 1 } : this.fm?.info();
    return { engine: v.name, kind: v.kind, ...v.kind === "fm" ? {} : { profile: v.kind }, engines, sampleRate: this.options.sampleRate, maxVoices: v.maxVoices(), presets: v.presets(), ...fm ? { fm } : {} };
  }
  /** The engines loaded so far. */
  has(kind) {
    return this.loaded.has(kind);
  }
  /** Adds the other engine, made by SoundFontVoices or FmVoices with this engine's options. With replace, voices take
   *  the place of the loaded engine of their kind (a native profile on new sources): when that one plays, a file plays
   *  on through voices with its state replayed, as after use(). Replacing in place, rather than unloading the engine
   *  and loading it anew, keeps the file's clock, the held notes and the other loaded engines, so the swap sounds like
   *  a program change. VERIFIED: tests/profiles.test.ts "a new pack for a loaded one takes its place" (position kept,
   *  the file's program replayed into the new engine). */
  add(voices, replace = false) {
    let old;
    try {
      this.ensure();
      old = this.loaded.get(voices.kind);
      if (old && !replace) throw new Error(`The ${voices.kind} engine is already loaded`);
      voices.message(MIDI_RESET, 0, 0);
    } catch (error) {
      voices.close();
      throw error;
    }
    this.attach(voices);
    if (!old) return;
    if (this.active === old) {
      const held = this.held.slice();
      this.silence();
      this.held.set(held);
      this.active = voices;
      this.restore();
    }
    old.close();
  }
  /** Makes kind's engine play. The voices of the other one end; a loaded file keeps its position and plays on, with
   *  its controllers and programs up to the position replayed into the new engine and its held notes struck again. */
  use(kind) {
    const current = this.ensure(), next = this.loaded.get(engineKind(kind));
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
  /** Selects the embedded bank (banks.ini's number) of every loaded FM engine: 'fm', 'sb16-opl3' and the 'sb16-cqm'
   *  profile (a new pack for its core); a file keeps playing with its state replayed. */
  setFmBank(bank) {
    integer(bank, 0, FM_BANKS - 1, "FM bank");
    this.changeFmBank((v) => v.setBank(bank));
  }
  /** Replaces the instruments of every loaded FM engine with a WOPL bank file; a rejected file keeps the bank. */
  loadFmBank(data) {
    this.changeFmBank((v) => v.loadBank(data));
  }
  /** Applies a bank change to every loaded FM engine, the CQM first: its core may reject the bank, and goes first so a
   *  rejection leaves every engine on the bank it had. The CQM changes banks by restarting its core, which a rejection
   *  restarts on the pack it had, at power-on state: when it plays, the file's state is replayed then as after a change. */
  changeFmBank(apply) {
    const active = this.ensure(), family = this.fmFamily();
    if (!family.length) throw new Error("The fm engine is not loaded");
    try {
      for (const v of [...family].sort((a, b) => +(a instanceof FmVoices) - +(b instanceof FmVoices))) apply(v);
    } catch (error) {
      if (active instanceof NativeProfileVoices && active.kind === "sb16-cqm") this.restore();
      throw error;
    }
    if (family.includes(active)) this.restore();
  }
  /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
   *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
  voices() {
    return this.ensure().voices();
  }
  /** MIDI and SysEx the active engine could not take since it loaded: a native profile whose input queue was full,
   *  such as the Sound Canvas cores' MIDI IN; 0 on the other engines, which take everything. */
  dropped() {
    const v = this.ensure();
    return v instanceof NativeProfileVoices ? v.dropped : 0;
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
    return song.metadata ? { ...this.playbackInfo(), metadata: song.metadata } : this.playbackInfo();
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
  /** The General MIDI state, then the file's state before message index count in file order, so a new engine or bank
   *  continues the file as it stood: every system exclusive message and reset, and of each channel's program, pitch
   *  bend, channel pressure and controller value the last one. A message that a later one of its kind replaces leaves
   *  nothing behind, and the Sound Canvas cores take MIDI at 3,125 bytes per second into 16 KiB, so a seek in a file of
   *  many controller changes would wait seconds, or overflow (dropped), behind ones that change nothing. Bank select,
   *  RPN, NRPN, data entry and the channel mode messages act on what comes after them: all of those go. */
  chase(count) {
    this.message(MIDI_RESET);
    const song = this.song;
    if (!song) return;
    const keep = chaseMask(song.messages, count);
    for (let i = 0; i < count; i++) if (keep[i]) this.apply(song, i);
  }
  /** Plays message index of song: a channel message, a reset, or a system exclusive message, which reaches the active
   *  engine as it is (each engine resets on the GM, GM2, GS and XG resets itself). */
  apply(song, index) {
    const data = (song.messages[index] & 240) === 240 ? song.sysex.get(index) : void 0;
    if (data) this.ensure().sysex(data, 0, data.length);
    else this.message(song.messages[index]);
  }
  /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
  restore() {
    this.chase(this.song ? this.index : 0);
    for (let i = 0; i < this.held.length; i++) if (this.held[i]) this.ensure().message(144 | i >> 7, i & 127, this.held[i]);
  }
  /** Plays file message index and keeps note on and off in held; a reset ends every held note. */
  play1(song, index) {
    const message = song.messages[index], kind = message & 240, key = (message & 15) << 7 | message >>> 8 & 127, velocity = message >>> 16 & 127;
    if (kind === 144) this.held[key] = velocity;
    else if (kind === 128) this.held[key] = 0;
    else if (kind === 176 && ((message >>> 8 & 127) === 123 || (message >>> 8 & 127) === 120)) this.held.fill(0, key & -128, (key & -128) + 128);
    else if (message === MIDI_RESET) this.held.fill(0);
    this.apply(song, index);
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
  /** Plays the system exclusive message of length bytes at offset in bytes (F0 through F7, validated by the caller) on
   *  the active engine at once; the scheduler passes its payload store, so nothing is allocated. */
  sysex(bytes, offset, length) {
    this.ensure().sysex(bytes, offset, length);
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
        while (this.index < song.messages.length && this.songFrames[this.index] <= this.position) this.play1(song, this.index++);
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
    for (const voice of this.loaded.values()) voice.close();
    this.loaded.clear();
    this.active = null;
    this.soundfont = null;
    this.song = null;
  }
}
const CHASE_ALL = /* @__PURE__ */ new Set([0, 6, 32, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);
function chaseMask(messages, count) {
  const keep = new Uint8Array(count), seen = new Uint8Array(16 * 131);
  for (let i = count - 1; i >= 0; i--) {
    const m = messages[i], kind = m & 240, slot = (m & 15) * 131;
    if (kind === 128 || kind === 144 || kind === 160) continue;
    const key = kind === 176 ? CHASE_ALL.has(m >>> 8 & 127) ? -1 : slot + (m >>> 8 & 127) : kind === 192 ? slot + 128 : kind === 224 ? slot + 129 : kind === 208 ? slot + 130 : -1;
    if (key >= 0) {
      if (seen[key]) continue;
      seen[key] = 1;
    }
    keep[i] = 1;
  }
  return keep;
}

const MAX_QUEUED_SYSEX_BYTES = 16 * 1024 * 1024;
class EventQueue {
  constructor(capacity = 8192) {
    this.capacity = capacity;
    integer(capacity, 1, 1048576, "queue capacity");
    this.frames = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.ops = new Int32Array(capacity * 4);
  }
  capacity;
  frames;
  order;
  ops;
  serial = 0;
  size = 0;
  /** The bytes of the queued SysEx messages; sysex events index it (offset, length) until they are taken. */
  payload = new Uint8Array(0);
  payloadEnd = 0;
  payloadLive = 0;
  get nextFrame() {
    return this.size ? this.frames[0] : Infinity;
  }
  /** The SysEx bytes that queued events hold. */
  get sysexBytes() {
    return this.payloadLive;
  }
  clear() {
    this.size = 0;
    this.serial = 0;
    this.payloadEnd = 0;
    this.payloadLive = 0;
  }
  /** Preflight the entire batch so rejection never leaves half a score scheduled. A sysex event ([frame, OP.sysex,
   *  index, 0, 0]) takes its message, F0 through F7, from payloads[index]. */
  pushBatch(events, payloads = []) {
    if (events.length > this.capacity - this.size) throw new RangeError("Event queue full");
    if (this.serial + events.length > Number.MAX_SAFE_INTEGER) throw new RangeError("Event sequence exhausted");
    if (!Array.isArray(payloads)) throw new TypeError("Invalid SysEx payloads");
    let bytes = 0;
    for (const event of events) {
      if (!Array.isArray(event) || event.length !== 5) throw new TypeError("Invalid packed event");
      integer(event[0], 0, Number.MAX_SAFE_INTEGER, "frame");
      integer(event[1], 0, OP_COUNT - 1, "operation");
      if (event[1] === OP.sysex) {
        const data = payloads[integer(event[2], 0, payloads.length - 1, "SysEx payload index")];
        if (!(data instanceof Uint8Array) || !isSysEx(data)) throw new RangeError("Invalid SysEx payload");
        integer(event[3], 0, 0, "operand");
        integer(event[4], 0, 0, "operand");
        bytes += data.length;
      } else for (let j = 2; j < 5; j++) integer(event[j], 0, OPERAND_MAX, "operand");
    }
    if (bytes > MAX_QUEUED_SYSEX_BYTES - this.payloadLive) throw new RangeError("SysEx queue full");
    if (bytes > this.payload.length - this.payloadEnd) this.reserve(bytes);
    for (const e of events) {
      let i = this.size++;
      this.frames[i] = e[0];
      this.order[i] = this.serial++;
      if (e[1] === OP.sysex) {
        const data = payloads[e[2]];
        this.payload.set(data, this.payloadEnd);
        this.ops[i * 4] = OP.sysex;
        this.ops[i * 4 + 1] = this.payloadEnd;
        this.ops[i * 4 + 2] = data.length;
        this.ops[i * 4 + 3] = 0;
        this.payloadEnd += data.length;
        this.payloadLive += data.length;
      } else for (let j = 0; j < 4; j++) this.ops[i * 4 + j] = e[j + 1];
      while (i > 0) {
        const p = i - 1 >>> 1;
        if (!this.before(i, p)) break;
        this.swap(i, p);
        i = p;
      }
    }
  }
  /** Moves the live SysEx messages to the front of a store with room for bytes more after them: the current store when
   *  it is large enough, else one twice as large or as large as needed. */
  reserve(bytes) {
    const need = this.payloadLive + bytes;
    const target = need <= this.payload.length ? this.payload : new Uint8Array(Math.min(MAX_QUEUED_SYSEX_BYTES, Math.max(need, this.payload.length * 2, 65536)));
    const held = [];
    for (let i = 0; i < this.size; i++) if (this.ops[i * 4] === OP.sysex) held.push(i);
    held.sort((a, b) => this.ops[a * 4 + 1] - this.ops[b * 4 + 1]);
    let at = 0;
    for (const i of held) {
      const from = this.ops[i * 4 + 1], length = this.ops[i * 4 + 2];
      if (target === this.payload) target.copyWithin(at, from, from + length);
      else target.set(this.payload.subarray(from, from + length), at);
      this.ops[i * 4 + 1] = at;
      at += length;
    }
    this.payload = target;
    this.payloadEnd = at;
  }
  /** Write into caller-owned scratch, never allocate while popping. A sysex event's message stays in payload at the
   *  offset and length of target[1] and target[2] until the next pushBatch or clear. */
  pop(target) {
    if (!this.size) throw new RangeError("Empty event queue");
    for (let j = 0; j < 4; j++) target[j] = this.ops[j];
    if (this.ops[0] === OP.sysex && (this.payloadLive -= this.ops[2]) === 0) this.payloadEnd = 0;
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
}

const RENDER_GRID = 64;
class RenderSession {
  constructor(engine, capacity = 8192) {
    this.engine = engine;
    this.queue = new EventQueue(capacity);
  }
  engine;
  queue;
  scratch = new Int32Array(4);
  frame = 0;
  lateEvents = 0;
  /** Adds a batch atomically; sysex events take their messages from payloads (packEvent). */
  schedule(events, payloads) {
    this.queue.pushBatch(events, payloads);
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
        if (this.scratch[0] === OP.sysex) this.engine.sysex(this.queue.payload, this.scratch[1], this.scratch[2]);
        else this.engine.dispatch(this.scratch[0], this.scratch[1], this.scratch[2], this.scratch[3]);
      }
      const frames = Math.min(left.length - offset, this.engine.maxFrames, this.queue.nextFrame - this.frame, RENDER_GRID - this.frame % RENDER_GRID);
      this.engine.render(left, right, offset, frames);
      offset += frames;
      this.frame += frames;
    }
  }
}

const MAX_WAV_FRAMES = Math.floor((4294967295 - 36) / 4);
class EngineLoader {
  constructor(settings, base, soundfont, onProgress, sources, readWasm = readBytes) {
    this.settings = settings;
    this.base = base;
    this.soundfont = soundfont;
    this.onProgress = onProgress;
    this.sources = sources;
    this.readWasm = readWasm;
  }
  settings;
  base;
  soundfont;
  onProgress;
  sources;
  readWasm;
  modules = /* @__PURE__ */ new Map();
  /** The compiled module of a built-in engine; a failed read or compile is tried again next time. */
  module(kind) {
    const key = moduleKey(kind);
    let module = this.modules.get(key);
    if (!module) {
      module = this.readWasm(new URL(key, this.base), void 0, this.onProgress).then((bytes) => WebAssembly.compile(bytes));
      this.modules.set(key, module);
      module.catch(() => this.modules.delete(key));
    }
    return module;
  }
  /** kind's voices; an FM engine (fm, sb16-opl3, sb16-cqm) starts on the embedded bank fmBank gives once it has
   *  loaded, so a bank selected while it loaded is the one it plays, as in the worklet. */
  async voices(kind, fmBank = () => this.settings.fmBank) {
    const { settings } = this;
    if (isNativeProfile(kind)) {
      const part = await nativePart(kind, this.base, this.sources, true, void 0, this.onProgress, true, this.readWasm);
      return new NativeProfileVoices(kind, instantiateProfile(part.module), new Uint8Array(part.assets), settings.sampleRate, fmBank());
    }
    if (kind === "fm" || kind === "sb16-opl3") {
      const instance = await WebAssembly.instantiate(await this.module(kind), SYNTH_IMPORTS);
      return new FmVoices(instance, { ...settings, fmBank: fmBank() }, kind);
    }
    const [module, font] = await Promise.all([this.module("soundfont"), soundFontBytes(this.soundfont, this.base, SOUNDFONT_ASSET, void 0, this.onProgress)]);
    return new SoundFontVoices(await WebAssembly.instantiate(module, SYNTH_IMPORTS), font, settings);
  }
}
class OfflineSynth {
  constructor(engine, capacity, loader) {
    this.engine = engine;
    this.loader = loader;
    this.session = new RenderSession(engine, capacity);
  }
  engine;
  loader;
  session;
  stream = new MidiStream();
  /** Engines being loaded, so concurrent useEngine calls share one load. VERIFIED: without it the second call's add
   *  threw 'already loaded'. */
  loading = /* @__PURE__ */ new Map();
  static async create(options = {}) {
    const settings = normalizeOptions({ ...options, engine: selectEngine(options.engine, options.profile) });
    const capacity = integer(options.queueCapacity ?? 8192, 1, 1048576, "queueCapacity");
    const base = options.baseUrl ? new URL(options.baseUrl, import.meta.url) : new URL("./", import.meta.url);
    const loader = new EngineLoader(settings, base, options.soundfont, options.onProgress, options.profileSources, options.readWasm);
    return new OfflineSynth(new Engine(await loader.voices(settings.engine), settings), capacity, loader);
  }
  get info() {
    return this.engine.info();
  }
  /** Makes a hardware profile play (SYNTH_PROFILES; the legacy 'fm' engine is not one), as useEngine does. A profile
   *  that is not available rejects with an Error naming it, and the engine that played plays on. sources (a native
   *  profile's pack or module, as in profileSources) join that profile's profileSources: an unloaded profile loads with
   *  them, a loaded one loads again with them in its place (a file plays on), and a pack or module its core rejects
   *  leaves the loaded one. A profile still loading rejects them. */
  async useProfile(profile, sources) {
    if (!isSynthProfile(profile)) throw new RangeError("Unknown synth profile");
    if (sources) {
      const previous = this.loader.sources;
      this.loader.sources = withProfileSources(this.loader.sources, profile, sources, this.loading.has(profile));
      if (this.engine.has(profile)) {
        const load = this.loader.voices(profile, () => this.engine.fmBank()).then((voices) => this.engine.add(voices, true)).finally(() => this.loading.delete(profile));
        this.loading.set(profile, load);
        try {
          await load;
        } catch (error) {
          this.loader.sources = previous;
          throw error;
        }
      }
    }
    return this.useEngine(profile);
  }
  /** Makes kind's engine play, loading it first when needed; a loaded file plays on and scheduled events are cleared,
   *  as in the browser. */
  async useEngine(kind) {
    engineKind(kind);
    if (!this.engine.has(kind)) {
      let load = this.loading.get(kind);
      if (!load) {
        load = this.loader.voices(kind, () => this.engine.fmBank()).then((voices) => this.engine.add(voices)).finally(() => this.loading.delete(kind));
        this.loading.set(kind, load);
      }
      await load;
    }
    this.session.clear();
    this.engine.use(kind);
    return this.engine.info();
  }
  /** Replaces the SoundFont engine's SoundFont with SF2 bytes or a URL relative to baseUrl, plain or Brotli-compressed;
   *  scheduled events are cleared. Without the SoundFont engine it rejects before reading the file. */
  async loadSoundFont(source) {
    if (!this.engine.has("soundfont")) throw new Error("The soundfont engine is not loaded");
    const bytes = await soundFontBytes(source, this.loader.base, SOUNDFONT_ASSET, void 0, this.loader.onProgress);
    this.session.clear();
    this.engine.loadSoundFont(bytes);
    return this.engine.info();
  }
  /** Selects the embedded bank (0 to 78, numbered as libADLMIDI's banks.ini) of every loaded FM engine: fm, sb16-opl3
   *  and sb16-cqm. */
  setFmBank(bank) {
    this.engine.setFmBank(bank);
    return this.engine.info();
  }
  /** Replaces the instruments of every loaded FM engine (fm, sb16-opl3, sb16-cqm) with a WOPL bank file (bytes, or a
   *  URL relative to baseUrl). */
  async loadFmBank(source) {
    this.engine.loadFmBank(await bankBytes(source, this.loader.base, void 0, this.loader.onProgress));
    return this.engine.info();
  }
  /** Schedules a batch atomically, as in the browser; a sysex event carries one message F0 through F7. */
  schedule(events) {
    const payloads = [];
    this.session.schedule(events.map((event) => packEvent(event, this.engine.options.sampleRate, payloads)), payloads);
  }
  /** Schedules the messages of a MIDI byte stream at time (seconds), system exclusive ones included; running status
   *  carries over between calls. */
  sendMidi(bytes, time) {
    this.schedule(this.stream.events(bytes, time));
  }
  /** Loads a Standard MIDI, RMI or MUS file for playback from its start; options.tempo scales its clock. Scheduled
   *  events are cleared, as in the browser. */
  loadMidi(data, options = {}) {
    this.session.clear();
    return this.engine.loadMidi(data instanceof ArrayBuffer ? new Uint8Array(data) : data, options);
  }
  /** Plays the loaded file from its position as the following renders advance; loop restarts it at its end. */
  play(loop = false) {
    this.engine.play(loop);
  }
  /** Allocating convenience method, up to the frames a WAV file holds. Use renderInto for repeated streaming blocks. */
  render(frames) {
    integer(frames, 0, MAX_WAV_FRAMES, "frames");
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.renderInto(left, right);
    return { sampleRate: this.engine.options.sampleRate, left, right };
  }
  renderInto(left, right) {
    this.session.process(left, right);
  }
  /** MIDI and SysEx the active engine's input could not take since it loaded, as MidiSynth's status().dropped. */
  get dropped() {
    return this.engine.dropped();
  }
  close() {
    this.session.clear();
    this.engine.close();
  }
}
function encodeWav(pcm) {
  integer(pcm.sampleRate, 8e3, 192e3, "sampleRate");
  if (pcm.left.length !== pcm.right.length) throw new RangeError("Stereo lengths differ");
  integer(pcm.left.length, 0, MAX_WAV_FRAMES, "WAV frames");
  const size = pcm.left.length * 4, bytes = new Uint8Array(44 + size), v = new DataView(bytes.buffer);
  const text = (at, value) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + size, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, pcm.sampleRate, true);
  v.setUint32(28, pcm.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, size, true);
  for (let i = 0; i < pcm.left.length; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const sample = ch ? pcm.right[i] : pcm.left[i];
      if (!Number.isFinite(sample)) throw new RangeError("PCM contains a non-finite sample");
      const clamped = Math.max(-1, Math.min(1, sample));
      v.setInt16(44 + i * 4 + ch * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
    }
  }
  return bytes;
}

export { OfflineSynth, encodeWav };
