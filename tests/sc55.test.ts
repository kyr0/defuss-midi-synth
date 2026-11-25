/** The built SoundCarcass SC-55 / SC-55mkII reactors without Roland ROMs: imports, ABI, and init's pack checks.
 * Images here are zero-filled or CRC-forged stand-ins of the listed sizes, never ROM content; playback with the real
 * ROMs is scripts/profile-sc55-test.mjs. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {NativeProfileVoices, instantiateProfile, PROFILE_ABI} from '../src/profile-voices.ts';
import {PROFILE_DESCRIPTORS} from '../src/profiles.ts';
import {dspack} from './vintage-fixtures.ts';

type Model = 'roland-sc55' | 'roland-sc55mk2';
interface Exports { memory: WebAssembly.Memory; _initialize?(): void; profile_abi(): number; profile_model(): number;
  profile_buffer(n: number): number; profile_init(n: number): number; profile_init_error(): number; profile_close(): void }
interface RomFile { role: number; size: number; sha1: string | null; sha256: string | null }
const ABI_EXPORTS = ['memory', 'profile_abi', 'profile_model', 'profile_buffer', 'profile_init', 'profile_rate', 'profile_message',
  'profile_sysex_buffer', 'profile_sysex', 'profile_render', 'profile_voices', 'profile_close'];
/* profile_init_error codes, native/profiles/roland_sc.c */
const PACK = 1, ROLE = 2, SIZE = 3, HASH = 4;
/* Size and CRC32 of each image, as SoundCarcass's ROM finder (src/host/roms.c@6adfa172) and MAME's drivers list them. */
const IMAGES: Record<Model, {chips: [number, number, number][]; joined: [number, number, number]}> = {
  'roland-sc55': {chips: [[1, 0x8000, 0x4ed0d171], [2, 0x40000, 0x2dc58549], [16, 0x100000, 0x1ac774d3], [17, 0x100000, 0x8dcc592a], [18, 0x100000, 0xe21ebc04]], joined: [3, 0x300000, 0x067aa3e4]},
  'roland-sc55mk2': {chips: [[1, 0x8000, 0x9b66631f], [2, 0x80000, 0xfcee1e8e], [16, 0x200000, 0x1519d3b3], [17, 0x100000, 0x0f826c7f]], joined: [3, 0x300000, 0x91b58f99]},
};
const models = Object.keys(IMAGES) as Model[];
const id = (m: Model) => PROFILE_DESCRIPTORS[m].id;
const moduleFor = (m: Model) => new WebAssembly.Module(readFileSync(new URL(`../vendor/runtime/profiles/${m}.wasm`, import.meta.url)));
const romTable = (m: Model) => JSON.parse(readFileSync(new URL(`../scripts/roms/${m}.json`, import.meta.url), 'utf8')) as {profile: string; sets: {name: string; files: RomFile[]}[]};

