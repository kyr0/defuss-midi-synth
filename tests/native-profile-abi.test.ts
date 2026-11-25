import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NativeProfileVoices, instantiateProfile } from '../src/profile-voices.ts';
const available = spawnSync('clang', ['--version']).status === 0;
test('native ABI (test double, not hardware): model, assets, stereo PCM, lifecycle', {skip: !available}, () => {
  const tmp=mkdtempSync(join(tmpdir(),'defuss-profile-'));
  try {
    const out=join(tmp,'test.wasm');
    const result=spawnSync('clang',['--target=wasm32','-nostdlib','-Wl,--no-entry','-Wl,--export-all','-Wl,--export-memory',fileURLToPath(new URL('./profile-abi-fixture.c',import.meta.url)),'-o',out],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const module=new WebAssembly.Module(readFileSync(out));
    assert.throws(()=>new NativeProfileVoices('roland-sc55',instantiateProfile(module),new Uint8Array([42]),48000),/model mismatch/);
    assert.throws(()=>new NativeProfileVoices('roland-mt32',instantiateProfile(module),new Uint8Array([41]),48000),/initialization failed/);
    const v=new NativeProfileVoices('roland-mt32',instantiateProfile(module),new Uint8Array([42]),48000);
    assert.equal(v.maxVoices(),32);assert.equal(v.voices(),0);assert.equal(v.presets().length,128);
    v.message(0x91,60,100);assert.equal(v.voices(),1);
    const l=new Float32Array(128),r=new Float32Array(128);v.render(l,r,0,128);
    assert.equal(l[127],0.25);assert.equal(r[127],-0.5);
    v.message(0x81,60,0);v.render(l,r,0,128);assert.equal(l[127],0);assert.equal(r[127],0);
    v.close();v.close();assert.throws(()=>v.message(0x91,60,100),/closed/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
