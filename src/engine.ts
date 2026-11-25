import { FM_BANK_NAMES } from './fm-banks.ts';
import { parseSong, type Song } from './midifile.ts';
import { MIDI_RESET } from './parser.ts';
import { engineKind, finite, FM_BANKS, inputBytes, integer, MAX_SONG_BYTES, normalizeOptions, OP, type EngineKind, type EngineOptions, type PlaybackInfo, type SynthInfo, type MidiLoadOptions } from './types.ts';
import { NativeProfileVoices } from './profile-voices.ts';
import { FmVoices, RENDER_BLOCK, SoundFontVoices, type Voices } from './voices.ts';

export { SYNTH_IMPORTS, RENDER_BLOCK, SOUNDFONT_ENGINE, FM_ENGINE } from './voices.ts';
const CHANNELS = 16;
type FileState = 'idle' | 'playing' | 'paused' | 'ended';

/**
 * The synthesizer behind the browser and offline facades: one or both engines (TinySoundFont with a SoundFont, and
 * libADLMIDI on OPL3 chips), the MIDI file transport, and planar Float32 rendering into caller storage. One engine
 * plays at a time; switching keeps the file playing. Rendering allocates nothing in JavaScript.
 */
export class Engine {
  readonly options: Required<EngineOptions>;
  readonly maxFrames = RENDER_BLOCK;
  private active: Voices | null;
  private soundfont: SoundFontVoices | null = null;
  private readonly loaded = new Map<EngineKind, Voices>();
  private get fm(): FmVoices | null {
    if (this.active instanceof FmVoices) return this.active;
    const v = this.loaded.get('fm') ?? this.loaded.get('sb16-opl3');
    return v instanceof FmVoices ? v : null;
  }
  /** The loaded engines on libADLMIDI's banks: 'fm', 'sb16-opl3' and the 'sb16-cqm' profile, which setFmBank and
   *  loadFmBank keep on one bank. */
  private fmFamily(): (FmVoices | NativeProfileVoices)[] {
    const out: (FmVoices | NativeProfileVoices)[] = [];
    for (const v of this.loaded.values()) if (v instanceof FmVoices || (v instanceof NativeProfileVoices && v.kind === 'sb16-cqm')) out.push(v);
    return out;
  }
  /** The embedded bank the FM engines play (an engine loaded later starts on it), options.fmBank before one is loaded
   *  or while they play a WOPL file. */
  fmBank(): number {
    for (const v of this.fmFamily()) { const bank = v instanceof FmVoices ? v.info().bank : v.bank; if (bank >= 0) return bank; }
    return this.options.fmBank;
  }
  private song: Song | null = null;
  private songFrames = new Float64Array(0);
  private endFrame = 0;
  private index = 0;
  /** The file's position in its own frames; it advances rate frames per output frame. */
  private position = 0;
  private rate = 1;
  private state: FileState = 'idle';
  private loop = false;
  /** The velocity of each note the file holds now (channel * 128 + note), so a new engine strikes it again. */
  private readonly held = new Uint8Array(CHANNELS * 128);

