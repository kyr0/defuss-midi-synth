/** Checks the roland-mt32 core (Munt libmt32emu) with original MT-32 ROMs the user supplies. Never part of make test:
 * the ROMs are private. Fails loudly without them.
 *   MT32_ROMS=/path/MT32_CONTROL.ROM:/path/MT32_PCM.ROM node --experimental-transform-types scripts/profile-mt32-test.mjs [core.wasm]
 * The paths are separated by the platform path delimiter (":" on macOS and Linux, ";" on Windows). Timings go to
 * output/mt32-profile.json. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {delimiter} from 'node:path';
import {performance} from 'node:perf_hooks';
import {NativeProfileVoices, instantiateProfile} from '../src/profile-voices.ts';

const paths = (process.env.MT32_ROMS ?? '').split(delimiter).filter(Boolean);
if (paths.length !== 2) {
  console.error(`FAIL: MT32_ROMS must name the MT-32 control ROM and PCM ROM, separated by "${delimiter}". No ROMs are bundled or downloaded; supply your own dumps.`);
  process.exit(2);
}
const [control, pcm] = paths.map(p => readFileSync(p));
const sha1 = b => createHash('sha1').update(b).digest('hex');
const known = JSON.parse(readFileSync(new URL('./roms/roland-mt32.json', import.meta.url), 'utf8')).sets
  .find(s => s.files.every(f => { const b = f.role === 1 ? control : pcm; return b.length === f.size && sha1(b) === f.sha1; }));
console.log(known ? `ROM set: ${known.name}` : `ROM set: not listed in scripts/roms/roland-mt32.json (control SHA-1 ${sha1(control)}, PCM SHA-1 ${sha1(pcm)})`);
const module = new WebAssembly.Module(readFileSync(process.argv[2] ?? new URL('../vendor/runtime/profiles/roland-mt32.wasm', import.meta.url)));

const RATE = 48000;
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const dspack = records => Buffer.concat([Buffer.from('DSPK'), u32(1), u32(9), u32(records.length), ...records.flatMap(([role, data]) => [u32(role), u32(data.length), data])]);
const pack = dspack([[1, control], [2, pcm]]);
const create = (asset = pack) => new NativeProfileVoices('roland-mt32', instantiateProfile(module), asset, RATE);
function render(v, n, chunk = 128) {
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0; at < n; at += chunk) v.render(l, r, at, Math.min(chunk, n - at));
  return {l, r};
}
const energy = ({l, r}) => l.reduce((s, x) => s + x * x, 0) + r.reduce((s, x) => s + x * x, 0);
const difference = (a, b) => energy({l: a.l.map((x, i) => x - b.l[i]), r: a.r.map((x, i) => x - b.r[i])});
const checksum = data => (0x80 - (data.reduce((s, x) => s + x, 0) & 0x7f)) & 0x7f;
/** Roland DT1 to the MT-32 (device 10h, model 16h). */
const dt1 = (address, data) => Uint8Array.from([0xf0, 0x41, 0x10, 0x16, 0x12, ...address, ...data, checksum([...address, ...data]), 0xf7]);
const note = channel => channel === 9 ? 36 : 60; // channel 10: rhythm part, key 36 is its bass drum
const stats = d => { const s = [...d].sort((a, b) => a - b); return {median: s[s.length >> 1], p99: s[Math.floor(s.length * 0.99)]}; };
const report = {rom: known?.name ?? null, wasm: process.argv[2] ?? 'vendor/runtime/profiles/roland-mt32.wasm'};

test('init accepts the pair, reports 32 kHz, and rejects partial, swapped or altered packs', () => {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const w = instantiateProfile(module).exports; w._initialize?.();
    const s = performance.now(), at = w.profile_buffer(pack.length) >>> 0;
    new Uint8Array(w.memory.buffer, at, pack.length).set(pack);
    assert.equal(w.profile_init(pack.length), 1, 'the core rejected the supplied ROMs');
    times.push(performance.now() - s);
    assert.equal(w.profile_rate(), 32000);
    w.profile_close();
  }
  report.initMs = stats(times);
  const altered = Buffer.from(pcm); altered[altered.length >> 1] ^= 1;
  for (const bad of [dspack([[1, control]]), dspack([[2, pcm]]), dspack([[1, pcm], [2, control]]), dspack([[1, control], [2, altered]]), dspack([[1, control], [2, pcm], [3, control]])])
    assert.throws(() => create(bad), /initialization failed/);
});

