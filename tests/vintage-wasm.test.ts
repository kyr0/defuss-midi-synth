import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {NativeProfileVoices, instantiateProfile} from '../src/profile-voices.ts';
import {dspack,ecwFixture,gusFixture} from './vintage-fixtures.ts';
type Model = 'sb-pci128'|'gus-gf1';
const models:Model[]=['sb-pci128','gus-gf1'];
function moduleFor(model:Model){return new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/profiles/${model}.wasm`,import.meta.url)));}
const assetFor=(m:Model)=>m==='sb-pci128'?dspack(5,[[32,ecwFixture()]]):gusFixture();
function create(m:Model,asset=assetFor(m)){return new NativeProfileVoices(m,instantiateProfile(moduleFor(m)),asset,48000);}
function render(v:NativeProfileVoices,n:number,chunk=128){const l=new Float32Array(n),r=new Float32Array(n);for(let a=0;a<n;a+=chunk)v.render(l,r,a,Math.min(chunk,n-a));return {l,r};}
const energy=(a:Float32Array)=>a.reduce((s,x)=>s+x*x,0);
for(const m of models){
 test(`${m}: zero imports, real native WAV synthesis and panic`,()=>{
   assert.deepEqual(WebAssembly.Module.imports(moduleFor(m)),[]);
   const v=create(m);try{assert.equal(energy(render(v,4096).l),0);v.message(0x90,60,100);assert.equal(v.voices(),1);const a=render(v,12000);assert(a.l.every(Number.isFinite));assert(a.r.every(Number.isFinite));assert(energy(a.l)>0.01);v.message(0xb0,120,0);assert.equal(v.voices(),0);assert.equal(energy(render(v,4096).l.subarray(32)),0);}finally{v.close();}
 });
 test(`${m}: exact block partition invariance`,()=>{
   const a=create(m),b=create(m);try{a.message(0x90,60,100);b.message(0x90,60,100);assert.deepEqual(render(a,15001),render(b,15001,7));}finally{a.close();b.close();}
 });
 test(`${m}: controller pan, note release, pitch bend, voice bounds`,()=>{
   const v=create(m);try{v.message(0xb0,10,0);v.message(0x90,60,120);const a=render(v,16384);assert(energy(a.l)>energy(a.r)*10);v.message(0xe0,127,127);const b=render(v,4096);assert(energy(b.l)>0);v.message(0xb0,64,127);v.message(0x80,60,0);render(v,4096);assert(v.voices()>0);v.message(0xb0,64,0);render(v,480000);assert.equal(v.voices(),0);for(let i=0;i<128;i++)v.message(0x90,i,100);assert(v.voices()<=v.maxVoices());}finally{v.close();}
 });
 test(`${m}: invalid pack, invalid bank and wrong model rejected`,()=>{
   const a=assetFor(m);for(const b of [a.subarray(0,12),a.subarray(0,a.length-1),dspack(m==='sb-pci128'?5:6,[[32,Buffer.from('bad')]]),dspack(9,[[32,Buffer.from('bad')]])])assert.throws(()=>create(m,Buffer.from(b)),/assets|allocation/);
 });
}
test('ECW bank select, dual layers and alias routing',()=>{const v=create('sb-pci128');try{v.message(0xc0,1,0);v.message(0x90,60,100);assert.equal(v.voices(),1);v.message(0xb0,120,0);v.message(0xb0,0,1);v.message(0x90,60,100);assert.equal(v.voices(),2);assert(energy(render(v,4096).l)>0.01);}finally{v.close();}});
test('GF1 selectable hardware voice count and instrument change',()=>{const v=create('gus-gf1',gusFixture(14));try{assert.equal(v.maxVoices(),14);v.message(0xc0,1,0);v.message(0x90,60,127);assert(energy(render(v,12000).l)>0.01);for(let i=0;i<128;i++)v.message(0x90,i,100);assert.equal(v.voices(),14);}finally{v.close();}});
