/** The sb-pci128 core against the three original wavesets EAPCI2M/4M/8M.ECW and the ecw2sfz r3 reference.
 * Private assets, so not part of `make test`. Prepare them once (EMAC download and ecw2sfz r3, local only):
 *   python3 scripts/profile-assets.py fetch-ecw profile-assets/ecw
 *   python3 scripts/profile-assets.py fetch-ecw-reference profile-assets/reference
 *   python3 scripts/profile-assets.py verify-ecw-reference profile-assets/reference/ecw2sfz-r3 profile-assets/ecw
 * Run: node scripts/profile-ecw-test.mjs [DIRECTORY]   (needs a native C compiler: CC, default clang; SDKROOT is honored)
 * It builds tests/ecw-trace.c (the real pci128.c, natively) and an ASan+UBSan build of tests/vintage-native-test.c,
 * drives vendor/runtime/profiles/sb-pci128.wasm and writes its measurements to output/profile-ecw-test.json. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = process.argv[2] || join(ROOT, 'profile-assets/ecw');
const NAMES = ['EAPCI2M', 'EAPCI4M', 'EAPCI8M'];
const RATE = 22050, PITCH_OFFSET = 5.19; // the core's constants (native/profiles/pci128.c)
const missing = NAMES.flatMap((n) => ['.ECW', '.ECW.dspack', '.ECW.ecw2sfz.json'].map((x) => join(DIR, n + x))).filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`Missing private ECW assets:\n  ${missing.join('\n  ')}\nPrepare them with:\n  python3 scripts/profile-assets.py fetch-ecw ${DIR}\n  python3 scripts/profile-assets.py fetch-ecw-reference profile-assets/reference\n  python3 scripts/profile-assets.py verify-ecw-reference profile-assets/reference/ecw2sfz-r3 ${DIR}`);
  process.exit(2);
}
const BUILD = join(ROOT, 'tmp/ecw-test');
mkdirSync(BUILD, { recursive: true });
mkdirSync(join(ROOT, 'output'), { recursive: true });
const CC = process.env.CC || 'clang';
function compile(out, sources, flags) {
  const r = spawnSync(CC, [...flags, '-o', out, ...sources.map((s) => join(ROOT, s))], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${CC} failed for ${out} (if the linker rejects the default macOS SDK, set SDKROOT to an older one):\n${r.stderr}${r.error ?? ''}`);
}
const TRACE = join(BUILD, 'ecw-trace'), FUZZ = join(BUILD, 'pci128-fuzz');
compile(TRACE, ['tests/ecw-trace.c'], ['-std=c11', '-O2', '-ffp-contract=off', '-Wall', '-Wextra', '-Werror']);
compile(FUZZ, ['tests/vintage-native-test.c', 'native/profiles/pci128.c'], ['-std=c11', '-O1', '-g', '-ffp-contract=off', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer', `-I${join(ROOT, 'native/profiles')}`]);
function run(bin, args, maxBuffer = 1 << 30) {
  const r = spawnSync(bin, args, { maxBuffer });
  if (r.status !== 0) throw Error(`${bin} ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const WASM_PATH = join(ROOT, 'vendor/runtime/profiles/sb-pci128.wasm');
const wasm = new WebAssembly.Module(readFileSync(WASM_PATH));
const report = { wasm: { bytes: statSync(WASM_PATH).size }, wavesets: {} };
after(() => writeFileSync(join(ROOT, 'output/profile-ecw-test.json'), JSON.stringify(report, null, 2) + '\n'));

/* ---------- WASM driving ---------- */
function instance(pack) {
  const e = new WebAssembly.Instance(wasm).exports;
  const p = e.profile_buffer(pack.length);
  assert(p, 'profile_buffer');
  new Uint8Array(e.memory.buffer, p, pack.length).set(pack);
  assert.equal(e.profile_init(pack.length), 1);
  assert.equal(e.profile_rate(), RATE);
  return e;
}
const msg = (e, s, a = 0, b = 0) => assert.equal(e.profile_message(s, a, b), 1);
function render(e, frames) {
  const l = new Float32Array(frames), r = new Float32Array(frames);
  for (let at = 0; at < frames; at += 128) {
    const n = Math.min(128, frames - at), ptr = e.profile_render(n);
    assert(ptr);
    const pcm = new Float32Array(e.memory.buffer, ptr, 2 * n);
    l.set(pcm.subarray(0, n), at); r.set(pcm.subarray(n), at);
  }
  return { l, r };
}
const energy = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return s; };
const rms = (a, from = 0, to = a.length) => Math.sqrt(energy(a, from, to) / Math.max(1, to - from));
function sysex(e, bytes) { new Uint8Array(e.memory.buffer, e.profile_sysex_buffer(), bytes.length).set(bytes); return e.profile_sysex(bytes.length); }
function select(e, ch, bank, program) { if (ch === 9) msg(e, 0xc9, bank); else { msg(e, 0xb0 | ch, 0, bank); msg(e, 0xc0 | ch, program); } }
/* YIN fundamental (Hz) of x at RATE; 0 when no clear period. */
function f0(x, from, length = 4096, maxLag = 1200) {
  const d = new Float64Array(maxLag + 2), c = new Float64Array(maxLag + 2);
  for (let t = 1; t <= maxLag + 1; t++) { let s = 0; for (let i = from; i < from + length; i++) { const v = x[i] - x[i + t]; s += v * v; } d[t] = s; }
  let sum = 0; c[0] = 1;
  for (let t = 1; t <= maxLag + 1; t++) { sum += d[t]; c[t] = sum ? (d[t] * t) / sum : 1; }
  for (let t = 4; t <= maxLag; t++) if (c[t] < 0.15) {
    while (t + 1 <= maxLag && c[t + 1] < c[t]) t++;
    const a = c[t - 1], b = c[t], g = c[t + 1], den = a - 2 * b + g;
    return RATE / (t + (den ? (0.5 * (a - g)) / den : 0));
  }
  return 0;
}
const cents = (f, key) => 1200 * Math.log2(f / (440 * 2 ** ((key - 69) / 12)));
/* Magnitude of the frequency hz in x[from, from + length) (Hann window). */
function partial(x, hz, from, length) {
  let re = 0, im = 0;
  for (let i = 0; i < length; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length), ph = (2 * Math.PI * hz * (from + i)) / RATE; re += w * x[from + i] * Math.cos(ph); im += w * x[from + i] * Math.sin(ph); }
  return Math.hypot(re, im);
}
/* Pitch of a sustained tone: the YIN period. When that period is an octave below the note and its 3rd partial is
 * missing (>30 dB down) next to strong 1st and 2nd partials, the harmonic series sits at 2*f with a sub-octave
 * (organ 16') component: the pitch is 2*f, and the row is marked subOctave. A pure tone rendered an octave low
 * would pass this check too; the rows say which notes relied on it. */
