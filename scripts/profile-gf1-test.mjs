/** gus-gf1 against the original Gravis patch set. Private assets: not part of `make test`.
 *   python3 scripts/profile-assets.py fetch-gus profile-assets/gus --memory 1024 --voices 32
 *   git clone --filter=blob:none --no-checkout https://github.com/alinebee/Boxer.git profile-assets/boxer
 *   git -C profile-assets/boxer checkout 0062fc18e154cde6cef3bf3329be4b0658597e31 -- "Resources/DOS Toolkit/ULTRASND"
 *   node --experimental-transform-types scripts/profile-gf1-test.mjs profile-assets/gus "profile-assets/boxer/Resources/DOS Toolkit/ULTRASND/MIDI"
 * Environment: GF1_FUZZ_CASES (default 20000), CC (default cc), SDKROOT for the native builds. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { NativeProfileVoices, instantiateProfile } from '../src/profile-voices.ts';
import { Core, gusModule, gusPack, parsePat, acRms, dB, fundamental, cents, noteHz, SDK_RATES, FLAG_16BIT, FLAG_PRELOAD, MODE } from '../tests/gf1-fixtures.ts';

const [mapped, full] = process.argv.slice(2);
const usage = 'Usage: node --experimental-transform-types scripts/profile-gf1-test.mjs MAPPED_DIR FULL_SET_DIR (see the header of this file)';
if (!mapped || !full) throw new Error(usage);
for (const f of ['gravis.sha256', 'ULTRAMID.INI', 'mapping-1024.json', 'gus-gf1-1024k.dspack']) if (!existsSync(join(mapped, f))) throw new Error(`Missing ${join(mapped, f)}: run fetch-gus. ${usage}`);
const fullPats = existsSync(full) ? readdirSync(full).filter(f => f.endsWith('.PAT')).sort() : [];
if (fullPats.length !== 190) throw new Error(`Expected the 190 Gravis patches in ${full}, found ${fullPats.length}. ${usage}`);

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const module = gusModule();
const sha256 = b => createHash('sha256').update(b).digest('hex');
const read = (d, f) => readFileSync(join(d, f));
const mapping = JSON.parse(read(mapped, 'mapping-1024.json').toString());
const pack1024 = read(mapped, 'gus-gf1-1024k.dspack');
const BLANK = 'BLANK.PAT';
/** ULTRAMID.INI rows: number -> [[256K, 512K, 768K, 1024K] substitutes, name]. */
function ultramidRows(text) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split(',').map(s => s.trim());
    rows.set(Number(f[0]), [f.slice(1, 5).map(Number), `${f[5].toUpperCase()}.PAT`]);
  }
  return rows;
}
const rows = ultramidRows(read(mapped, 'ULTRAMID.INI').toString());
/** A pack in which every mapped slot uses the given column, from PAT bytes in `dir`. */
function packFromMap(map, dir, voices = 32, flags = 0) {
  return gusPack(Object.entries(map).map(([k, f]) => [Number(k), read(dir, f)]), voices, flags);
}
const make = (pack) => { const c = new Core(module, pack); assert(c.ok, 'profile_init failed'); return c; };
const seconds = (c, s) => Math.round(c.rate * s);
/** A key whose equal-tempered frequency lies inside the wave's range. */
const waveNote = w => Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(Math.sqrt(Math.max(1, w.low) * Math.max(1, w.high)) / 440000))));
const ON = 0x90, OFF = 0x80, CC = 0xb0, PC = 0xc0, BEND = 0xe0;

test('assets equal the pinned darker-cpp manifest (4d8e738)', () => {
  const manifest = read(mapped, 'gravis.sha256');
  assert.equal(sha256(manifest), '0ba5ee2c157b56b82edd4e3e26c528c22296c3af0af2b5678552a5c5ac0e7c89');
  const digests = new Map(manifest.toString().split('\n').filter(Boolean).map(l => { const [d, p] = l.split(/\s+/); return [p.split('/').pop(), d]; }));
  const names = ['ULTRAMID.INI', ...new Set(Object.values(mapping))];
  for (const n of names) assert.equal(sha256(read(mapped, n)), digests.get(n), n);
  let checked = 0;
  for (const [n, d] of digests) if (existsSync(join(full, n))) { assert.equal(sha256(read(full, n)), d, `full set ${n}`); checked++; }
  console.log(JSON.stringify({ mappedFiles: names.length, fullSetFilesInManifest: checked }));
});