test('notes on channels 2 to 10 sound; channel 1 is unassigned by default', () => {
  for (let channel = 0; channel < 10; channel++) {
    const v = create();
    try {
      v.message(0x90 | channel, note(channel), 100);
      const out = render(v, RATE);
      assert(out.l.every(x => Number.isFinite(x) && Math.abs(x) <= 1) && out.r.every(x => Number.isFinite(x) && Math.abs(x) <= 1), `channel ${channel + 1}: non-finite or clipped`);
      if (channel === 0) assert.equal(energy(out), 0, 'channel 1 should be silent');
      else assert(energy(out) > 1e-3, `channel ${channel + 1} is silent`);
    } finally { v.close(); }
  }
});

test('a SysEx patch change changes the output', () => {
  const take = timbre => { const v = create(); try { if (timbre) v.sysex(dt1([0x03, 0x00, 0x00], timbre)); v.message(0x91, 60, 100); return render(v, RATE); } finally { v.close(); } };
  const a1 = take([0, 0]), b1 = take([1, 0]); // part 1 timbre: group A no. 1, group B no. 1
  assert(energy(a1) > 1e-3 && energy(b1) > 1e-3);
  assert(difference(a1, b1) > 0.01 * energy(a1), 'timbre change left the output unchanged');
});

test('0xFF resets: held notes stop and the power-on parameters return', () => {
  const v = create();
  try {
    for (let channel = 1; channel < 10; channel++) v.message(0x90 | channel, note(channel), 100);
    render(v, 4800);
    assert(v.voices() > 0);
    v.message(0xff, 0, 0);
    assert.equal(v.voices(), 0);
  } finally { v.close(); }
  // Same history except the SysEx writes; no partial sounds before the reset, so Munt's timer jitter is in step.
  const take = (change, reset) => {
    const x = create();
    try {
      if (change) { x.sysex(dt1([0x03, 0x00, 0x00], [1, 0])); x.sysex(dt1([0x10, 0x00, 0x01], [3, 7, 7])); x.sysex(dt1([0x10, 0x00, 0x16], [40])); }
      render(x, 12000);
      if (reset) x.message(0xff, 0, 0);
      x.message(0x91, 60, 100);
      return render(x, RATE);
    } finally { x.close(); }
  };
  const fresh = take(false, true), changed = take(true, false), restored = take(true, true);
  assert(difference(changed, fresh) > 0.01 * energy(fresh), 'the SysEx writes had no effect');
  assert.deepEqual(restored, fresh, 'reset did not restore the power-on state');
});

test('output does not depend on the block partition', () => {
  const play = chunk => { const v = create(); try { v.message(0x91, 60, 100); v.message(0x92, 64, 90); v.message(0x99, 38, 110); return render(v, 2 * RATE, chunk); } finally { v.close(); } };
  assert.deepEqual(play(7), play(128));
});

test('SysEx framing: malformed messages are rejected, foreign ones ignored', () => {
  const v = create();
  try {
    assert.throws(() => v.sysex(Uint8Array.of(0xf0, 0x41, 0x10, 0x16, 0x12, 0x10)), /SysEx rejected/);
    assert.throws(() => v.sysex(Uint8Array.of(0xf0, 0x41, 0x90, 0x16, 0xf7)), /SysEx rejected/);
    v.sysex(Uint8Array.of(0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7)); // GS reset: the MT-32 ignores it
    v.sysex(Uint8Array.of(0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7));
    v.message(0x91, 60, 100);
    assert(energy(render(v, 9600)) > 1e-3);
  } finally { v.close(); }
});

test('render cost per 128 output frames with nine parts sounding', () => {
  const v = create();
  try {
    for (let channel = 1; channel < 10; channel++) for (const key of channel === 9 ? [36, 38, 42] : [60, 64, 67]) v.message(0x90 | channel, key, 100);
    report.partialsAtStart = v.voices();
    const l = new Float32Array(128), r = new Float32Array(128), times = [];
    for (let i = 0; i < 3000; i++) { const s = performance.now(); v.render(l, r, 0, 128); times.push(performance.now() - s); }
    report.render128Ms = stats(times);
  } finally { v.close(); }
  mkdirSync(new URL('../output/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../output/mt32-profile.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
