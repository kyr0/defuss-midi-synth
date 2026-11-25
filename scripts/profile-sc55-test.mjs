/** Plays the SC-55 / SC-55mkII reactors with the user's own ROM images. Not part of `make test`: the ROMs are private.
 *
 *   SC55_ROMS=<dir or .dspack> SC55MK2_ROMS=<dir or .dspack> \
 *     node --experimental-transform-types scripts/profile-sc55-test.mjs [roland-sc55] [roland-sc55mk2]
 *
 * A directory is searched for the images of one set of scripts/roms/<profile>.json, by size and SHA-1 (names do not
 * matter); a .dspack is taken as it is. Every profile named (default both) needs its variable, else the run fails. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {NativeProfileVoices, instantiateProfile} from '../src/profile-voices.ts';

const PROFILES = {'roland-sc55': {env: 'SC55_ROMS', id: 7, rate: 64000}, 'roland-sc55mk2': {env: 'SC55MK2_ROMS', id: 8, rate: 66206}};
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROFILES);
for (const p of chosen) if (!PROFILES[p]) throw new Error(`Unknown profile ${p}; choose from ${Object.keys(PROFILES).join(', ')}`);
const missing = chosen.filter(p => !process.env[PROFILES[p].env]);
if (missing.length) {
  console.error(`FAIL: no ROMs. Set ${missing.map(p => `${PROFILES[p].env} (${p})`).join(' and ')} to a directory holding the images of scripts/roms/<profile>.json, or to a .dspack of them; or name only the profiles you have ROMs for.`);
  process.exit(2);
}

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const dspack = (model, records) => Buffer.concat([Buffer.from('DSPK'), u32(1), u32(model), u32(records.length), ...records.flatMap(([role, data]) => [u32(role), u32(data.length), data])]);
function pack(profile) {
  const path = process.env[PROFILES[profile].env];
  if (!statSync(path).isDirectory()) return readFileSync(path);
  const table = JSON.parse(readFileSync(new URL(`./roms/${profile}.json`, import.meta.url), 'utf8'));
  const files = readdirSync(path).map(name => join(path, name)).filter(f => statSync(f).isFile());
  for (const set of table.sets) {
    const records = [];
    for (const want of set.files) {
      const hit = files.filter(f => statSync(f).size === want.size).map(f => readFileSync(f)).find(data =>
        (!want.sha1 || createHash('sha1').update(data).digest('hex') === want.sha1) && (!want.sha256 || createHash('sha256').update(data).digest('hex') === want.sha256));
      if (!hit) break;
      records.push([want.role, hit]);
    }
    if (records.length === set.files.length) { console.log(JSON.stringify({profile, set: set.name})); return dspack(PROFILES[profile].id, records); }
  }
  throw new Error(`${path}: no complete ROM set of scripts/roms/${profile}.json (matched by size and SHA-1)`);
}

const moduleFor = profile => new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/profiles/${profile}.wasm`, import.meta.url)));
function machine(profile, data) {
  const w = instantiateProfile(moduleFor(profile)).exports;
  w._initialize?.();
  const at = w.profile_buffer(data.length) >>> 0;
  assert(at, 'profile_buffer');
  new Uint8Array(w.memory.buffer, at, data.length).set(data);
  const t = performance.now(), ok = w.profile_init(data.length), ms = performance.now() - t;
  assert.equal(ok, 1, `${profile}: profile_init failed, profile_init_error ${w.profile_init_error()}`);
  const send = (s, a = 0, b = 0) => assert.equal(w.profile_message(s, a, b), 1, `message ${s}`);
  const sysex = bytes => { new Uint8Array(w.memory.buffer, w.profile_sysex_buffer() >>> 0, bytes.length).set(bytes); return w.profile_sysex(bytes.length); };
  /** n frames in blocks of `chunk`, left then right */
  const render = (n, chunk = 128) => {
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let at = 0; at < n; at += chunk) {
      const k = Math.min(chunk, n - at), ptr = w.profile_render(k) >>> 0;
      assert(ptr && ptr % 4 === 0);
      const v = new Float32Array(w.memory.buffer, ptr, 2 * k);
      l.set(v.subarray(0, k), at); r.set(v.subarray(k), at);
    }
    return {l, r};
  };
  return {w, ms, send, sysex, render};
}
const rms = ({l, r}) => { let s = 0; for (let i = 0; i < l.length; i++) { assert(Number.isFinite(l[i]) && Number.isFinite(r[i]) && Math.abs(l[i]) <= 1 && Math.abs(r[i]) <= 1); s += l[i] * l[i] + r[i] * r[i]; } return Math.sqrt(s / (2 * l.length)); };
const roland = (address, data) => { const body = [...address, ...data], sum = (128 - body.reduce((a, b) => a + b, 0) % 128) % 128; return Uint8Array.from([0xf0, 0x41, 0x10, 0x42, 0x12, ...body, sum, 0xf7]); };
const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