function pitch(x, from, expectKey) {
  const f = f0(x, from);
  if (!f) return { hz: 0, subOctave: false };
  const m = [1, 2, 3, 4].map((h) => partial(x, h * f, from, 8192)), top = Math.max(...m);
  const subOctave = m[2] < top * 0.03 && m[1] > top * 0.3 && m[0] > top * 0.1 && Math.abs(cents(f, expectKey) + 1200) < 100; // 3rd partial >30 dB down
  return { hz: subOctave ? 2 * f : f, subOctave };
}
const mono = ({ l, r }) => l.map((x, i) => x + r[i]);

/* ---------- Reference model: ecw2sfz's decoded sections + the spec's routing rules ---------- */
const s8 = (x) => (x > 127 ? x - 256 : x);
function model(name) {
  const R = JSON.parse(readFileSync(join(DIR, `${name}.ECW.ecw2sfz.json`), 'utf8'));
  const raw = readFileSync(join(DIR, `${name}.ECW`));
  const waveBytes = raw.readUInt32LE(0x788);
  const word = (sh) => ((sh.delay & 255) << 8) | (sh.delay >> 8); // ecw2sfz reads LE; the core uses big-endian ms
  function resolve(idx, key, why) {
    for (let depth = 0; depth < 16; depth++) {
      const r = R.instruments[idx];
      if (!r) { why.push(`instrument ${idx} out of range`); return null; }
      if (r.type !== 'Region') return r;
      const split = Object.keys(r.region).map(Number).sort((a, b) => a - b).find((s) => key <= s);
      if (split === undefined) { why.push(`instrument ${idx} has no region for note ${key}`); return null; }
      idx = r.region[split];
    }
    why.push('region chain longer than 16'); return null;
  }
  function sample(patchIndex, key, why) {
    const P = R.patches[patchIndex];
    if (!P) { why.push(`patch ${patchIndex} out of range`); return null; }
    const a = R.array1[P.sample];
    if (a === undefined) { why.push(`patch ${patchIndex}: array1[${P.sample}] out of range`); return null; }
    const first = R.array3[a];
    if (first === undefined) { why.push(`patch ${patchIndex}: array1[${P.sample}]=${a}${a === 65535 ? ' (unassigned)' : ''} beyond array3 (${R.array3.length})`); return null; }
    const lookup = Math.max(0, Math.min(127, key + P.split_adjust));
    for (let i = 0; i < 128; i++) {
      const S = R.samples[first + i];
      if (!S) { why.push(`patch ${patchIndex}: sample chain from ${first} ends before note ${lookup}`); return null; }
      if (lookup <= S.note_max) return first + i;
    }
    return null;
  }
  /* The voices one note-on starts, in the core's record layout (expected values). */
  function voicesFor(drum, mapIndex, program, key) {
    const why = [], map = drum ? R.drum_note_maps[mapIndex] : R.patch_maps[mapIndex];
    const r = resolve(map[drum ? key : program], key, why);
    const layers = !r ? [] : r.type === 'Mono' ? [r.sub_header_1] : r.type === 'Stereo' ? [r.sub_header_1, r.sub_header_2] : r.type === 'Split' ? [key <= r.split_point ? r.sub_header_1 : r.sub_header_2] : [];
    const out = [];
    for (const sh of layers) {
      const s = sample(sh.patch, key, why);
      if (s == null) continue;
      const S = R.samples[s], P = R.patches[sh.patch];
      const st = S.sample_start * 8, ls = S.loop_start * 8, end = S.loop_end * 8;
      if (st % 16 || end <= st || end > Math.floor(waveBytes / 2) * 16) { why.push(`sample ${s} outside the waveform area`); continue; }
      const tune = (((((S.coarse_tune + 128) & 255) << 8) | (S.fine_tune & 255)) << 16) >> 16;
      const keyTerm = P.scale === 1 ? 60 : P.scale === 2 ? 60 + (key - 60) * 0.5 : key;
      if (sh.group) for (let i = out.length - 1; i >= 0; i--) if (out[i].group === sh.group) out.splice(i, 1);
      out.push({ patch: sh.patch, sample: s, max: S.note_max, tune, st, ls, end, drumUntuned: drum && !S.tune,
        semi: drum && !S.tune ? 0 : keyTerm + tune / 256 + sh.coarse_tune + sh.fine_tune / 256 + PITCH_OFFSET,
        pan: Math.max(-1, Math.min(1, sh.pan / 64)), amp: 2 ** (sh.amplitude / 32), delay: Math.floor((word(sh) * RATE) / 1000), group: sh.group, S });
    }
    for (const v of out) { const a = R.patches[v.patch].amplitude_envelope; if (!a.level_initial && !a.level_attack && !a.level_decay && !a.level_sustain) why.push(`patch ${v.patch}: all amplitude envelope levels are 0 (placeholder)`); }
    if (!out.length && !why.length) why.push(r ? `instrument type ${r.type} with no active layer` : 'no instrument');
    return { voices: out, why };
  }
  return { R, raw, waveBytes, voicesFor };
}
/* Core view from the native harness: header line, then "M|D map bank program key [voice]..." lines. */
function coreMap(pack) {
  const lines = run(TRACE, ['map', pack]).toString('utf8').trimEnd().split('\n');
  const head = JSON.parse(lines.shift()), notes = [], unreachable = [];
  for (const line of lines) {
    const m = /^([MD]) (\d+) (?:(unreachable)|(\d+) (\d+) (\d+))(.*)$/.exec(line);
    if (m[3]) { unreachable.push(`${m[1]}${m[2]}`); continue; }
    const voices = [...m[7].matchAll(/\[([^\]]*)\]/g)].map((v) => { const f = v[1].split(',').map(Number); return { patch: f[0], sample: f[1], max: f[2], flag: f[3], tune: f[4], st: f[5], ls: f[6], end: f[7], loop: f[8], semi: f[9], pan: f[10], amp: f[11], delay: f[12], group: f[13] }; });
    notes.push({ drum: m[1] === 'D', map: +m[2], bank: +m[4], program: +m[5], key: +m[6], voices });
  }
  return { head, notes, unreachable };
}
const W = Object.fromEntries(NAMES.map((n) => [n, { pack: readFileSync(join(DIR, `${n}.ECW.dspack`)), packPath: join(DIR, `${n}.ECW.dspack`), ...model(n) }]));
for (const n of NAMES) { W[n].core = coreMap(W[n].packPath); report.wavesets[n] = { sha256: null, unreachableMaps: W[n].core.unreachable }; }
/* Notes that start voices (from the core view), as playable choices for the behavior tests. */
const playable = (n, pred) => W[n].core.notes.find((x) => x.voices.length && pred(x));

