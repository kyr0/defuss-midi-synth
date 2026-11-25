import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { Engine, SYNTH_IMPORTS } from '../src/engine.ts';
import { FmVoices } from '../src/voices.ts';
import { RenderSession } from '../src/session.ts';
import { NativeClock } from '../src/profile-clock.ts';
import { PROFILE_DESCRIPTORS, SYNTH_PROFILES, isSynthProfile, selectEngine } from '../src/profiles.ts';
import { normalizeOptions, OP } from '../src/types.ts';
function wasm(file: string) { return new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/${file}`, import.meta.url))), SYNTH_IMPORTS); }
function fm(engine: 'fm' | 'sb16-opl3') { return Engine.withFm(wasm('fm-synth.wasm'), { engine, chips: 2 }); }
test('exact profile IDs and prototype-safe validation', () => {
  assert.equal(SYNTH_PROFILES.length, 10); assert.equal(new Set(SYNTH_PROFILES).size, 10);
  assert.equal(new Set(SYNTH_PROFILES.map(p => PROFILE_DESCRIPTORS[p].id)).size, 10);
  for (const id of SYNTH_PROFILES) assert.equal(isSynthProfile(id), true);
  for (const id of ['__proto__', 'constructor', 'toString', 'fm', 1, undefined]) assert.equal(isSynthProfile(id), false);
  assert.throws(() => selectEngine('fm', 'sb16-opl3'), /disagree/);
  assert.equal(selectEngine(undefined, 'sb16-opl3'), 'sb16-opl3');
});
test('all profiles have an implementation or pinned build adapter', () => {
  for (const id of SYNTH_PROFILES) assert.ok(['bundled', 'build-required', 'local-build-required'].includes(PROFILE_DESCRIPTORS[id].availability));
  assert.equal(PROFILE_DESCRIPTORS['sb-pci128'].availability, 'bundled');
  assert.equal(PROFILE_DESCRIPTORS['gus-gf1'].availability, 'bundled');
});
test('actual Yamaha engine: single chip vs legacy two chips, audible output', () => {
  for (const kind of ['fm', 'sb16-opl3'] as const) {
    const e = fm(kind);
    try {
      const count = kind === 'fm' ? 2 : 1;
      assert.equal(e.info().fm?.chips, count); assert.equal(e.info().maxVoices, count * 18);
      const session = new RenderSession(e), l = new Float32Array(48000), r = new Float32Array(48000);
      session.schedule([[0, OP.noteOn, 0, 60, 100], [24000, OP.noteOff, 0, 60, 0]]);
      session.process(l,r);
      assert(l.every(Number.isFinite)); assert(r.every(Number.isFinite));
      const rms=Math.sqrt(l.reduce((sum,x)=>sum+x*x,0)/l.length);
      assert(rms>0.0001); console.log(kind, 'RMS',rms);
    } finally { e.close(); }
  }
});
test('real WASM: SF2 and distinct FM profiles coexist and switch', () => {
  const font = brotliDecompressSync(readFileSync(new URL('../vendor/soundfonts/TimGM6mb.sf2.br', import.meta.url)));
  const settings = normalizeOptions({engine:'fm', chips:2});
  const e = Engine.withSoundFont(wasm('midi-synth.wasm'),font,settings);
  try {
    e.add(new FmVoices(wasm('fm-synth.wasm'),settings,'fm'));
    e.add(new FmVoices(wasm('fm-synth.wasm'),settings,'sb16-opl3'));
    assert.deepEqual(e.info().engines,['soundfont','fm','sb16-opl3']);
    e.use('sb16-opl3'); assert.equal(e.info().fm?.chips,1);
    e.use('fm'); assert.equal(e.info().fm?.chips,2);
    e.use('soundfont'); assert.equal(e.info().kind,'soundfont');
    const l=new Float32Array(8192), r=new Float32Array(8192), session=new RenderSession(e);
    session.schedule([[0,OP.noteOn,0,60,100]]); session.process(l,r);
    assert(l.some(x=>Math.abs(x)>0.0001));
  } finally { e.close(); }
});
function clockRun(rate:number, out:number, block:number) {
  const c=new NativeClock(rate,out), l=new Float32Array(8191), r=new Float32Array(8191); let tick=0;
  const pull=(left:Float32Array,right:Float32Array,n:number)=>{ for(let i=0;i<n;i++){left[i]=Math.sin(tick/40);right[i]=Math.cos(tick++/31);} };
  for(let at=0;at<l.length;at+=block)c.render(l,r,at,Math.min(block,l.length-at),pull);
  return {l,r,tick};
}
test('native clock: exact output and consumed samples independent of block partition', () => {
  for(const [rate,out] of [[32000,48000],[49716,44100],[44100,44100],[192000,8000],[8000,192000]]) {
    const a=clockRun(rate!,out!,128), b=clockRun(rate!,out!,7);
    assert.deepEqual(a,b); assert.equal(a.tick,Math.floor(8191*rate!/out!));
  }
  assert.throws(()=>new NativeClock(0,48000),/Invalid/);
});