test('mapping-1024.json is the 1024K column of ULTRAMID.INI, and the tables fit only as 8-bit', () => {
  const expected = {};
  for (const [k, [cols]] of rows) if (k !== 128) expected[k] = rows.get(cols[3])[1];
  assert.deepEqual(mapping, expected);
  const programs = Object.keys(mapping).map(Number);
  assert.deepEqual(programs.filter(k => k < 128), [...Array(128).keys()]);
  assert.deepEqual(programs.filter(k => k >= 128).map(k => k - 128), Array.from({ length: 61 }, (_, i) => 27 + i));
  // ULTRAMID.INI: "built in such a way as to leave 8K+32bytes after the patches are loaded".
  const fit = [256, 512, 768, 1024].map((kib, col) => {
    const names = [...new Set([...rows].filter(([k]) => k !== 128).map(([, [cols]]) => rows.get(cols[col])[1]))];
    let as8 = 0, as16 = 0;
    for (const n of names) for (const w of parsePat(read(full, n)).layers.flat()) {
      const frames = w.modes & MODE.bit16 ? w.size >> 1 : w.size;
      as8 += Math.ceil(frames / 32) * 32; as16 += Math.ceil(w.size / 32) * 32;
    }
    const budget = kib * 1024 - 8192 - 32;
    assert(as8 <= budget && as16 > budget, `${kib}K: 8-bit ${as8}, 16-bit ${as16}, budget ${budget}`);
    return { kib, patches: names.length, bytes8: as8, bytes16: as16, budget };
  });
  const ultrasnd = join(full, '..', 'ULTRASND.INI');
  if (existsSync(ultrasnd)) { // the Windows patch library lists the same names per number
    const ini = readFileSync(ultrasnd, 'latin1').split(/\r?\n/); let section = '';
    for (const line of ini) {
      const s = line.match(/^\[(.+)\]$/); if (s) { section = s[1]; continue; }
      const m = line.match(/^(\d+)=(\S+)$/); if (!m) continue;
      const k = Number(m[1]) + (section === 'Drum Bank 0' ? 128 : 0);
      if (section === 'Melodic Bank 0' || section === 'Drum Bank 0') assert.equal(rows.get(k)?.[1], `${m[2].toUpperCase()}.PAT`, `ULTRASND.INI ${section} ${m[1]}`);
    }
  }
  const blank = Object.entries(mapping).filter(([, f]) => f === BLANK).map(([k]) => Number(k));
  console.log(JSON.stringify({ fit, blankPrograms: blank.filter(k => k < 128), blankDrumNotes: blank.filter(k => k >= 128).map(k => k - 128) }));
});

test('every patch of the 190-patch Gravis set reads per the SDK layout, loads and sounds', () => {
  const stats = {}; const count = k => { stats[k] = (stats[k] ?? 0) + 1; };
  for (const f of fullPats) {
    const bytes = read(full, f), pat = parsePat(bytes);
    // The SDK layout accounts for every byte of the file.
    const end = 129 + 63 + pat.layers.reduce((s, l) => s + 47 + l.reduce((t, w) => t + 96 + w.size, 0), 0);
    assert.equal(end, bytes.length, f); assert.equal(pat.header, 'GF1PATCH110', f);
    count(`instruments=${pat.instruments}`); count(`layers=${pat.layers.length}`);
    for (const w of pat.layers.flat()) {
      count(w.modes & MODE.bit16 ? '16-bit' : '8-bit'); count(w.modes & MODE.unsigned ? 'unsigned' : 'signed');
      for (const [bit, name] of [[MODE.loop, 'loop'], [MODE.bidir, 'bidir'], [MODE.reverse, 'reverse'], [MODE.sustain, 'sustain'], [MODE.envelope, 'envelope'], [MODE.fastRelease, 'fast release']]) if (w.modes & bit) count(name);
      if (w.fractions) count('loop fractions');
      if (w.scaleFactor !== 1024) count(`scale factor ${w.scaleFactor}`);
      if (w.tremolo[2]) count('tremolo'); if (w.vibrato[2]) count('vibrato');
      count('waves');
    }
    const c = make(gusPack([[0, bytes]]));
    const w = pat.layers[0][0], note = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(Math.sqrt(w.low * w.high || w.root) / 440000))));
    c.msg(CC, 7, 127).msg(ON, note, 127);
    const level = dB(acRms(c.render(seconds(c, 0.4)).l));
    c.close();
    if (f === BLANK) assert(level < -80, `${f}: ${level}`); else assert(level > -60, `${f} note ${note}: ${level.toFixed(1)} dBFS`);
  }
  console.log(JSON.stringify(stats));
});