/* ---------- 1. Parsing, field by field, against ecw2sfz ---------- */
for (const n of NAMES) test(`${n}: tables, bank map and drum kit map agree with ecw2sfz`, () => {
  const { R, core } = W[n], t = core.head.tables, h = R.header;
  assert.deepEqual([t.bank[0], t.drum[0], t.programs, t.drums, t.instruments, t.patches, t.a1, t.a3, t.samples, t.wave[0]],
    [h.bank_map, h.drum_kit_map, h.patch_maps, h.drum_note_maps, h.instruments, h.patches, h.array1, h.array3, h.samples, h.waveform]);
  assert.equal(R.instruments.length, t.instruments[1], 'ecw2sfz decoded every instrument (only sub-types 0..3 occur)');
  assert.deepEqual(core.head.bank_map, R.bank_map);
  assert.deepEqual(core.head.drum_kit_map, R.drum_kit_map);
  // ecw2sfz keeps regions in a hash keyed by split; that equals the spec's in-order "note <= split" only if splits ascend.
  for (let i = 0; i < t.instruments[1]; i++) {
    const o = h.instruments[0] + 23 * i, raw = W[n].raw;
    if (raw[o] !== 255) continue;
    const splits = []; for (let k = 0; k < 7; k++) { splits.push(raw[o + 4 + 3 * k]); if (raw[o + 4 + 3 * k] === 127) break; }
    assert(splits.every((s, k) => !k || s > splits[k - 1]), `instrument ${i} region splits ascend`);
  }
});
for (const n of NAMES) test(`${n}: every reachable note starts the voices ecw2sfz's tables and the spec predict`, () => {
  const { core, voicesFor, R } = W[n];
  let compared = 0, voices = 0;
  const flags = {};
  for (const note of core.notes) {
    const want = voicesFor(note.drum, note.map, note.program, note.key).voices;
    const key = (v) => `${v.patch}:${v.sample}`;
    const got = [...note.voices].sort((a, b) => key(a).localeCompare(key(b))), exp = [...want].sort((a, b) => key(a).localeCompare(key(b)));
    const where = `${note.drum ? 'drum map' : 'map'} ${note.map} bank ${note.bank} program ${note.program} key ${note.key}`;
    assert.deepEqual(got.map(key), exp.map(key), where);
    for (let i = 0; i < got.length; i++) {
      const g = got[i], e = exp[i], S = e.S;
      assert.deepEqual([g.max, g.tune, g.st, g.ls, g.end, g.delay, g.group], [e.max, e.tune, e.st, e.ls, e.end, e.delay, e.group], where);
      // ecw2sfz keeps only flag-derived fields; the raw flag the core read must reproduce them.
      assert.deepEqual([S.tune, S.loop, S.loop_adjust], [+(g.flag !== 0), +(g.flag > 2), g.flag > 128 ? g.flag - 128 : 0], where);
      assert.equal(g.loop, +(g.flag >= 2 && g.ls >= g.st && g.ls < g.end && g.end - g.ls >= 16), `${where}: spec loop rule (flag >= 2)`);
      assert(Math.abs(g.semi - e.semi) < 2e-3, `${where}: pitch ${g.semi} vs ${e.semi}`);
      assert(Math.abs(g.pan - e.pan) < 1e-6 && Math.abs(g.amp / e.amp - 1) < 1e-4, `${where}: pan/amp`);
      flags[g.flag] = (flags[g.flag] || 0) + 1; voices++;
    }
    compared++;
  }
  // The patch fields the core reads by fixed offset (pci128.c) against ecw2sfz's decoding of the same patches.
  const base = R.header.patches[0], raw = W[n].raw, envKeys = ['release_dest', 'attack_delay', 'level_initial', 'time_attack', 'level_attack', 'time_decay', 'level_decay', 'time_sustain', 'level_sustain', 'time_release'];
  R.patches.forEach((P, i) => {
    const p = raw.subarray(base + 76 * i, base + 76 * i + 76);
    assert.deepEqual([s8(p[0]), p[1], p[2], p.readUInt16LE(11), s8(p[16]), p[72], p[73], p[74], p[40], p[70]],
      [P.pitch_envelope_level, P.mod_sensitivity, P.scale, P.sample, P.split_adjust, P.vib_depth, P.vib_speed, P.vib_delay, P.pitch_envelope.release_flag, P.amplitude_envelope.release_flag], `patch ${i}`);
    assert.deepEqual([...p.subarray(27, 37)], envKeys.map((k) => P.pitch_envelope[k]), `patch ${i} pitch envelope`);
    assert.deepEqual([...p.subarray(57, 67)], envKeys.map((k) => P.amplitude_envelope[k]), `patch ${i} amplitude envelope`);
  });
  Object.assign(report.wavesets[n], { notesCompared: compared, voicesCompared: voices, sampleFlagsSeen: flags });
});