let failures = 0;
function check(profile, name, fn) {
  try { const result = fn(); console.log(JSON.stringify({profile, check: name, ok: true, ...result})); }
  catch (e) { failures++; console.log(JSON.stringify({profile, check: name, ok: false, error: String(e?.message ?? e)})); }
}

for (const profile of chosen) {
  const data = pack(profile), {rate} = PROFILES[profile];
  check(profile, 'boot', () => {
    const m = machine(profile, data);
    assert.equal(m.w.profile_rate(), rate);
    const frames = m.w.profile_boot_frames();
    m.w.profile_close();
    return {initMs: Math.round(m.ms), bootFrames: frames, bootSeconds: +(frames / rate).toFixed(3), rate};
  });
  const m = machine(profile, data), sec = s => Math.round(s * rate);
  const note = (status, key, frames = sec(1)) => { m.send(status, key, 100); const a = m.render(frames); m.send((status & 0x0f) | 0x80, key, 0); m.render(sec(0.5)); return a; };
  check(profile, 'GM notes sound', () => {
    const levels = {};
    for (const program of [0, 24, 40, 56, 73]) { m.send(0xc0, program); levels[program] = +rms(note(0x90, 60)).toFixed(5); assert(levels[program] > 1e-3, `program ${program} silent`); }
    return {rmsByProgram: levels};
  });
  check(profile, 'GM drums sound', () => {
    const levels = {};
    for (const key of [36, 38, 42, 49]) { levels[key] = +rms(note(0x99, key, sec(0.5))).toFixed(5); assert(levels[key] > 1e-3, `drum ${key} silent`); }
    return {rmsByKey: levels};
  });
  check(profile, 'note onset after the message', () => {
    m.send(0xc0, 0); m.render(sec(1));
    m.send(0x90, 72, 127);
    const a = m.render(sec(0.25)); m.send(0x80, 72, 0); m.render(sec(1));
    const onset = a.l.findIndex((x, i) => Math.abs(x) > 1e-3 || Math.abs(a.r[i]) > 1e-3);
    assert(onset >= 0, 'no onset');
    return {onsetFrames: onset, onsetMs: +(onset / rate * 1000).toFixed(2)};
  });
  check(profile, 'voices', () => {
    m.send(0xc0, 0); m.send(0x90, 60, 100); m.render(sec(0.25));
    const one = m.w.profile_voices();
    for (let k = 0; k < 40; k++) m.send(0x90 | (k % 9), 40 + k, 100);
    m.render(sec(0.25));
    const many = m.w.profile_voices();
    for (let c = 0; c < 16; c++) m.send(0xb0 | c, 123, 0);
    m.send(0x80, 60, 0); m.render(sec(5));
    const after = m.w.profile_voices();
    assert(one >= 1, 'a held note keys no voice'); assert(after === 0, `${after} voices keyed 5 s after all notes off`);
    return {oneNote: one, fortyNotes: many, afterRelease: after};
  });
  check(profile, 'GS SysEx changes the output and 0xFF resets it', () => {
    m.send(0xc0, 0);
    const before = rms(note(0x90, 60));
    assert.equal(m.sysex(roland([0x40, 0x00, 0x04], [0x00])), 1); // GS Master Volume 0
    m.render(sec(0.25));
    const quiet = rms(note(0x90, 60));
    m.send(0xff); m.render(sec(0.5)); // GS Reset, and the firmware's time to apply it
    const reset = rms(note(0x90, 60));
    assert(quiet < before * 0.1, `master volume 0: ${quiet} vs ${before}`);
    assert(reset > before * 0.5 && reset < before * 2, `after reset ${reset} vs ${before}`);
    return {before: +before.toFixed(5), masterVolume0: +quiet.toFixed(5), afterReset: +reset.toFixed(5)};
  });
  check(profile, 'SysEx results', () => {
    assert.equal(m.sysex(Uint8Array.from([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])), 1); // GM System On
    assert.equal(m.sysex(Uint8Array.from([0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7])), 1); // XG, ignored by the unit
    assert.equal(m.sysex(Uint8Array.from([0xf0, 0x80, 0xf7])), 0);
    m.render(sec(0.5));
    return {};
  });
  check(profile, 'block partition invariance', () => {
    const a = machine(profile, data), b = machine(profile, data), n = sec(3), off = 40000;
    const run = (x, chunk) => { x.send(0xc0, 0); x.send(0x90, 60, 100); x.send(0x99, 38, 100); const h = x.render(off, chunk); x.send(0x80, 60, 0); const t = x.render(n - off, chunk); x.w.profile_close(); return [...h.l, ...t.l, ...h.r, ...t.r]; };
    const left = run(a, 128), right = run(b, 7);
    assert.equal(left.length, right.length);
    const first = left.findIndex((x, i) => !Object.is(x, right[i]));
    assert.equal(first, -1, `blocks of 128 and 7 differ at sample ${first}`);
    return {frames: n};
  });
  check(profile, 'real-time factor (128-frame blocks, 16 parts playing)', () => {
    const x = machine(profile, data), times = [];
    for (let c = 0; c < 16; c++) x.send(0xc0 | c, c * 8);
    for (let i = 0; i < 4000; i++) {
      if (i % 64 === 0) for (let c = 0; c < 16; c++) { const key = 48 + (i / 64 + c * 5) % 24; x.send(0x90 | c, key, 90); x.send(0x80 | c, key, 0); x.send(0x90 | c, key + 7, 90); }
      const t = performance.now(); x.w.profile_render(128); times.push(performance.now() - t);
    }
    const voices = x.w.profile_voices(); x.w.profile_close();
    times.sort((p, q) => p - q);
    const budget = 128 / rate * 1000, median = percentile(times, 0.5), p99 = percentile(times, 0.99);
    return {medianMs: +median.toFixed(4), p99Ms: +p99.toFixed(4), budgetMs: +budget.toFixed(4), realtimeFactorMedian: +(budget / median).toFixed(2), realtimeFactorP99: +(budget / p99).toFixed(2), voicesAtEnd: voices};
  });
  check(profile, 'host NativeProfileVoices at 48 kHz', () => {
    const v = new NativeProfileVoices(profile, instantiateProfile(moduleFor(profile)), data, 48000);
    try {
      const l = new Float32Array(48000), r = new Float32Array(48000);
      v.setPreset(0, 0, 0); v.message(0x90, 64, 100);
      for (let at = 0; at < 48000; at += 128) v.render(l, r, at, Math.min(128, 48000 - at));
      v.sysex(roland([0x40, 0x00, 0x7f], [0x00])); // GS Reset through the host's SysEx path
      const level = rms({l, r}); assert(level > 1e-3, 'silent');
      return {rms: +level.toFixed(5), presets: v.presets().length, maxVoices: v.maxVoices()};
    } finally { v.close(); }
  });
  m.w.profile_close();
}
if (failures) { console.error(`FAIL: ${failures} check(s) failed`); process.exit(1); }
console.log('PASS');