test('every mapped program and drum note sounds; the exceptions are the BLANK.PAT substitutions', () => {
  const c = make(pack1024), silent = [];
  for (let p = 0; p < 128; p++) { c.msg(0xff).msg(PC, p); c.msg(ON, 60, 127); const level = dB(acRms(c.render(seconds(c, 0.4)).l)); if (level < -60) silent.push([p, mapping[p], Number(level.toFixed(1))]); }
  for (let n = 0; n < 128; n++) { c.msg(0xff).msg(ON | 9, n, 127); const level = dB(acRms(c.render(seconds(c, 0.4)).l)); if (level < -60) silent.push([128 + n, mapping[128 + n] ?? 'unmapped', Number(level.toFixed(1))]); }
  c.close();
  const expected = Object.keys(mapping).map(Number).filter(k => mapping[k] === BLANK).concat([...Array(128).keys()].filter(n => !mapping[128 + n]).map(n => 128 + n)).sort((a, b) => a - b);
  assert.deepEqual(silent.map(s => s[0]).sort((a, b) => a - b), expected);
  console.log(JSON.stringify({ silent: silent.length, why: 'ULTRAMID.INI substitutes BLANK.PAT (3032 bytes of 0x7F, unsigned 8-bit: a constant -1 LSB) for these slots at 1024K; drum notes outside 27..87 have no ULTRAMID.INI row', programs: silent.filter(s => s[0] < 128).map(s => s[0]), drumNotes: silent.filter(s => s[0] >= 128).map(s => s[0] - 128) }));
});

// Programs whose 1024K patches carry one pitch per key (no octave registers): fundamental vs equal temperament.
const TUNED = [0, 24, 40, 52, 56, 68, 71, 73];
const TUNING_CENTS = 10;
test(`tuning: fundamental within ${TUNING_CENTS} cents of the note, and independent of the voice count`, () => {
  const out = [];
  for (const voices of [32, 14]) {
    const c = make(packFromMap(mapping, mapped, voices));
    for (const p of TUNED) for (const note of [48, 60, 72]) {
      c.msg(0xff).msg(CC, 7, 127).msg(PC, p).msg(ON, note, 127);
      const { l } = c.render(seconds(c, 1.2));
      const f = fundamental(l.subarray(seconds(c, 0.3)), c.rate), e = cents(f, noteHz(note));
      out.push({ voices, program: p, patch: mapping[p], note, hz: Number(f.toFixed(2)), cents: Number(e.toFixed(1)) });
      assert(Math.abs(e) <= TUNING_CENTS, `${voices} voices, program ${p} (${mapping[p]}) note ${note}: ${f.toFixed(2)} Hz, ${e.toFixed(1)} cents`);
    }
    c.close();
  }
  // FC keeps nine fraction bits above an unused bit 0 (SDK 2.6.2.2): rounding moves the pitch by up to one FC unit.
  for (const r of out.filter(r => r.voices === 14)) {
    const other = out.find(o => o.voices === 32 && o.program === r.program && o.note === r.note);
    const w = parsePat(read(mapped, mapping[r.program])).layers[0].find(x => x.low <= noteHz(r.note) * 1000 && noteHz(r.note) * 1000 <= x.high);
    const fc = v => w.rate * noteHz(r.note) * 1000 / w.root * 1024 / SDK_RATES[v - 14], step = v => 1200 * Math.log2(1 + 1 / fc(v));
    assert(Math.abs(cents(r.hz, other.hz)) <= step(14) + step(32) + 1, `voice count changes pitch: ${JSON.stringify([r, other])}`);
  }
  console.log(JSON.stringify({ maxAbsCents: Math.max(...out.map(r => Math.abs(r.cents))), results: out.filter(r => r.voices === 32).map(r => `${r.program}/${r.note}:${r.cents}`) }));
});

