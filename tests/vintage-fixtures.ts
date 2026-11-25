/** Synthetic format fixtures, not original proprietary wavesets or patch assets. */
function u32(n: number) { const b=Buffer.alloc(4); b.writeUInt32LE(n);return b; }
export function dspack(model:number, records: [number, Uint8Array][]):Buffer {
  return Buffer.concat([Buffer.from('DSPK'),u32(1),u32(model),u32(records.length),...records.flatMap(([role,data])=>[u32(role),u32(data.length),Buffer.from(data)])]);
}
function waveform(period=64, frames=256) { const b=Buffer.alloc(frames*2);for(let i=0;i<frames;i++) b.writeInt16LE(Math.round(Math.sin(2*Math.PI*i/period)*16000),2*i);return b; }
export function ecwFixture():Buffer {
  const h=Buffer.alloc(0x78c);h.write('ECLW');h.write('Defuss synthetic fixture',0x60);
  const bank=Buffer.alloc(256),drum=Buffer.alloc(256),programs=Buffer.alloc(512),drums=Buffer.alloc(256),inst=Buffer.alloc(69),patch=Buffer.alloc(152),a1=Buffer.alloc(4),a2=Buffer.alloc(2),a3=Buffer.alloc(4),sample=Buffer.alloc(32);
  bank.writeUInt16LE(1,2); // bank 1 -> second map
  for(let i=0;i<128;i++) programs.writeUInt16LE(1,256+i*2);
  // single layer, dual layer, split/alias
  inst[0]=2; inst[23]=2;inst[24]=1;inst.writeUInt16LE(1,23+3);inst.writeUInt16LE(1,23+13);inst[46]=255;inst.writeUInt16LE(0,48);inst[50]=127;
  programs.writeUInt16LE(2,2); // program 1 -> alias -> instrument 0
  for(let i=0;i<2;i++){const off=i*76;patch.writeUInt16LE(i,off+11);patch[off+59]=127;patch[off+61]=127;patch[off+63]=127;patch[off+65]=127;}
  a1.writeUInt16LE(1,2);a3.writeUInt16LE(1,2);
  const wave=Buffer.concat([waveform(),waveform(32)]);
  for(let i=0;i<2;i++){const p=i*16;sample[p]=127;sample[p+1]=2;sample[p+3]=128;sample.writeUInt32LE(i*256*16,p+4);sample.writeUInt32LE(i*256*16,p+8);sample.writeUInt32LE((i+1)*256*16,p+12);}
  const tables:[number,number,Buffer][]=[[0x704,256,bank],[0x710,256,drum],[0x71c,256,programs],[0x728,256,drums],[0x734,23,inst],[0x740,76,patch],[0x750,2,a1],[0x75c,2,a2],[0x768,2,a3],[0x774,16,sample]];
  let at=h.length;for(const [o,stride,t] of tables){h.writeUInt32LE(at,o);h.writeUInt32LE(t.length,o+4);h.writeUInt32LE(t.length/stride,o+8);at+=t.length;}
  h.writeUInt32LE(at,0x784);h.writeUInt32LE(wave.length,0x788);return Buffer.concat([h,...tables.map(t=>t[2]),wave]);
}
export function patFixture(period=64):Buffer {
  const h=Buffer.alloc(129);h.write('GF1PATCH110');h[82]=1;
  const ins=Buffer.alloc(63);ins[22]=1;
  const layer=Buffer.alloc(47);layer[6]=1;
  const s=Buffer.alloc(96),w=waveform(period);
  s.writeUInt32LE(w.length,8);s.writeUInt32LE(w.length,16);s.writeUInt16LE(22050,20);s.writeUInt32LE(20000000,26);s.writeUInt32LE(261626,30);s[36]=7;s.fill(63,37,43);s.fill(255,43,46);s[55]=0x45;
  return Buffer.concat([h,ins,layer,s,w]);
}
export function gusFixture(voices=32):Buffer {
  const p=patFixture(),q=patFixture(32);
  return dspack(6,[[32,Buffer.concat([Buffer.from('GPAT'),u32(1),u32(3),u32(0),u32(p.length),p,u32(1),u32(q.length),q,u32(164),u32(p.length),p])],[33,Buffer.from([voices])]]);
}
