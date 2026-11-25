/** gus-gf1 core without private assets: the ABI contract, driver data, and the Gravis UltraSound
 * SDK 2.10 patch-format branches that the original Gravis set does not use (reverse, signed data,
 * layers, overlapping ranges, keyboard scaling). The original set: scripts/profile-gf1-test.mjs. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Core, gusModule, gusPack, dspack, gpat, synthPat, sine, fundamental, cents, SDK_RATES, MODE, FLAG_16BIT, FLAG_PRELOAD, GUS_MODEL, acRms } from './gf1-fixtures.ts';

const module = gusModule();
const tone = (period = 64, extra = {}) => ({ pcm: sine(period, period * 40), loop: [period * 8, period * 40 - 1] as [number, number], ...extra });
const open = (pack: Uint8Array) => { const c = new Core(module, pack); assert(c.ok, 'profile_init'); return c; };

test('gus-gf1: zero imports, ABI 2, model 6', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const c = open(gusPack([[0, synthPat([[tone()]])]]));
  assert.equal(c.e.profile_abi(), 2); assert.equal(c.e.profile_model(), GUS_MODEL); c.close();
});

test('gus-gf1: driver data and pack validation', () => {
  const pat = synthPat([[tone()]]), bank = gpat([[0, pat]]);
  const rejected = (pack: Uint8Array) => { const c = new Core(module, pack); assert(!c.ok); c.close(); };
  rejected(dspack(GUS_MODEL, [[33, Uint8Array.of(32)]]));                // no bank
  rejected(dspack(GUS_MODEL, [[32, bank], [34, Uint8Array.of(1)]]));     // unknown role
  for (const v of [13, 33]) rejected(gusPack([[0, pat]], v));            // GF1: 14..32 active voices
  rejected(gusPack([[0, pat]], 32, FLAG_16BIT | FLAG_PRELOAD));          // UltraMID: "Can't use -16 and -c parameters simultaneously"
  rejected(gusPack([[0, pat]], 32, 4));
  rejected(gusPack([[0, synthPat([[tone()]], 'GF1PATCH100')]]));         // SDK: version 100 patches are obsolete
  rejected(dspack(GUS_MODEL + 1, [[32, bank]]));
  const c = open(dspack(GUS_MODEL, [[32, bank]])); assert.equal(c.rate, 19293); c.close(); // default 32 voices
});

test('gus-gf1: native rate is the SDK table, 617400 / active voices', () => {
  const pat = synthPat([[tone()]]);
  for (let v = 14; v <= 32; v++) { const c = open(gusPack([[0, pat]], v)); assert.equal(c.rate, SDK_RATES[v - 14]); assert.equal(c.rate, Math.floor(617400 / v)); c.close(); }
});

test('gus-gf1: signed and unsigned data play identically (modes bit 1)', () => {
  const render = (unsigned: boolean) => { const c = open(gusPack([[0, synthPat([[tone(64, { unsigned })]])]])); c.msg(0x90, 60, 127); const o = c.render(4096); c.close(); return o; };
  const a = render(false), b = render(true);
  assert.deepEqual(a, b); assert(acRms(a.l) > 0.01);
});

test('gus-gf1: reverse plays from the end toward the start (modes bit 4)', () => {
  const ramp = Int16Array.from({ length: 8000 }, (_, i) => Math.round(-16000 + 4 * i));
  const slope = (reverse: boolean) => {
    const c = open(gusPack([[0, synthPat([[{ pcm: ramp, modes: MODE.sustain | MODE.envelope | (reverse ? MODE.reverse : 0) }]])]]));
    c.msg(0x90, 60, 127); const { l } = c.render(1200); c.close();
    return l[1100]! - l[400]!;
  };
  assert(slope(false) > 0); assert(slope(true) < 0);
});

test('gus-gf1: every layer sounds on one note', () => {
  const c = open(gusPack([[0, synthPat([[tone(64)], [tone(40)]])]]));
  c.msg(0x90, 60, 100); assert.equal(c.voices(), 2); c.close();
});

test('gus-gf1: of overlapping waves the later one plays', () => {
  const c = open(gusPack([[0, synthPat([[tone(64, { low: 100000, high: 400000 }), tone(32, { low: 200000, high: 300000 })]])]]));
  c.msg(0x90, 60, 127); const { l } = c.render(8192);
  const f = fundamental(l.subarray(2048), c.rate); c.close();
  // tone(32) at the root 261.626 Hz key 60 plays its recorded pitch: 22050 / 32 Hz.
  assert(Math.abs(cents(f, 22050 / 32)) < 10, `${f}`);
});

test('gus-gf1: keyboard scaling, scale_factor 1024 per semitone around scale_frequency', () => {
  const pitch = (scaleFactor: number, key: number) => {
    const c = open(gusPack([[0, synthPat([[tone(64, { scaleNote: 60, scaleFactor })]])]]));
    c.msg(0x90, key, 127); const { l } = c.render(8192); const f = fundamental(l.subarray(2048), c.rate); c.close(); return f;
  };
  assert(Math.abs(cents(pitch(0, 40), pitch(0, 80))) < 1);           // 0: every key plays the pivot's pitch
  assert(Math.abs(cents(pitch(512, 72), pitch(512, 60)) - 600) < 10); // 512: half a semitone per key
  assert(Math.abs(cents(pitch(1024, 72), pitch(1024, 60)) - 1200) < 10);
});