/** SDK 2.16: ramp increment (bits 5-0) added once per voice update, every 8^(bits 7-6) updates. */
const rampPerFrame = r => (r & 63) / 8 ** (r >> 6);
/** GUSEMU32's semi-logarithmic decode of a 12-bit volume. */
const gain12 = v => ((256 + (Math.floor(v) & 255)) * 2 ** Math.min(15, Math.floor(v / 256))) / 512 / 65536;
test('envelope: the BRITEPNO decay follows the SDK ramp rate and the GF1 log volume', () => {
  const w = parsePat(read(mapped, mapping[0])).layers[0].find(x => x.low <= 261626 && 261626 <= x.high);
  const c = make(pack1024);
  c.msg(CC, 7, 127).msg(PC, 0).msg(ON, 60, 127); // CC7, CC11 and velocity 127: no attenuation
  let t = 0, v = 0; for (let s = 0; s < 2; s++) { t += Math.abs(w.offsets[s] * 16 - v) / rampPerFrame(w.rates[s]); v = w.offsets[s] * 16; }
  const { l } = c.render(seconds(c, 4.5)), win = seconds(c, 0.1);
  const at = s => acRms(l, seconds(c, s), seconds(c, s) + win), env = s => v - (seconds(c, s) - t) * rampPerFrame(w.rates[2]);
  const measured = dB(at(4) / at(1.5)), predicted = dB(gain12(env(4)) / gain12(env(1.5)));
  c.close();
  console.log(JSON.stringify({ patch: mapping[0], stage2Rate: w.rates[2], measuredDb: Number(measured.toFixed(2)), predictedDb: Number(predicted.toFixed(2)) }));
  assert(Math.abs(measured - predicted) < 1, `${measured} dB vs ${predicted} dB`);
});

test('sustain: CHURCH holds at its third point while held or pedalled, releases after; drums ignore note off', () => {
  const c = make(pack1024), hold = s => dB(acRms(c.render(seconds(c, s)).l));
  c.msg(CC, 7, 127).msg(PC, 19).msg(ON, 60, 127); c.render(seconds(c, 0.5));
  const a = hold(0.5); c.render(seconds(c, 1.5)); const b = hold(0.5);
  assert(Math.abs(a - b) < 0.5, `hold drifts: ${a} vs ${b}`);
  c.msg(CC, 64, 127).msg(OFF, 60, 0); c.render(seconds(c, 1)); const pedal = hold(0.5);
  assert(Math.abs(pedal - b) < 0.5, `pedal hold: ${pedal} vs ${b}`);
  c.msg(CC, 64, 0); c.render(seconds(c, 4)); const after = hold(0.5);
  assert(after < b - 40, `release: ${after} vs ${b}`); c.close();
  // KICK1 has no sustain bit: "a note off will continue enveloping" only for sustain.
  const x = make(pack1024), y = make(pack1024);
  x.msg(ON | 9, 36, 127); y.msg(ON | 9, 36, 127); x.render(64); y.render(64); x.msg(OFF | 9, 36, 0);
  assert.deepEqual(x.render(seconds(x, 1)), y.render(seconds(y, 1))); x.close(); y.close();
  console.log(JSON.stringify({ holdDb: Number(a.toFixed(2)), after3sDb: Number(b.toFixed(2)), pedalDb: Number(pedal.toFixed(2)), releasedDb: Number(after.toFixed(2)) }));
});

test('tremolo: FLUTE (rate 255) modulates at 6 Hz once it sustains', () => {
  const c = make(pack1024);
  c.msg(CC, 7, 127).msg(PC, 73).msg(ON, 72, 127); c.render(seconds(c, 1));
  const { l } = c.render(seconds(c, 5)), hop = l.length / 500, env = new Float32Array(500); // level at 100 Hz
  for (let i = 0; i < 500; i++) env[i] = dB(acRms(l, Math.round(i * hop), Math.round((i + 1) * hop)));
  const hz = fundamental(env.map(x => x - env.reduce((s, y) => s + y, 0) / env.length), 100, 1, 20);
  c.close();
  console.log(JSON.stringify({ modulationHz: Number(hz.toFixed(3)), swingDb: Number((Math.max(...env) - Math.min(...env)).toFixed(2)) }));
  assert(Math.abs(hz - 6) <= 0.1, `${hz} Hz`);
});

