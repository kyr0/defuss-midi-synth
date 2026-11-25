import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('output',{recursive:true});
execFileSync('bun',['pm','pack','--destination','output'],{stdio:'pipe'});
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive=resolve(`output/defuss-midi-synth-${version}.tgz`);
const consumer=resolve('tmp/package-consumer');
await rm(consumer,{recursive:true,force:true}); await mkdir(consumer,{recursive:true});
await writeFile(`${consumer}/package.json`,JSON.stringify({name:'isolated-synth-consumer',private:true,type:'module'}));
execFileSync('bun',['add',archive],{cwd:consumer,stdio:'pipe'});
// AWE cores are supplied by the consumer. Its instrument packs must come from the installed tarball.
for (const model of ['awe32', 'awe64']) await cp(`docs/soundcards/${model}.wasm`, `${consumer}/${model}.wasm`);
await writeFile(`${consumer}/smoke.mjs`, `
import { MidiSynth } from 'defuss-midi-synth';
import { OfflineSynth, encodeWav } from 'defuss-midi-synth/offline';
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
const files = await readdir('node_modules/defuss-midi-synth', { recursive: true });
assert.ok(!files.some(f => f.split('/')[0] === 'docs' || /roland|sc55|mt32emu/i.test(f)));
assert.equal(typeof MidiSynth.create, 'function');
const synth=await OfflineSynth.create();
assert.equal(synth.info.presets.length, 136);
synth.schedule([{type:'noteOn',time:0,channel:0,note:60,velocity:100},{type:'noteOn',time:0.5,channel:9,note:38,velocity:100}]);
const pcm=synth.render(48000);
assert.ok(pcm.left.some(x=>x!==0));
await writeFile(${JSON.stringify(resolve('output/package-consumer.wav'))},encodeWav(pcm));
synth.close();
// The FM engine from the package's own assets: 79 banks, a note, and a switch back to the SoundFont.
const fm=await OfflineSynth.create({engine:'fm',fmBank:16});
assert.equal(fm.info.kind,'fm'); assert.equal(fm.info.fm.banks.length,79);
fm.schedule([{type:'noteOn',time:0,channel:0,note:60,velocity:100}]);
assert.ok(fm.render(4800).left.some(x=>x!==0));
assert.equal((await fm.useEngine('soundfont')).presets.length,136);
fm.close();
// SysEx and the hardware profiles from the package's own assets: sb16-opl3 on one chip, a GM System On that ends its
// note, then switch to each bundled native instrument and render using only the installed package.
const sb=await OfflineSynth.create({profile:'sb16-opl3'});
assert.equal(sb.info.profile,'sb16-opl3'); assert.equal(sb.info.fm.chips,1); assert.equal(sb.info.maxVoices,18);
sb.schedule([{type:'noteOn',time:0,channel:0,note:60,velocity:100},{type:'sysex',time:0.05,data:[0xf0,0x7e,0x7f,0x09,0x01,0xf7]}]);
assert.ok(sb.render(2400).left.some(x=>x!==0)); sb.render(4800); assert.equal(sb.engine.voices(),0);
sb.close();
const instruments = [
  ['sb16-cqm'], ['sb-pci128'], ['gus-gf1'],
  ...['awe32', 'awe64'].map(id => [id, { wasm: new URL(id + '.wasm', import.meta.url) }]),
  ...[4, 8].map(size => ['sb-pci128', { assets: 'assets/profiles/sb-pci128-' + size + 'm.dspack' }]),
];
for (const [profile, sources] of instruments) {
  const card = await OfflineSynth.create({ profile, profileSources: sources && { [profile]: sources } });
  card.schedule([{type:'noteOn',time:0,channel:0,note:60,velocity:100}]);
  assert.ok(card.render(24000).left.some(x=>Math.abs(x)>0.0001), profile);
  card.close();
}
console.log('Packed package imported and rendered real WASM in isolation');
`);
await writeFile(`${consumer}/smoke.ts`, `
import { MidiSynth, type TimedEvent } from 'defuss-midi-synth';
import { OfflineSynth, encodeWav } from 'defuss-midi-synth/offline';
const events: TimedEvent[] = [{ type: 'noteOn', time: 0, channel: 0, note: 60, velocity: 100 }];
const offline = await OfflineSynth.create({ engine: 'fm', chips: 2 }); offline.schedule(events); encodeWav(offline.render(128));
const kind: import('defuss-midi-synth').EngineKind = (await offline.useEngine('soundfont')).kind; offline.setFmBank(16); offline.close(); void kind;
const browser = await MidiSynth.create({ engine: 'fm' }); await browser.schedule(events); await browser.setFmBank(2); await browser.setPlaybackRate(1.5); await browser.dispose();
const reset: TimedEvent = { type: 'sysex', time: 0, data: Uint8Array.of(0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7) };
const hardware = await MidiSynth.create({ profile: 'gus-gf1', profileSources: { 'gus-gf1': { assets: '/private/gus.dspack' } } });
const profile: import('defuss-midi-synth').SynthProfile | undefined = (await hardware.useProfile('sb16-opl3')).profile; await hardware.send(reset); await hardware.dispose(); void profile;
`);
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',`${consumer}/smoke.ts`],{stdio:'inherit'});
execFileSync(process.execPath,[`${consumer}/smoke.mjs`],{cwd:consumer,stdio:'inherit'});
execFileSync('bun',[`${consumer}/smoke.mjs`],{cwd:consumer,stdio:'inherit'});
await writeFile('output/package-consumer.json',JSON.stringify({passed:true,archive,node:process.version,bun:execFileSync('bun',['--version'],{encoding:'utf8'}).trim(),declarations:true},null,2)+'\n');