const TABLE = Array.from({length: 256}, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const REVERSE = new Uint8Array(256); TABLE.forEach((v, k) => { REVERSE[v >>> 24] = k; });
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** Zeros of `size` bytes whose last four bytes make the CRC-32 `target`: CRC-32's table has a distinct top byte per
 * index, so the four indices follow from the target backwards and the bytes from the running state forwards. */
function forged(size: number, target: number): Uint8Array {
  const b = new Uint8Array(size);
  let s = 0xffffffff; for (let i = 0; i < size - 4; i++) s = TABLE[(s ^ b[i]!) & 0xff]! ^ (s >>> 8);
  let c = (target ^ 0xffffffff) >>> 0; const k: number[] = [];
  for (let i = 0; i < 4; i++) { const j = REVERSE[c >>> 24]!; k.unshift(j); c = (((c ^ TABLE[j]!) >>> 0) << 8) >>> 0; }
  for (let i = 0; i < 4; i++) { b[size - 4 + i] = (k[i]! ^ s) & 0xff; s = (TABLE[k[i]!]! ^ (s >>> 8)) >>> 0; }
  assert.equal(crc32(b), target);
  return b;
}
/** profile_init's result and failure code for one pack, on a fresh instance. */
function init(m: Model, pack: Uint8Array): {ok: number; error: number} {
  const w = instantiateProfile(moduleFor(m)).exports as unknown as Exports;
  w._initialize?.();
  try {
    const at = w.profile_buffer(pack.length) >>> 0;
    assert(at);
    new Uint8Array(w.memory.buffer, at, pack.length).set(pack);
    return {ok: w.profile_init(pack.length), error: w.profile_init_error()};
  } finally { w.profile_close(); }
}
const zeros = (records: [number, number, number][]) => records.map(([role, size]) => [role, new Uint8Array(size)] as [number, Uint8Array]);

test('CRC-32 forging reproduces the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(forged(64, 0x4ed0d171)), 0x4ed0d171);
});
for (const m of models) {
  test(`${m}: no imports, ABI 2 exports, model id`, () => {
    const module = moduleFor(m);
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const names = WebAssembly.Module.exports(module).map(x => x.name);
    for (const name of ABI_EXPORTS) assert(names.includes(name), name);
    const w = instantiateProfile(module).exports as unknown as Exports;
    w._initialize?.();
    assert.equal(w.profile_abi(), PROFILE_ABI);
    assert.equal(w.profile_model(), id(m));
  });
  test(`${m}: the host rejects an empty or truncated pack`, () => {
    assert.throws(() => new NativeProfileVoices(m, instantiateProfile(moduleFor(m)), new Uint8Array(0), 48000), /initialization failed/);
    const pack = dspack(id(m), zeros(IMAGES[m].chips));
    assert.throws(() => new NativeProfileVoices(m, instantiateProfile(moduleFor(m)), pack.subarray(0, pack.length - 1), 48000), /initialization failed/);
  });
  test(`${m}: init rejects another model's pack`, () => {
    const other = models.find(x => x !== m)!;
    assert.deepEqual(init(m, dspack(id(other), zeros(IMAGES[m].chips))), {ok: 0, error: PACK});
  });
  test(`${m}: init rejects missing, short and long images`, () => {
    const set = IMAGES[m].chips;
    for (let i = 0; i < set.length; i++) {
      assert.deepEqual(init(m, dspack(id(m), zeros(set.filter((_, j) => j !== i)))), {ok: 0, error: SIZE}, `without role ${set[i]![0]}`);
      for (const delta of [-1, 1]) {
        const records = zeros(set.map(([r, s, c], j) => [r, j === i ? s + delta : s, c]));
        assert.deepEqual(init(m, dspack(id(m), records)), {ok: 0, error: SIZE}, `role ${set[i]![0]} ${delta}`);
      }
    }
    const [role, size] = IMAGES[m].joined;
    assert.deepEqual(init(m, dspack(id(m), [...zeros(set.slice(0, 2)), [role, new Uint8Array(size - 1)]])), {ok: 0, error: SIZE});
  });
  test(`${m}: init rejects images of the right size and another CRC32`, () => {
    const set = IMAGES[m].chips;
    assert.deepEqual(init(m, dspack(id(m), zeros(set))), {ok: 0, error: HASH});
    // each image alone wrong, the others matching, so the check is per image
    for (let i = 0; i < set.length; i++) {
      const records = set.map(([r, s, c], j) => [r, j === i ? new Uint8Array(s) : forged(s, c)] as [number, Uint8Array]);
      assert.deepEqual(init(m, dspack(id(m), records)), {ok: 0, error: HASH}, `role ${set[i]![0]}`);
    }
    const [role, size] = IMAGES[m].joined;
    assert.deepEqual(init(m, dspack(id(m), [...set.slice(0, 2).map(([r, s, c]) => [r, forged(s, c)] as [number, Uint8Array]), [role, new Uint8Array(size)]])), {ok: 0, error: HASH});
  });
  test(`${m}: init rejects roles outside the set, and chips beside the descrambled set`, () => {
    const set = IMAGES[m].chips, [role, size] = IMAGES[m].joined;
    assert.deepEqual(init(m, dspack(id(m), [...zeros(set), [32, new Uint8Array(4)]])), {ok: 0, error: ROLE});
    // the first wave chip role past the model's chips (SC-55 three, SC-55mkII two)
    assert.deepEqual(init(m, dspack(id(m), [...zeros(set), [16 + set.length - 2, new Uint8Array(4)]])), {ok: 0, error: ROLE});
    assert.deepEqual(init(m, dspack(id(m), [...zeros(set), [role, new Uint8Array(size)]])), {ok: 0, error: ROLE});
  });
  test(`${m}: the ROM table lists the roles and sizes the core takes`, () => {
    const table = romTable(m);
    assert.equal(table.profile, m);
    assert(table.sets.length > 0);
    for (const set of table.sets) {
      for (const f of set.files) assert(f.sha1 || f.sha256, `${set.name} role ${f.role} has no hash`);
      const records = set.files.map(f => [f.role, new Uint8Array(f.size)] as [number, Uint8Array]);
      // zero content of exactly the listed sizes gets past every size check and fails on the hash
      assert.deepEqual(init(m, dspack(id(m), records)), {ok: 0, error: HASH}, set.name);
    }
  });
  test(`${m}: images with the listed sizes and CRC32s pass every image check`, () => {
    for (const records of [IMAGES[m].chips, [...IMAGES[m].chips.slice(0, 2), IMAGES[m].joined]]) {
      const {error} = init(m, dspack(id(m), records.map(([r, s, c]) => [r, forged(s, c)] as [number, Uint8Array])));
      // past the pack, role, size and hash checks: what remains is the zero-filled firmware's boot (0 or 6)
      assert(![PACK, ROLE, SIZE, HASH].includes(error), `error ${error}`);
    }
  });
}