test('pan: CC10 extremes reach one channel, power stays constant, drum balance applies', () => {
  const level = (pan, program = 73, ch = 0, note = 72) => {
    const c = make(pack1024); c.msg(CC | ch, 7, 127).msg(CC | ch, 10, pan).msg(PC | ch, program).msg(ON | ch, note, 127);
    const { l, r } = c.render(seconds(c, 0.5)); c.close(); return [acRms(l), acRms(r)];
  };
  const [l0, r0] = level(0), [lc, rc] = level(64), [l1, r1] = level(127);
  assert.equal(r0, 0); assert.equal(l1, 0); assert(Math.abs(dB(lc / rc)) < 0.01);
  const power = [l0 ** 2 + r0 ** 2, lc ** 2 + rc ** 2, l1 ** 2 + r1 ** 2];
  for (const p of power) assert(Math.abs(10 * Math.log10(p / power[1])) < 0.1, `power ${power}`);
  const [hl, hr] = level(64, 0, 9, 42); // HIHATCL balance 6: GF1 pan position 6
  assert(Math.abs(dB(hl / hr) - dB(25618 / 20430)) < 0.05, `${dB(hl / hr)}`);
  console.log(JSON.stringify({ centreDb: Number(dB(lc / rc).toFixed(3)), hihatLeftOverRightDb: Number(dB(hl / hr).toFixed(2)) }));
});

test('pitch bend: default range 2 semitones, RPN 0 sets the range', () => {
  const pitch = (setup) => {
    const c = make(pack1024); c.msg(CC, 7, 127).msg(PC, 73); setup(c); c.msg(ON, 60, 127);
    const { l } = c.render(seconds(c, 1)); const f = fundamental(l.subarray(seconds(c, 0.3)), c.rate); c.close(); return f;
  };
  const base = pitch(() => {}), up = pitch(c => c.msg(BEND, 127, 127)), down = pitch(c => c.msg(BEND, 0, 0));
  const octave = pitch(c => c.msg(CC, 101, 0).msg(CC, 100, 0).msg(CC, 6, 12).msg(BEND, 127, 127));
  const r = { up: cents(up, base), down: cents(down, base), octave: cents(octave, base) };
  console.log(JSON.stringify(r));
  assert(Math.abs(r.up - 200 * 8191 / 8192) < 3 && Math.abs(r.down + 200) < 3 && Math.abs(r.octave - 1200 * 8191 / 8192) < 3);
});

test('voice cap and native rate follow the SDK table for 14..32 active voices', () => {
  for (let voices = 14; voices <= 32; voices++) {
    const c = make(packFromMap(mapping, mapped, voices));
    assert.equal(c.rate, SDK_RATES[voices - 14]); assert.equal(Math.round(617400 / c.rate), voices);
    c.msg(PC, 19); for (let n = 30; n < 90; n++) c.msg(ON, n, 100);
    assert.equal(c.voices(), voices); c.render(256); assert.equal(c.voices(), voices); c.close();
  }
});

test('DRAM under load: -16 evicts idle waves, never a sounding one; -c preloads the 8-bit set', () => {
  const pack16 = packFromMap(mapping, mapped, 32, FLAG_16BIT);
  const held = c => c.msg(CC, 7, 127).msg(PC, 19).msg(ON, 60, 100);
  const a = make(pack16), b = make(pack16); held(a); held(b);
  const audible = []; let demand = 0;
  for (let p = 0; p < 128; p++) { // one note per wave: 85 distinct patches, 143 waves, 1.93 MB as 16-bit, through 1 MiB
    const waves = parsePat(read(mapped, mapping[p])).layers[0];
    b.msg(PC | 1, p);
    for (const w of waves) { b.msg(ON | 1, waveNote(w), 127); demand += Math.ceil(w.size / 32) * 32; }
    const x = a.render(seconds(a, 0.4)), y = b.render(seconds(b, 0.4)), extra = dB(acRms(y.l.map((v, i) => v - x.l[i])));
    if (extra > -70) audible.push(p);
    b.msg(CC | 1, 120, 0);
  }
  assert.deepEqual(a.render(seconds(a, 1)), b.render(seconds(b, 1)), 'the held CHURCH wave was overwritten');
  a.close(); b.close();
  assert.deepEqual(audible, [...Array(128).keys()].filter(p => mapping[p] !== BLANK));
  const pre = new Core(module, packFromMap(mapping, mapped, 32, FLAG_PRELOAD)); assert(pre.ok, '1024K set preloads as 8-bit'); pre.close();
  const both = new Core(module, packFromMap(mapping, mapped, 32, FLAG_16BIT | FLAG_PRELOAD)); assert(!both.ok, 'UltraMID refuses -16 with -c'); both.close();
  const library = Object.fromEntries([...rows].filter(([k]) => k !== 128).map(([k, [, name]]) => [k, name])); // no substitution
  const all = new Core(module, packFromMap(library, full, 32, FLAG_PRELOAD)); assert(!all.ok, 'the unsubstituted library exceeds 1 MiB'); all.close();
  console.log(JSON.stringify({ churnedPrograms: 128, audible: audible.length, uploadedBytes16: demand, dram: 1 << 20 }));
});

