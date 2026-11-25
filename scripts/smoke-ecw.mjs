/** Exercise the actual downloaded wavesets against the production WASM, no web or AudioWorklet dependency. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory=process.argv[2];if(!directory)throw Error('Usage: node scripts/smoke-ecw.mjs DIRECTORY');
const module=new WebAssembly.Module(readFileSync(new URL('../vendor/runtime/profiles/sb-pci128.wasm',import.meta.url)));
for(const name of ['EAPCI2M','EAPCI4M','EAPCI8M']){
  const data=readFileSync(join(directory,`${name}.ECW.dspack`));const e=new WebAssembly.Instance(module).exports;
  const ptr=e.profile_buffer(data.length);assert(ptr);new Uint8Array(e.memory.buffer,ptr,data.length).set(data);assert.equal(e.profile_init(data.length),1);assert.equal(e.profile_rate(),22050);
  const silent=[];
  try{
    for(let p=0;p<128;p++){
      e.profile_message(255,0,0);e.profile_message(0xc0,p,0);let energy=0;
      for(const note of [48,60,72]){
        e.profile_message(0x90,note,110);
        for(let i=0;i<100;i++){const ptr=e.profile_render(128);assert(ptr);for(const f of new Float32Array(e.memory.buffer,ptr,256)){assert(Number.isFinite(f)&&Math.abs(f)<=1);energy+=f*f;}}
        e.profile_message(0xb0,120,0);
      }
      if(energy===0)silent.push(p);
    }
    console.log(JSON.stringify({waveset:name,programsAudible:128-silent.length,silent}));if(silent.length)process.exitCode=1;
  }finally{e.profile_close();}
}