/* ---------- 2. Every melodic program and every drum note renders ---------- */
for (const n of NAMES) test(`${n}: every melodic program and drum note renders, or its silence is explained by the bank`, () => {
  const e = instance(W[n].pack), { core, voicesFor } = W[n];
  const maps = [...new Map(core.notes.map((x) => [`${+x.drum}:${x.map}`, x])).values()];
  const silentPrograms = [], silentDrums = [];
  try {
    for (const m of maps) {
      const keys = m.drum ? [...Array(128).keys()] : [48, 60, 72];
      for (let program = 0; program < (m.drum ? 1 : 128); program++) {
        let total = 0; const why = new Set(), audible = [];
        for (const key of keys) {
          const want = voicesFor(m.drum, m.map, program, key), delay = Math.max(0, ...want.voices.map((v) => v.delay));
          msg(e, 0xff); select(e, m.drum ? 9 : 0, m.bank, program); msg(e, (m.drum ? 0x99 : 0x90), key, 110);
          const { l, r } = render(e, 5120 + delay), en = energy(l) + energy(r);
          assert(l.every(Number.isFinite) && r.every(Number.isFinite));
          if (m.drum) { if (!en) silentDrums.push({ map: m.map, kit: m.bank, key, why: want.why }); else audible.push(key); assert(en > 0 || want.why.length, `drum map ${m.map} key ${key} silent without a bank reason`); }
          total += en; want.why.forEach((w) => why.add(w));
        }
        if (!m.drum && !total) silentPrograms.push({ map: m.map, bank: m.bank, program, why: [...why] });
        if (!m.drum) assert(total > 0 || why.size, `map ${m.map} program ${program} silent without a bank reason`);
      }
    }
  } finally { e.profile_close(); }
  for (const s of [...silentPrograms, ...silentDrums]) assert(s.why.length, `unexplained silence ${JSON.stringify(s)}`);
  Object.assign(report.wavesets[n], { reachableMaps: maps.map((m) => `${m.drum ? 'drum' : 'melodic'} map ${m.map} via ${m.drum ? 'kit' : 'bank'} ${m.bank}`), silentPrograms, silentDrums });
  console.log(`${n}: ${maps.length} reachable maps; silent programs ${silentPrograms.length}, silent drum notes ${silentDrums.length}`);
});