test('SysEx: GM, GM2, GS and XG resets restore power-on state; other SysEx is ignored; malformed rejected', () => {
  const resets = { gm: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], gm2: [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7], gs: [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7], xg: [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7] };
  const phrase = c => { c.msg(PC, 73).msg(ON, 64, 100).msg(ON | 9, 38, 90); return c.render(seconds(c, 0.5)); };
  const fresh = make(pack1024), reference = phrase(fresh); fresh.close();
  for (const [name, bytes] of Object.entries(resets)) {
    const c = make(pack1024);
    c.msg(CC, 7, 0).msg(CC, 10, 0).msg(CC, 64, 127).msg(BEND, 0, 0).msg(PC, 5).msg(ON, 50, 127).msg(CC | 9, 11, 3); c.render(512);
    assert.equal(c.sysex(bytes), 1, name); assert.equal(c.voices(), 0, name);
    assert.deepEqual(phrase(c), reference, `${name} reset`); c.close();
  }
  const c = make(pack1024);
  assert.equal(c.sysex([0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x01, 0x30, 0x00, 0x0f, 0xf7]), 1, 'GS reverb macro is ignored');
  assert.deepEqual(phrase(c), reference);
  assert.equal(c.sysex([0xf0, 0x7e, 0x7f, 0x09, 0x81, 0xf7]), 0, 'data byte >= 0x80');
  assert.equal(c.sysex([0xf0, 0x7e, 0x7f, 0x09, 0x01]), 0, 'no F7');
  c.close();
});

test('host: NativeProfileVoices plays the original pack at 48 kHz', () => {
  const v = new NativeProfileVoices('gus-gf1', instantiateProfile(module), pack1024, 48000);
  try {
    assert.equal(v.maxVoices(), 32);
    v.message(0xc0, 0, 0); v.message(0x90, 60, 110);
    const l = new Float32Array(24000), r = new Float32Array(24000);
    for (let at = 0; at < l.length; at += 128) v.render(l, r, at, Math.min(128, l.length - at));
    assert(dB(acRms(l)) > -40 && l.every(Number.isFinite));
    v.sysex(Uint8Array.from([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])); assert.equal(v.voices(), 0);
  } finally { v.close(); }
});