  /** Starts with voices, made from options by SoundFontVoices or FmVoices. */
  constructor(voices: Voices, options: EngineOptions = {}) {
    this.options = normalizeOptions({ ...options, engine: voices.kind });
    this.active = voices;
    try { this.active.message(MIDI_RESET, 0, 0); this.attach(voices); }
    catch (error) { voices.close(); throw error; }
  }
  /** An engine with TinySoundFont on instance (midi-synth.wasm) and the SoundFont 2 file soundfont. */
  static withSoundFont(instance: WebAssembly.Instance, soundfont: Uint8Array, options: EngineOptions = {}): Engine {
    return new Engine(new SoundFontVoices(instance, soundfont, normalizeOptions(options)), options);
  }
  /** An engine with libADLMIDI on instance (fm-synth.wasm), options.chips chips and embedded bank options.fmBank. */
  static withFm(instance: WebAssembly.Instance, options: EngineOptions = {}): Engine {
    return new Engine(new FmVoices(instance, normalizeOptions(options), options.engine === 'sb16-opl3' ? 'sb16-opl3' : 'fm'), options);
  }
  private attach(voices: Voices): void {
    this.loaded.set(voices.kind, voices);
    if (voices instanceof SoundFontVoices) this.soundfont = voices;
  }
  private ensure(): Voices {
    if (!this.active) throw new Error('Synth is disposed');
    return this.active;
  }
  info(): SynthInfo {
    const v = this.ensure();
    const engines = [...this.loaded.keys()].sort((a, b) => (a === 'soundfont' ? -2 : a === 'fm' ? -1 : 0) - (b === 'soundfont' ? -2 : b === 'fm' ? -1 : 0));
    // On the CQM the FM information is its own bank, one chip and the embedded banks' names.
    const fm = v instanceof NativeProfileVoices && v.kind === 'sb16-cqm' ? { banks: [...FM_BANK_NAMES], bank: v.bank, chips: 1 } : this.fm?.info();
    return { engine: v.name, kind: v.kind, ...(v.kind === 'fm' ? {} : { profile: v.kind }), engines, sampleRate: this.options.sampleRate, maxVoices: v.maxVoices(), presets: v.presets(), ...(fm ? { fm } : {}) };
  }
  /** The engines loaded so far. */
  has(kind: EngineKind): boolean { return this.loaded.has(kind); }
  /** Adds the other engine, made by SoundFontVoices or FmVoices with this engine's options. With replace, voices take
   *  the place of the loaded engine of their kind (a native profile on new sources): when that one plays, a file plays
   *  on through voices with its state replayed, as after use(). Replacing in place, rather than unloading the engine
   *  and loading it anew, keeps the file's clock, the held notes and the other loaded engines, so the swap sounds like
   *  a program change. VERIFIED: tests/profiles.test.ts "a new pack for a loaded one takes its place" (position kept,
   *  the file's program replayed into the new engine). */
  add(voices: Voices, replace = false): void {
    let old: Voices | undefined;
    try {
      this.ensure();
      old = this.loaded.get(voices.kind);
      if (old && !replace) throw new Error(`The ${voices.kind} engine is already loaded`);
      voices.message(MIDI_RESET, 0, 0);
    } catch (error) { voices.close(); throw error; }
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
  use(kind: EngineKind): void {
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
  loadSoundFont(data: Uint8Array): void {
    this.ensure();
    if (!this.soundfont) throw new Error('The soundfont engine is not loaded');
    if (this.active === this.soundfont) this.stop();
    this.soundfont.load(data);
  }
  /** Selects the embedded bank (banks.ini's number) of every loaded FM engine: 'fm', 'sb16-opl3' and the 'sb16-cqm'
   *  profile (a new pack for its core); a file keeps playing with its state replayed. */
  setFmBank(bank: number): void {
    integer(bank, 0, FM_BANKS - 1, 'FM bank');
    this.changeFmBank(v => v.setBank(bank));
  }
  /** Replaces the instruments of every loaded FM engine with a WOPL bank file; a rejected file keeps the bank. */
  loadFmBank(data: Uint8Array): void { this.changeFmBank(v => v.loadBank(data)); }
  /** Applies a bank change to every loaded FM engine, the CQM first: its core may reject the bank, and goes first so a
   *  rejection leaves every engine on the bank it had. The CQM changes banks by restarting its core, which a rejection
   *  restarts on the pack it had, at power-on state: when it plays, the file's state is replayed then as after a change. */
  private changeFmBank(apply: (v: FmVoices | NativeProfileVoices) => void): void {
    const active = this.ensure(), family = this.fmFamily();
    if (!family.length) throw new Error('The fm engine is not loaded');
    try { for (const v of [...family].sort((a, b) => +(a instanceof FmVoices) - +(b instanceof FmVoices))) apply(v); }
    catch (error) { if (active instanceof NativeProfileVoices && active.kind === 'sb16-cqm') this.restore(); throw error; }
    if ((family as Voices[]).includes(active)) this.restore();
  }
  /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
   *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
  voices(): number { return this.ensure().voices(); }
  /** MIDI and SysEx the active engine could not take since it loaded: a native profile whose input queue was full,
   *  such as the Sound Canvas cores' MIDI IN; 0 on the other engines, which take everything. */
  dropped(): number { const v = this.ensure(); return v instanceof NativeProfileVoices ? v.dropped : 0; }
  hasPreset(bank: number, program: number): boolean {
    return this.ensure().presets().some(p => p.bank === bank && p.program === program);
  }
  /** Parses a MIDI, RMI or MUS file and positions it at its start. Stops the previous file; a rejected file leaves
   *  none loaded. Every channel returns to its General MIDI state. */
  loadMidi(data: Uint8Array, options: MidiLoadOptions = {}): PlaybackInfo {
    const bytes = inputBytes(data, MAX_SONG_BYTES, 'file length');
    const tempo = finite(options.tempo ?? 1, 0.25, 4, 'tempo');
    this.stop();
    this.song = null;
    const parsed = parseSong(bytes), rate = this.options.sampleRate;
    const song = tempo === 1 ? parsed : { ...parsed, times: parsed.times.map(time => time / tempo), duration: parsed.duration / tempo };
    this.songFrames = song.times.map(time => Math.round(time * rate));
    this.endFrame = Math.round(song.duration * rate);
    this.song = song;
    this.index = 0;
    this.position = 0;
    this.message(MIDI_RESET);
    return this.playbackInfo();
  }
  private requireSong(): Song {
    this.ensure();
    if (!this.song) throw new Error('Load a MIDI file first');
    return this.song;
  }
  play(loop = false): void {
    this.requireSong();
    this.loop = loop;
    if (this.state === 'ended') this.seek(0);
    this.state = 'playing';
  }
  /** Freezes file playback and the synthesizer; render emits silence until play. */
  pause(): void { this.ensure(); if (this.state === 'playing') this.state = 'paused'; }
  /** Ends every sound at once and rewinds a loaded file to its start, in the General MIDI state. */
  stop(): void {
    this.ensure();
    this.silence();
    if (this.song) { this.index = 0; this.position = 0; this.message(MIDI_RESET); }
    this.state = 'idle';
  }
  /** Ends every sound at once; queued and file events still follow. */
  panic(): void { this.ensure(); this.silence(); }
  /** Moves the file to seconds: resets the channels and applies every non-note message before that time. */
  seek(seconds: number): void {
    const song = this.requireSong();
    finite(seconds, 0, song.duration, 'seek position');
    this.silence();
    const target = Math.round(seconds * this.options.sampleRate);
    let i = 0;
    while (i < song.messages.length && this.songFrames[i]! < target) i++;
    this.chase(i);
    this.index = i;
    this.position = target;
    if (this.state === 'ended') this.state = 'idle';
  }
  /** Sets the file's playback rate, 0.25 to 4: 2 plays it twice as fast at the same pitch. */
  setRate(rate: number): void { this.ensure(); this.rate = finite(rate, 0.25, 4, 'playback rate'); }
  /** The General MIDI state, then the file's state before message index count in file order, so a new engine or bank
   *  continues the file as it stood: every system exclusive message and reset, and of each channel's program, pitch
   *  bend, channel pressure and controller value the last one. A message that a later one of its kind replaces leaves
   *  nothing behind, and the Sound Canvas cores take MIDI at 3,125 bytes per second into 16 KiB, so a seek in a file of
   *  many controller changes would wait seconds, or overflow (dropped), behind ones that change nothing. Bank select,
   *  RPN, NRPN, data entry and the channel mode messages act on what comes after them: all of those go. */
  private chase(count: number): void {
    this.message(MIDI_RESET);
    const song = this.song;
    if (!song) return;
    const keep = chaseMask(song.messages, count);
    for (let i = 0; i < count; i++) if (keep[i]) this.apply(song, i);
  }
  /** Plays message index of song: a channel message, a reset, or a system exclusive message, which reaches the active
   *  engine as it is (each engine resets on the GM, GM2, GS and XG resets itself). */
  private apply(song: Song, index: number): void {
    const data = (song.messages[index]! & 0xf0) === 0xf0 ? song.sysex.get(index) : undefined;
    if (data) this.ensure().sysex(data, 0, data.length);
    else this.message(song.messages[index]!);
  }
  /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
  private restore(): void {
    this.chase(this.song ? this.index : 0);
    for (let i = 0; i < this.held.length; i++) if (this.held[i]) this.ensure().message(0x90 | i >> 7, i & 127, this.held[i]!);
  }
  /** Plays file message index and keeps note on and off in held; a reset ends every held note. */
  private play1(song: Song, index: number): void {
    const message = song.messages[index]!, kind = message & 0xf0, key = (message & 0x0f) << 7 | message >>> 8 & 0x7f, velocity = message >>> 16 & 0x7f;
    if (kind === 0x90) this.held[key] = velocity;
    else if (kind === 0x80) this.held[key] = 0;
    else if (kind === 0xb0 && ((message >>> 8 & 0x7f) === 123 || (message >>> 8 & 0x7f) === 120)) this.held.fill(0, key & ~127, (key & ~127) + 128);
    else if (message === MIDI_RESET) this.held.fill(0);
    this.apply(song, index);
  }
  playbackInfo(): PlaybackInfo {
    this.ensure();
    const song = this.song, rate = this.options.sampleRate;
    return { title: song?.title ?? '', duration: song?.duration ?? 0, position: song ? Math.min(song.duration, this.position / rate) : 0, ended: this.state === 'ended', rate: this.rate };
  }
  /** Plays one packed message (status, data 1 << 8, data 2 << 16) or MIDI_RESET at once. */
  message(packed: number): void {
    this.ensure().message(packed & 0xff, packed >>> 8 & 0xff, packed >>> 16 & 0xff);
  }
  /** Plays the system exclusive message of length bytes at offset in bytes (F0 through F7, validated by the caller) on
   *  the active engine at once; the scheduler passes its payload store, so nothing is allocated. */
  sysex(bytes: Uint8Array, offset: number, length: number): void { this.ensure().sysex(bytes, offset, length); }
  /** Called by the validated scheduler with scalar operands, avoiding event objects. */
  dispatch(op: number, a: number, b: number, c: number): void {
    const v = this.ensure();
    switch (op) {
      case OP.noteOn: v.message(0x90 | a, b, c); break;
      case OP.noteOff: v.message(0x80 | a, b, 0); break;
      case OP.controlChange: v.message(0xb0 | a, b, c); break;
      case OP.programChange: v.message(0xc0 | a, b, 0); break;
      case OP.pitchBend: v.message(0xe0 | a, b & 0x7f, b >> 7); break;
      case OP.channelPressure: v.message(0xd0 | a, b, 0); break;
      case OP.polyPressure: v.message(0xa0 | a, b, c); break;
      case OP.preset: v.setPreset(a, b, c); break;
      case OP.reset: v.message(MIDI_RESET, 0, 0); break;
      default: throw new RangeError('Unknown event operation');
    }
  }
  private controlAll(controller: number): void {
    const v = this.ensure();
    for (let channel = 0; channel < CHANNELS; channel++) {
      v.message(0xb0 | channel, 64, 0);
      v.message(0xb0 | channel, controller, 0);
    }
  }
  /** Sustain off and All Sound Off (120) on every channel: voices end at once. */
  private silence(): void { this.controlAll(120); this.held.fill(0); }
  /** Sustain off and All Notes Off (123) on every channel: voices release. */
  private notesOff(): void { this.controlAll(123); this.held.fill(0); }
  /** The file reached its end: start again when looping, else end with the notes released. */
  private finish(): void {
    if (this.loop && this.endFrame > 0) {
      this.notesOff();
      this.index = 0;
      this.position = 0;
    } else {
      this.state = 'ended';
      this.notesOff();
    }
  }
  /** Writes frames (at most maxFrames) of planar Float32 PCM into left and right from offset, playing the file's
   *  messages at their frames: a message at file frame f plays at the first output frame where the file position,
   *  advancing rate frames per output frame, has reached f. */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    const v = this.ensure();
    integer(frames, 0, this.maxFrames, 'render frames');
    integer(offset, 0, Math.min(left.length, right.length) - frames, 'render offset');
    if (this.state === 'paused') { left.fill(0, offset, offset + frames); right.fill(0, offset, offset + frames); return; }
    let done = 0;
    while (done < frames) {
      let n = frames - done;
      if (this.state === 'playing') {
        const song = this.song!;
        while (this.index < song.messages.length && this.songFrames[this.index]! <= this.position) this.play1(song, this.index++);
        if (this.index >= song.messages.length && this.position >= this.endFrame) { this.finish(); continue; }
        const next = this.index < song.messages.length ? this.songFrames[this.index]! : this.endFrame;
        n = Math.min(n, Math.ceil((next - this.position) / this.rate));
      }
      v.render(left, right, offset + done, n);
      if (this.state === 'playing') this.position += n * this.rate;
      done += n;
    }
  }
  close(): void {
    for (const voice of this.loaded.values()) voice.close();
    this.loaded.clear();
    this.active = null; this.soundfont = null; this.song = null;
  }
}

/** Controllers whose effect depends on the messages around them (bank select before a program change, the RPN and NRPN
 *  numbers before data entry, the channel mode messages): chase keeps every one. */
const CHASE_ALL = new Set([0, 6, 32, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);
/** Which of the first count messages chase sends: notes none; system exclusive messages and resets all; per channel the
 *  last program, pitch bend and channel pressure, and the last value of each controller outside CHASE_ALL. */
export function chaseMask(messages: Uint32Array, count: number): Uint8Array {
  const keep = new Uint8Array(count), seen = new Uint8Array(16 * 131);
  for (let i = count - 1; i >= 0; i--) {
    const m = messages[i]!, kind = m & 0xf0, slot = (m & 0x0f) * 131;
    if (kind === 0x80 || kind === 0x90 || kind === 0xa0) continue;
    const key = kind === 0xb0 ? (CHASE_ALL.has(m >>> 8 & 0x7f) ? -1 : slot + (m >>> 8 & 0x7f)) : kind === 0xc0 ? slot + 128 : kind === 0xe0 ? slot + 129 : kind === 0xd0 ? slot + 130 : -1;
    if (key >= 0) { if (seen[key]) continue; seen[key] = 1; }
    keep[i] = 1;
  }
  return keep;
}