/* ---------- 3. Layers, sample boundaries and loops ---------- */
for (const n of NAMES) test(`${n}: layered instruments start one voice per active layer (WASM)`, () => {
  const e = instance(W[n].pack);
  let dual = 0, split = 0;
  try {
    for (const note of W[n].core.notes.filter((x) => !x.drum && x.bank === 0 && x.key % 12 === 0)) {
      msg(e, 0xff); select(e, 0, 0, note.program); msg(e, 0x90, note.key, 100);
      const want = W[n].voicesFor(false, note.map, note.program, note.key).voices;
      assert.equal(e.profile_voices(), want.length, `program ${note.program} key ${note.key}`);
      if (want.length === 2) dual++;
    }
    const r = W[n].R.instruments, splitInst = r.findIndex((x) => x.type === 'Split');
    if (splitInst >= 0) split = 1;
  } finally { e.profile_close(); }
  assert(dual > 0, 'some programs are dual-layer');
  report.wavesets[n].dualLayerNotesChecked = dual;
  report.wavesets[n].hasSplitInstruments = !!split;
});
for (const n of NAMES) test(`${n}: no voice reads outside its sample; every looped sample wraps (native, with +24 semitone bend too)`, () => {
  const b = JSON.parse(run(TRACE, ['bounds', W[n].packPath]).toString());
  assert.equal(b.out_of_sample_reads, 0);
  assert(b.reads > 0 && b.voices > 0);
  assert.equal(b.loops_wrapped, b.looped, 'every looped sample header reached its loop end and wrapped');
  report.wavesets[n].bounds = b;
});

/* ---------- 4. Tuning ---------- */
// Sustained GM programs (organs, reeds, pipes, brass, strings, leads); keys 48, 60, 72; tolerance 15 cents.
const TUNING_PROGRAMS = [16, 19, 20, 21, 22, 40, 41, 42, 48, 52, 56, 57, 60, 61, 64, 65, 68, 70, 71, 73, 74, 79, 80, 81];
const TOLERANCE = 15;
for (const n of NAMES) test(`${n}: sustained notes sound at the MIDI note frequency (±${TOLERANCE} cents)`, () => {
  const e = instance(W[n].pack), rows = [];
  try {
    for (const program of TUNING_PROGRAMS) for (const key of [48, 60, 72]) {
      msg(e, 0xff); select(e, 0, 0, program); msg(e, 0x90, key, 100);
      const x = mono(render(e, 22050)), { hz, subOctave } = pitch(x, 11025, key);
      rows.push({ program, key, hz: +hz.toFixed(3), cents: hz ? +cents(hz, key).toFixed(1) : null, ...(subOctave && { subOctave }) });
    }
  } finally { e.profile_close(); }
  const bad = rows.filter((r) => r.cents === null || Math.abs(r.cents) > TOLERANCE);
  const c = rows.map((r) => r.cents).filter((x) => x !== null).sort((a, b) => a - b);
  report.wavesets[n].tuning = { tolerance: TOLERANCE, median: c[c.length >> 1], min: c[0], max: c[c.length - 1], outside: bad, subOctave: rows.filter((r) => r.subOctave).map((r) => `${r.program}/${r.key}`), rows };
  console.log(`${n}: tuning median ${c[c.length >> 1]} cents, range ${c[0]}..${c[c.length - 1]}, outside ±${TOLERANCE}: ${JSON.stringify(bad)}`);
  assert.deepEqual(bad, []);
});

