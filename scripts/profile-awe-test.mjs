/** Gated AWE32/AWE64 check on assets you supply (never downloaded): packs them with scripts/profile-assets.py pack-awe,
 * which verifies the ROM against scripts/roms/<model>.json, then drives the local AWE32Emu build through the host ABI
 * and measures it. Run: node --experimental-transform-types scripts/profile-awe-test.mjs --rom awe32.raw --bank SYNTHGM.SBK
 * (--no-rom plays a bank whose samples go to DRAM, e.g. vendor/soundfonts/TimGM6mb.sf2 with --ram 8192).
 * Fails loudly when the build or an asset is missing. Writes output/profile-awe-<model>.json. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { instantiateProfile } from '../src/profile-voices.ts';

const { values: o } = parseArgs({ options: {
  model: { type: 'string', default: 'awe32' }, rom: { type: 'string' }, 'no-rom': { type: 'boolean', default: false },
  bank: { type: 'string' }, 'user-bank': { type: 'string' }, driver: { type: 'string', default: 'win95' }, ram: { type: 'string' },
  'rom-only': { type: 'boolean', default: false }, 'unverified-rom': { type: 'boolean', default: false }, blocks: { type: 'string', default: '4000' },
} });
const fail = (message) => { console.error(`profile-awe-test: ${message}`); process.exit(1); };
if (!['awe32', 'awe64'].includes(o.model)) fail('--model must be awe32 or awe64');
if (!o.bank) fail('--bank FILE is required (SYNTHGM.SBK, 1MGM.SF2, SBAWE32.MDI or a RAM SoundFont)');
if (!o.rom && !o['no-rom']) fail('--rom FILE is required (the EMU8000 wave ROM you own); pass --no-rom only for a bank whose samples go to DRAM');
for (const file of [o.rom, o.bank, o['user-bank']]) if (file && !existsSync(file)) fail(`missing asset ${file}`);
const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = join(root, 'profile-assets/local-builds', `${o.model}.wasm`);
if (!existsSync(wasm)) fail(`missing ${wasm}: run python3 scripts/build-native-profiles.py --local-awe awe32 awe64`);

const tmp = mkdtempSync(join(tmpdir(), 'defuss-awe-'));
try {
  const packPath = join(tmp, `${o.model}.dspack`);
  execFileSync('python3', [join(root, 'scripts/profile-assets.py'), 'pack-awe', o.model, o.bank, packPath, '--driver', o.driver,
    ...(o.rom ? ['--rom', o.rom] : []), ...(o.ram ? ['--ram', o.ram] : []), ...(o['rom-only'] ? ['--rom-only'] : []),
    ...(o['unverified-rom'] ? ['--unverified-rom'] : []), ...(o['user-bank'] ? ['--user-bank', o['user-bank']] : [])], { stdio: 'inherit' });
  const pack = readFileSync(packPath), bytes = readFileSync(wasm), module = new WebAssembly.Module(bytes);
  const open = () => {
    const e = instantiateProfile(module).exports; e._initialize?.();
    const at = e.profile_buffer(pack.length) >>> 0; assert(at, 'profile_buffer');
    new Uint8Array(e.memory.buffer, at, pack.length).set(pack);
    const t = performance.now(), ok = e.profile_init(pack.length), ms = performance.now() - t;
    assert.equal(ok, 1, 'profile_init rejected the pack'); return { e, ms };
  };
  const block = (e) => { const p = e.profile_render(128) >>> 0; assert(p); return new Float32Array(e.memory.buffer, p, 256); };
  const energy = (e, blocks) => { let s = 0; for (let i = 0; i < blocks; i++) for (const x of block(e)) { assert(Number.isFinite(x) && Math.abs(x) <= 1); s += x * x; } return s; };
  const inits = [];
  for (let i = 0; i < 5; i++) { const { e, ms } = open(); inits.push(ms); e.profile_close(); }
  const { e } = open();
  try {
    assert.equal(e.profile_abi(), 2); assert.equal(e.profile_model(), o.model === 'awe32' ? 3 : 4); assert.equal(e.profile_rate(), 44100);
    // Every GM program on channel 1 and the drum kit on channel 10, each after all sound off.
    const silent = [];
    for (let program = 0; program < 128; program++) {
      e.profile_message(0xb0, 120, 0); energy(e, 10); e.profile_message(0xc0, program, 0); e.profile_message(0x90, 60, 110);
      if (energy(e, 40) < 1e-4) silent.push(program);
      e.profile_message(0x80, 60, 0);
    }
    e.profile_message(0xb9, 120, 0); energy(e, 10); for (const n of [36, 38, 42]) e.profile_message(0x99, n, 110);
    const drums = energy(e, 40);
    assert.equal(e.profile_message(0xff, 0, 0), 1); assert.equal(energy(e, 20), 0, 'reset leaves sound');
    // Load: 16 held notes on 8 channels plus drums, then render time per 128-frame block.
    for (let i = 0; i < 16; i++) { const ch = i % 8; e.profile_message(0xc0 | ch, ch * 8, 0); e.profile_message(0x90 | ch, 48 + i * 2, 100); }
    const times = [], blocks = Number(o.blocks);
    for (let i = 0; i < blocks; i++) {
      if (i % 50 === 0) e.profile_message(0x99, 36 + (i / 50 % 8), 100);
      const t = performance.now(); block(e); times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b); inits.sort((a, b) => a - b);
    const result = { model: o.model, driver: o.driver, rom: o.rom ? createHash('sha1').update(readFileSync(o.rom)).digest('hex') : null,
      bank: createHash('sha256').update(readFileSync(o.bank)).digest('hex'), wasmBytes: bytes.length, wasmSha256: createHash('sha256').update(bytes).digest('hex'),
      initMsMedian: +inits[2].toFixed(2), renderMsPer128: { median: +times[times.length >> 1].toFixed(4), p99: +times[Math.floor(times.length * 0.99)].toFixed(4), blocks },
      voicesUnderLoad: e.profile_voices(), memoryBytes: e.memory.buffer.byteLength, programsAudible: 128 - silent.length, silentPrograms: silent, drumEnergy: drums };
    mkdirSync(join(root, 'output'), { recursive: true });
    writeFileSync(join(root, 'output', `profile-awe-${o.model}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    assert(drums > 1e-4, 'drums on channel 10 are silent');
    assert.deepEqual(silent, [], 'silent GM programs');
  } finally { e.profile_close(); }
} finally { rmSync(tmp, { recursive: true, force: true }); }