const CCBIN = process.env.CC || 'cc';
function nativeBuild(name, flags) {
  const out = join(tmpdir(), `defuss-${name}-${process.pid}`);
  execFileSync(CCBIN, ['-std=c11', ...flags, '-ffp-contract=off', `-I${ROOT}/native/profiles`, `${ROOT}/tests/gf1-native-test.c`, `${ROOT}/native/profiles/gus.c`, '-lm', '-o', out], { stdio: 'inherit' });
  return out;
}
test('native and WASM render bit-identical PCM from the same events', () => {
  const exe = nativeBuild('gf1-native', ['-O2']);
  const events = [], ev = (frames, s = 0, a = 0, b = 0) => events.push([frames, s, a, b]);
  ev(0, CC, 7, 127); ev(0, PC, 0); ev(0, ON, 60, 120); ev(4000, PC | 1, 73); ev(0, ON | 1, 72, 100); ev(0, ON | 9, 36, 127); ev(0, ON | 9, 42, 90);
  ev(9000, BEND | 1, 0, 90); ev(3000, CC | 1, 10, 10); ev(0, PC | 2, 52); ev(0, ON | 2, 55, 110); ev(5000, CC, 64, 127); ev(0, OFF, 60, 0);
  ev(7000, PC | 3, 71); ev(0, ON | 3, 67, 127); ev(0, PC | 4, 40); ev(0, ON | 4, 64, 80); ev(20000, CC, 64, 0); ev(6000, 0xf0); ev(0, ON | 9, 38, 127); ev(12000);
  const bin = Buffer.alloc(events.length * 8); events.forEach(([f, s, a, b], i) => { bin.writeUInt32LE(f, 8 * i); bin.writeUInt8(s, 8 * i + 4); bin.writeUInt8(a, 8 * i + 5); bin.writeUInt8(b, 8 * i + 6); });
  const dir = join(tmpdir(), `defuss-gf1-${process.pid}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.bin'), bin);
  execFileSync(exe, ['render', join(mapped, 'gus-gf1-1024k.dspack'), join(dir, 'events.bin'), join(dir, 'native.f32')]);
  const c = make(pack1024), parts = [];
  const gs = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
  for (const [frames, s, a, b] of events) {
    for (let at = 0; at < frames; at += 128) { const n = Math.min(128, frames - at), ptr = c.e.profile_render(n) >>> 0; parts.push(Buffer.from(new Float32Array(c.e.memory.buffer, ptr, 2 * n).slice().buffer)); }
    if (s === 0xf0) assert.equal(c.sysex(gs), 1); else if (s) c.msg(s, a, b);
  }
  c.close();
  const wasm = Buffer.concat(parts), native = readFileSync(join(dir, 'native.f32'));
  assert.equal(native.length, wasm.length); assert(native.equals(wasm), 'PCM differs');
  const energy = new Float32Array(wasm.buffer, wasm.byteOffset, wasm.length / 4).reduce((s, x) => s + x * x, 0);
  assert(energy > 1);
  console.log(JSON.stringify({ frames: wasm.length / 8, sha256: sha256(wasm) }));
});

test('ASan+UBSan: mutations of the 190 original patches', () => {
  const exe = nativeBuild('gf1-asan', ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer']);
  const cases = Number(process.env.GF1_FUZZ_CASES || 20000);
  const out = execFileSync(exe, ['fuzz', String(cases), '20261125', ...fullPats.map(f => join(full, f))], { encoding: 'utf8', maxBuffer: 1 << 20 });
  const r = JSON.parse(out.trim().split('\n').pop()); console.log(JSON.stringify(r));
  assert.equal(r.cases, cases); assert(r.accepted > 0 && r.rejected > 0);
});

test('measurements: size, init, upload of the mapped set, render per 128 frames at 32 voices', () => {
  const median = a => [...a].sort((x, y) => x - y)[a.length >> 1], p99 = a => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.99)];
  const time = f => { const t = performance.now(); f(); return performance.now() - t; };
  const preload = packFromMap(mapping, mapped, 32, FLAG_PRELOAD);
  const init = [], upload = [];
  for (let i = 0; i < 15; i++) {
    let c; init.push(time(() => { c = new Core(module, pack1024); })); c.close();
    let d; upload.push(time(() => { d = new Core(module, preload); }) - init.at(-1)); d.close();
  }
  const c = make(pack1024); c.msg(CC, 7, 127);
  const programs = [19, 52, 89, 48, 16, 20, 21, 73]; // sustained patches
  for (let i = 0; i < 32; i++) c.msg(PC | (i % 8), programs[i % 8]).msg(ON | (i % 8), 40 + i, 100);
  assert.equal(c.voices(), 32);
  for (let i = 0; i < 200; i++) c.e.profile_render(128);
  const blocks = [];
  for (let i = 0; i < 5000; i++) { const t = performance.now(); c.e.profile_render(128); blocks.push(performance.now() - t); }
  const sounding = c.voices(); c.close();
  const result = { wasmBytes: statSync(new URL('../vendor/runtime/profiles/gus-gf1.wasm', import.meta.url)).size, packBytes: pack1024.length,
    initMsMedian: Number(median(init).toFixed(2)), uploadMappedSetMsMedian: Number(median(upload).toFixed(2)),
    render128MsMedian: Number(median(blocks).toFixed(4)), render128MsP99: Number(p99(blocks).toFixed(4)), blocks: blocks.length, voicesAtEnd: sounding,
    realtimeBudgetMs: Number((128 / 19293 * 1000).toFixed(3)), node: process.version };
  console.log(JSON.stringify(result));
  mkdirSync(join(ROOT, 'output'), { recursive: true }); writeFileSync(join(ROOT, 'output', 'gf1-metrics.json'), JSON.stringify(result, null, 2) + '\n');
});