/* ---------- 5. Envelopes, sustain, pan, bend, voices, controllers, SysEx (8M waveset) ---------- */
const N8 = 'EAPCI8M';
function pickProgram(pred) {
  for (const note of W[N8].core.notes) if (!note.drum && note.bank === 0 && note.key === 60 && note.voices.length === 1) {
    const P = W[N8].R.patches[note.voices[0].patch]; if (pred(P, note.voices[0], note)) return note;
  }
  throw Error('no program matches');
}
const holdDrum = playable(N8, (x) => { const P = x.drum && x.voices.length === 1 && W[N8].R.patches[x.voices[0].patch]; return P && P.amplitude_envelope.release_flag === 1 && (P.pitch_envelope_level === 0 || P.pitch_envelope.release_flag === 1); });
const sustained = pickProgram((P, v) => v.loop && P.amplitude_envelope.release_flag === 0 && P.amplitude_envelope.level_sustain > 60 && P.vib_depth === 0 && P.pitch_envelope_level === 0 && !v.delay && Math.abs(v.pan) < 1e-6);
test('envelope: a patch whose amplitude release flag is 1 ignores note-off (spec)', () => {
  const a = instance(W[N8].pack), b = instance(W[N8].pack);
  try {
    for (const e of [a, b]) { select(e, 9, holdDrum.bank, 0); msg(e, 0x99, holdDrum.key, 120); }
    const head = [render(a, 2048), render(b, 2048)];
    assert.deepEqual(head[0], head[1]);
    msg(a, 0x89, holdDrum.key, 0);
    assert.deepEqual(render(a, 22050), render(b, 22050));
  } finally { a.profile_close(); b.profile_close(); }
});
test('envelope: release flag 0 decays to silence after note-off; sustain level 0 falls silent while held (spec)', () => {
  const e = instance(W[N8].pack);
  try {
    select(e, 0, 0, sustained.program); msg(e, 0x90, 60, 100);
    const held = rms(mono(render(e, 22050)));
    msg(e, 0x80, 60, 0);
    let frames = 0; while (e.profile_voices() && frames < 22050 * 30) { render(e, 1280); frames += 1280; }
    assert.equal(e.profile_voices(), 0, 'released voice freed');
    assert(held > 0 && energy(render(e, 4096).l) === 0);
    const releaseFrames = frames;
    const decaying = pickProgram((P, v) => P.amplitude_envelope.level_sustain === 0 && P.amplitude_envelope.release_flag === 0 && v.loop);
    msg(e, 0xff); select(e, 0, 0, decaying.program); msg(e, 0x90, 60, 100);
    const onset = rms(mono(render(e, 4096)));
    frames = 0; while (e.profile_voices() && frames < 22050 * 60) { render(e, 1280); frames += 1280; }
    assert(onset > 0); assert.equal(e.profile_voices(), 0, 'held note whose envelope reached level 0 is silent and freed');
    report.envelope = { releasedProgram: sustained.program, releaseFrames, decayingProgram: decaying.program, decayFramesHeld: frames };
  } finally { e.profile_close(); }
});
test('sustain pedal holds released notes until pedal up (MIDI CC64)', () => {
  const a = instance(W[N8].pack), b = instance(W[N8].pack);
  try {
    for (const e of [a, b]) { select(e, 0, 0, sustained.program); msg(e, 0xb0, 64, 127); msg(e, 0x90, 60, 100); }
    render(a, 4096); render(b, 4096);
    msg(a, 0x80, 60, 0);
    assert.deepEqual(render(a, 11025), render(b, 11025));
    msg(a, 0xb0, 64, 0); msg(b, 0xb0, 64, 0);
    const ra = render(a, 44100), rb = render(b, 44100);
    assert(energy(ra.l, 22050) < energy(rb.l, 22050) * 0.5, 'pedal up releases');
  } finally { a.profile_close(); b.profile_close(); }
});
test('pan: CC10 0/127 is hard left/right; a bank layer panned left (negative) or right is louder on that side', () => {
  const e = instance(W[N8].pack);
  try {
    for (const [value, silent] of [[0, 'r'], [127, 'l']]) {
      msg(e, 0xff); select(e, 0, 0, sustained.program); msg(e, 0xb0, 10, value); msg(e, 0x90, 60, 100);
      const out = render(e, 8192); assert.equal(energy(out[silent]), 0); assert(energy(out[silent === 'r' ? 'l' : 'r']) > 0);
    }
    for (const sign of [-1, 1]) {
      const note = W[N8].core.notes.find((x) => x.voices.length && x.voices.every((v) => v.pan * sign >= 0.4 && !v.delay));
      msg(e, 0xff); select(e, note.drum ? 9 : 0, note.bank, note.program); msg(e, note.drum ? 0x99 : 0x90, note.key, 100);
      const { l, r } = render(e, 8192);
      assert(sign < 0 ? energy(l) > energy(r) * 2 : energy(r) > energy(l) * 2, `layer pan ${note.voices.map((v) => v.pan)} (${note.drum ? 'drum' : 'program'} ${note.program}, key ${note.key})`);
    }
  } finally { e.profile_close(); }
});
test('pitch bend: +8191 bends +2 semitones by default, +12 after RPN 0 = 12, within 5 cents', () => {
  const e = instance(W[N8].pack);
  try {
    const measure = (setup) => { msg(e, 0xff); select(e, 0, 0, sustained.program); setup(); msg(e, 0x90, 60, 100); return f0(mono(render(e, 22050)), 11025); };
    const base = measure(() => {});
    const two = measure(() => msg(e, 0xe0, 127, 127));
    const twelve = measure(() => { msg(e, 0xb0, 101, 0); msg(e, 0xb0, 100, 0); msg(e, 0xb0, 6, 12); msg(e, 0xe0, 127, 127); });
    const got = [two, twelve].map((f) => 1200 * Math.log2(f / base)), want = [200, 1200].map((c) => (c * 8191) / 8192);
    report.bend = { base, cents: got };
    got.forEach((c, i) => assert(Math.abs(c - want[i]) < 5, `${c} vs ${want[i]}`));
  } finally { e.profile_close(); }
});
test('voices: at the 64-voice cap the oldest voice is stolen', () => {
  const e = instance(W[N8].pack);
  const keys = [...Array(80).keys()].map((k) => 24 + k), map = W[N8].R.bank_map[0];
  const program = [...Array(128).keys()].find((p) => keys.every((k) => { const v = W[N8].voicesFor(false, map, p, k).voices; return v.length === 1 && !v[0].group && !v[0].delay && W[N8].R.patches[v[0].patch].amplitude_envelope.release_flag === 0; }));
  assert(program !== undefined, 'a program with one releasing voice per key');
  report.voiceCapProgram = program;
  try {
    select(e, 0, 0, program);
    keys.forEach((k, i) => { msg(e, 0x90, k, 100); assert.equal(e.profile_voices(), Math.min(64, i + 1)); render(e, 128); });
    for (const k of keys.slice(16)) msg(e, 0x80, k, 0); // release only the 64 newest notes
    let frames = 0; while (e.profile_voices() && frames < 22050 * 30) { render(e, 1280); frames += 1280; }
    assert.equal(e.profile_voices(), 0, 'no held voice of the 16 oldest notes survived');
  } finally { e.profile_close(); }
});
test('controllers: volume, expression, modulation, all sound off, all notes off, reset all controllers', () => {
  const e = instance(W[N8].pack);
  try {
    const play = (setup, frames = 8192) => { msg(e, 0xff); select(e, 0, 0, sustained.program); setup(); msg(e, 0x90, 60, 100); return render(e, frames); };
    assert.equal(energy(play(() => msg(e, 0xb0, 7, 0)).l), 0);
    assert.equal(energy(play(() => msg(e, 0xb0, 11, 0)).l), 0);
    assert(rms(play(() => msg(e, 0xb0, 7, 64)).l) < rms(play(() => msg(e, 0xb0, 7, 127)).l));
    const vib = W[N8].core.notes.find((x) => !x.drum && x.bank === 0 && x.voices.length === 1 && W[N8].R.patches[x.voices[0].patch].mod_sensitivity > 0);
    const withMod = (mod) => { msg(e, 0xff); select(e, 0, 0, vib.program); msg(e, 0xb0, 1, mod); msg(e, 0x90, vib.key, 100); return render(e, 22050); };
    assert.notDeepEqual(withMod(127), withMod(0), 'CC1 adds vibrato to a patch with modulation sensitivity');
    play(() => {}, 128); msg(e, 0xb0, 120, 0); assert.equal(e.profile_voices(), 0, 'CC120');
    play(() => {}, 128); msg(e, 0xb0, 123, 0);
    let frames = 0; while (e.profile_voices() && frames < 22050 * 30) { render(e, 1280); frames += 1280; }
    assert.equal(e.profile_voices(), 0, 'CC123 releases');
    const bent = () => { msg(e, 0xff); select(e, 0, 0, sustained.program); msg(e, 0xe0, 0, 0); msg(e, 0xb0, 121, 0); msg(e, 0x90, 60, 100); return render(e, 8192); };
    const plain = play(() => {});
    assert.deepEqual(bent(), plain, 'CC121 recenters pitch bend');
  } finally { e.profile_close(); }
});
test('SysEx: GM, GM2, GS and XG resets restore power-on state; other valid SysEx is ignored; malformed is rejected', () => {
  const fresh = instance(W[N8].pack), e = instance(W[N8].pack);
  try {
    select(fresh, 0, 0, 0); msg(fresh, 0x90, 60, 100); const want = render(fresh, 8192);
    const resets = [[0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7], [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7], [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]];
    for (const r of resets) {
      select(e, 0, 0, 40); msg(e, 0xb0, 7, 10); msg(e, 0xe0, 0, 0); msg(e, 0x90, 64, 100); render(e, 512);
      assert.equal(sysex(e, r), 1); assert.equal(e.profile_voices(), 0);
      msg(e, 0x90, 60, 100); assert.deepEqual(render(e, 8192), want, `reset ${r.map((x) => x.toString(16)).join(' ')}`);
      msg(e, 0xff);
    }
    const a = instance(W[N8].pack);
    try {
      for (const x of [a, e]) { select(x, 0, 0, 0); msg(x, 0x90, 60, 100); }
      assert.equal(sysex(e, [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04, 0x40, 0x7c, 0xf7]), 1, 'GS master volume accepted and ignored');
      assert.deepEqual(render(e, 4096), render(a, 4096));
      assert.equal(sysex(e, [0xf0, 0x41, 0x80, 0xf7]), 0); assert.equal(sysex(e, [0xf0, 0x7e, 0x7f]), 0);
    } finally { a.profile_close(); }
  } finally { fresh.profile_close(); e.profile_close(); }
});

/* ---------- 6. Native versus WASM, fuzzing, performance ---------- */
test('native clang build renders the same PCM as the WASM build on the 8M waveset', () => {
  const events = [], add = (frame, s, a, b) => events.push([frame, s, a, b]);
  let t = 0;
  for (const [ch, program] of [[0, 0], [1, 48], [2, 80], [3, 24], [4, 73]]) { add(0, 0xb0 | ch, 0, 0); add(0, 0xc0 | ch, program, 0); add(0, 0xb0 | ch, 10, 20 * ch + 10); }
  for (let bar = 0; bar < 24; bar++) {
    t = bar * 11025;
    for (let ch = 0; ch < 5; ch++) { add(t + ch * 37, 0x90 | ch, 48 + ((bar * 7 + ch * 5) % 36), 60 + ch * 12); add(t + 9000 + ch, 0x80 | ch, 48 + ((bar * 7 + ch * 5) % 36), 0); }
    add(t, 0x99, 36, 120); add(t + 5512, 0x99, 38 + (bar % 3) * 4, 100); add(t + 2756, 0x99, 42, 90);
    add(t + 4000, 0xe1, bar * 5 % 128, 64 + (bar % 5)); add(t + 6000, 0xb2, 1, bar * 5); add(t + 7000, 0xb0, 64, bar % 2 ? 127 : 0);
  }
  const path = join(BUILD, 'events.txt');
  writeFileSync(path, events.sort((a, b) => a[0] - b[0]).map((e) => e.join(' ')).join('\n') + '\n');
  const native = new Float32Array(new Uint8Array(run(TRACE, ['render', W[N8].packPath, path])).buffer);
  const e = instance(W[N8].pack), chunks = []; let at = 0, next = 0; const end = events[events.length - 1][0] + 128 * 64;
  try {
    while (at < end) {
      while (next < events.length && events[next][0] <= at) { const [, s, a, b] = events[next++]; msg(e, s, a, b); }
      const n = Math.min(128, next < events.length ? events[next][0] - at : 128), ptr = e.profile_render(n);
      chunks.push(new Float32Array(e.memory.buffer, ptr, 2 * n).slice()); at += n;
    }
  } finally { e.profile_close(); }
  const wasmPcm = new Float32Array(chunks.reduce((s, c) => s + c.length, 0)); let o = 0; for (const c of chunks) { wasmPcm.set(c, o); o += c.length; }
  assert.equal(native.length, wasmPcm.length);
  let differ = 0, maxDiff = 0, nonzero = 0;
  for (let i = 0; i < native.length; i++) { const d = Math.abs(native[i] - wasmPcm[i]); if (d) differ++; maxDiff = Math.max(maxDiff, d); if (wasmPcm[i]) nonzero++; }
  report.nativeVsWasm = { frames: native.length / 2, samples: native.length, nonzero, differ, maxDiff };
  console.log('native vs WASM:', JSON.stringify(report.nativeVsWasm));
  assert(nonzero > native.length / 4);
  assert.equal(differ, 0);
});
test('ASan+UBSan: mutations of the real wavesets never crash, read out of bounds or produce invalid PCM', () => {
  const runs = [];
  for (const [n, cases, window, midi] of [['EAPCI2M', 3000, 0, 1], ['EAPCI2M', 3000, 0x7900, 1], ['EAPCI8M', 1500, 0xc500, 1], ['EAPCI4M', 1500, 0xb100, 1]]) {
    const r = spawnSync(FUZZ, [W[n].packPath, String(cases), String(window), String(midi)], { encoding: 'utf8', env: { ...process.env, ASAN_OPTIONS: 'abort_on_error=1:detect_leaks=0', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' } });
    assert.equal(r.status, 0, `${n} ${cases}: ${r.stderr.slice(-2000)}`);
    runs.push({ waveset: n, cases, window, midi: !!midi, output: r.stdout.trim() });
  }
  report.fuzz = runs; console.log('fuzz:', JSON.stringify(runs));
});
test('performance: init time per waveset; render time per 128 frames at 64 voices', () => {
  const perf = {};
  for (const n of NAMES) {
    const times = [];
    for (let i = 0; i < 7; i++) { const t0 = process.hrtime.bigint(); const e = instance(W[n].pack); times.push(Number(process.hrtime.bigint() - t0) / 1e6); e.profile_close(); }
    times.sort((a, b) => a - b); perf[n] = { initMsMedian: +times[3].toFixed(3), initMsMin: +times[0].toFixed(3) };
  }
  const e = instance(W[N8].pack), blocks = [];
  try {
    select(e, 0, 0, sustained.program);
    for (let k = 0; k < 64; k++) msg(e, 0x90, 30 + k, 100);
    assert.equal(e.profile_voices(), 64);
    for (let i = 0; i < 200; i++) e.profile_render(128);
    for (let i = 0; i < 5000; i++) { const t0 = process.hrtime.bigint(); e.profile_render(128); blocks.push(Number(process.hrtime.bigint() - t0) / 1e3); }
    assert.equal(e.profile_voices(), 64, 'all 64 voices sustained through the measurement');
  } finally { e.profile_close(); }
  blocks.sort((a, b) => a - b);
  perf.render64 = { blocks: blocks.length, usMedian: +blocks[blocks.length >> 1].toFixed(2), usP99: +blocks[Math.floor(blocks.length * 0.99)].toFixed(2), realtimeBudgetUs: +((128 / RATE) * 1e6).toFixed(1), program: sustained.program };
  report.performance = perf; console.log('performance:', JSON.stringify(perf), 'wasm bytes', report.wasm.bytes);
});
