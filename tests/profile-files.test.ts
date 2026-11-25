// docs/profile-files.js: the devices the ROMs section finds in dropped files. Its packs must equal what
// scripts/profile-assets.py writes for the same files (run here for real). Its ROM matching is checked on tables of
// synthetic files in the shape of docs/roms.json, since no ROM is in this repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript module of the demo page, without declarations
import { dspack, devicesIn, readFiles, MAX_FILE_BYTES } from '../docs/profile-files.js';
// @ts-expect-error: a plain JavaScript module of the build, without declarations
import { romTable } from '../scripts/rom-table.mjs';
import { MAX_PROFILE_ASSET_BYTES } from '../src/profile-voices.ts';
import { PROFILE_DESCRIPTORS } from '../src/profiles.ts';
import { ecwFixture, gusFixture } from './vintage-fixtures.ts';

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
/** A table entry as docs/roms.json holds the real ones: SHA-1 only. */
const rom = (name: string, role: number, data: Uint8Array) => ({ name, role, size: data.length, sha1: createHash('sha1').update(data).digest('hex'), sha256: null });
const table = (tables: Record<string, { name: string; files: unknown[] }[]>) => async () => Object.fromEntries(Object.entries(tables).map(([k, sets]) => [k, { sets }]));
const never = async () => { throw new Error('the ROM table was loaded'); };
const devices = (files: { name: string; bytes: Uint8Array }[], known: () => Promise<unknown> = never, catalog = {}) => devicesIn(files, PROFILE_DESCRIPTORS, known, catalog);
const wasm = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
/** What scripts/profile-assets.py pack writes for files saved under their names. */
function pack(profile: string, files: Record<string, Uint8Array>, roles: Record<string, number>) {
  const dir = mkdtempSync(join(tmpdir(), 'profile-files-'));
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    execFileSync('python3', [new URL('../scripts/profile-assets.py', import.meta.url).pathname, 'pack', profile, join(dir, 'out.dspack'),
      ...Object.entries(roles).map(([name, role]) => `${role}=${join(dir, name)}`)]);
    return new Uint8Array(readFileSync(join(dir, 'out.dspack')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('loose Roland ROM files become a device per complete set, packed as scripts/profile-assets.py packs them', async () => {
  const control = bytes(65536, 1), other = bytes(65536, 9), pcm = bytes(524288, 2);
  const sc = [bytes(32768, 3), bytes(262144, 4), bytes(65536, 5), bytes(65536, 6), bytes(65536, 7)], scRoles = [1, 2, 16, 17, 18];
  const known = table({
    'roland-mt32': [{ name: 'MT-32 control 1.04 + PCM', files: [rom('C', 1, control), rom('P', 2, pcm)] }, { name: 'MT-32 control 1.07 + PCM', files: [rom('C', 1, other), rom('P', 2, pcm)] }],
    'roland-sc55': [{ name: 'SC-55 v1.21', files: sc.map((d, i) => rom(`ic${i}`, scRoles[i]!, d)) }],
  });
  // Both MT-32 control ROMs with the one PCM they share, the SC-55 set in reverse, a PCM copy and a stranger.
  const { devices: found, ignored } = await devices([{ name: 'pcm.bin', bytes: pcm }, { name: 'a.rom', bytes: control }, { name: 'b.rom', bytes: other },
    ...[...sc].reverse().map((d, i) => ({ name: `sc${i}`, bytes: d })), { name: 'pcm copy.bin', bytes: pcm.slice() }, { name: 'notes.txt', bytes: bytes(10, 1) }], known);
  assert.deepEqual(found.map((d: { name: string }) => d.name), ['Roland MT-32 · MT-32 control 1.04 + PCM', 'Roland MT-32 · MT-32 control 1.07 + PCM', 'Roland SC-55 · SC-55 v1.21']);
  assert.deepEqual(found[0].sources, { assets: pack('roland-mt32', { c: control, p: pcm }, { c: 1, p: 2 }) });
  assert.deepEqual(found[2].sources, { assets: pack('roland-sc55', Object.fromEntries(sc.map((d, i) => [`r${i}`, d])), Object.fromEntries(scRoles.map((r, i) => [`r${i}`, r]))) });
  assert.deepEqual(ignored, ['notes.txt'], 'a copy of a used ROM is no stranger');
});

test('an entry with both hashes needs both to match, as scripts/fetch-roms.py does', async () => {
  const a = bytes(1024, 1), b = bytes(2048, 2), both = (d: Uint8Array, wrong = false) => ({ ...rom('x', 1, d), sha256: wrong ? '0'.repeat(64) : createHash('sha256').update(d).digest('hex') });
  const known = (wrong: boolean) => table({ 'roland-mt32': [{ name: 's', files: [both(a, wrong), { ...both(b), role: 2 }] }] });
  assert.equal((await devices([{ name: 'a', bytes: a }, { name: 'b', bytes: b }], known(false))).devices.length, 1);
  assert.deepEqual((await devices([{ name: 'a', bytes: a }, { name: 'b', bytes: b }], known(true))).ignored, ['a', 'b']);
});

test('packs by their model, a Roland pack by its revision; the same bytes once; an ECW waveset by its name', async () => {
  const control = bytes(65536, 1), pcm = bytes(524288, 2), mt32 = dspack(9, [[1, control], [2, pcm]]), gus = new Uint8Array(gusFixture()), ecw = new Uint8Array(ecwFixture());
  const known = table({ 'roland-mt32': [{ name: 'MT-32 control 1.07 + PCM', files: [rom('C', 1, control), rom('P', 2, pcm)] }] });
  const { devices: found, ignored } = await devices([{ name: 'roland-mt32.dspack', bytes: mt32 }, { name: 'roland-mt32--copy.dspack', bytes: mt32.slice() },
    { name: 'gus-gf1-1024k.dspack', bytes: gus }, { name: 'EAPCI2M.ECW', bytes: ecw }, { name: 'bad.dspack', bytes: dspack(99, [[1, control]]) }], known);
  assert.deepEqual(found.map((d: { name: string }) => d.name), ['Gravis UltraSound (GF1) · 1024k', 'Roland MT-32 · MT-32 control 1.07 + PCM', 'Sound Blaster PCI 128 · Defuss synthetic fixture']);
  assert.deepEqual(found[0].sources, { assets: gus }); assert.deepEqual(found[1].sources, { assets: mt32 });
  assert.deepEqual(found[2].sources, { assets: pack('sb-pci128', { e: ecw }, { e: 32 }) }, 'the waveset packed as role 32');
  assert.deepEqual(ignored, ['bad.dspack'], 'a pack of no known model');
  // Without Roland files the ROM table is not needed.
  assert.equal((await devices([{ name: 'g.dspack', bytes: gus }])).devices.length, 1);
});

test('packs.json names a file it lists "<manufacturer> <model> (<year>)", preferred among packs of the same bytes', async () => {
  const gus = new Uint8Array(gusFixture()), catalog = { 'GUS-GF1-1024K.DSPACK': { manufacturer: 'Advanced Gravis', year: '1992', model: 'UltraSound, 1024 KiB' } };
  const { devices: found } = await devices([{ name: 'x.dspack', bytes: gus }, { name: 'gus-gf1-1024k.dspack', bytes: gus.slice() }], never, catalog);
  assert.deepEqual(found.map((d: { name: string }) => d.name), ['Advanced Gravis UltraSound, 1024 KiB (1992)']);
  assert.equal((await devices([{ name: 'g.dspack', bytes: gus }], never, { 'g.dspack': { manufacturer: '', year: '', model: '' } })).devices[0].name, 'Gravis UltraSound (GF1) · g', 'an empty entry names nothing');
  // An entry with a SHA-256 names only a file with those bytes: a default pack rewritten with another revision is named
  // by what it holds.
  const sha256 = createHash('sha256').update(gus).digest('hex'), entry = { manufacturer: 'Advanced Gravis', year: '1992', model: 'UltraSound, 1024 KiB' };
  assert.equal((await devices([{ name: 'g.dspack', bytes: gus }], never, { 'g.dspack': { ...entry, sha256 } })).devices[0].name, 'Advanced Gravis UltraSound, 1024 KiB (1992)');
  assert.equal((await devices([{ name: 'g.dspack', bytes: gus }], never, { 'g.dspack': { ...entry, sha256: '0'.repeat(64) } })).devices[0].name, 'Gravis UltraSound (GF1) · g');
  const ecw = new Uint8Array(ecwFixture()), ecwHash = createHash('sha256').update(ecw).digest('hex');
  assert.equal((await devices([{ name: 'E.ECW', bytes: ecw }], never, { 'e.ecw': { manufacturer: 'Creative', year: '1998', model: 'PCI 128, test', sha256: ecwHash } })).devices[0].name, 'Creative PCI 128, test (1998)', 'an ECW waveset by the hash of its own file');
});

test('devices.json names the others by maker, model, variant and year, and the list runs newest first', async () => {
  const profiles = JSON.parse(readFileSync(new URL('../docs/devices.json', import.meta.url), 'utf8'));
  const control = bytes(65536, 1), pcm = bytes(524288, 2);
  const known = table({ 'roland-mt32': [{ name: 'MT-32 control 1.07 + PCM', files: [rom('C', 1, control), rom('P', 2, pcm)] }] });
  const { devices: found } = await devicesIn([{ name: 'a.rom', bytes: control }, { name: 'b.rom', bytes: pcm }, { name: 'mine.dspack', bytes: new Uint8Array(gusFixture()) },
    { name: 'x.ECW', bytes: new Uint8Array(ecwFixture()) }, { name: 'awe64-bank.dspack', bytes: dspack(4, [[32, bytes(64, 1)]]) }], PROFILE_DESCRIPTORS, known, {}, profiles);
  assert.deepEqual(found.map((d: { name: string }) => d.name), ['Creative Sound Blaster PCI 128, Defuss synthetic fixture (1998)', 'Creative Sound Blaster AWE64, bank (1996)',
    'Advanced Gravis UltraSound, mine (1992)', 'Roland MT-32, control 1.07 + PCM (1987)']);
});

test('an AWE pack plays with the .wasm named after its card; without one it needs it', async () => {
  const awe = dspack(3, [[32, bytes(64, 1)]]);
  const without = (await devices([{ name: 'awe32-bank.dspack', bytes: awe }])).devices[0];
  assert.equal(without.needs, 'awe32.wasm'); assert.equal(without.sources.wasm, undefined);
  const { devices: found, ignored } = await devices([{ name: 'awe32-bank.dspack', bytes: awe }, { name: 'awe32.wasm', bytes: wasm }, { name: 'other.wasm', bytes: wasm }]);
  assert.deepEqual(found[0].sources, { assets: awe, wasm }); assert.equal(found[0].needs, undefined);
  assert.deepEqual(ignored, ['other.wasm']);
  assert.deepEqual((await devices([{ name: 'awe64.wasm', bytes: wasm }])).modules, { awe64: wasm }, 'a module alone, for packs dropped before it');
});

test('readFiles refuses a file larger than any pack before reading it', async () => {
  assert.equal(MAX_FILE_BYTES, MAX_PROFILE_ASSET_BYTES);
  const chunk = new Uint8Array(1 << 20);
  await assert.rejects(readFiles([new File(Array.from({ length: 129 }, () => chunk), 'big.bin')]), /big\.bin is larger than any pack a core takes \(128 MiB\)/);
  assert.deepEqual(await readFiles([new File([wasm], 'm.wasm')]), [{ name: 'm.wasm', bytes: wasm }]);
});

test('docs/roms.json is the table of scripts/roms/, with a hash for every file', async () => {
  const page = JSON.parse(readFileSync(new URL('../docs/roms.json', import.meta.url), 'utf8'));
  assert.deepEqual(page, await romTable(new URL('../scripts/roms', import.meta.url).pathname));
  for (const { sets } of Object.values(page) as { sets: { files: { sha1: string | null; sha256: string | null }[] }[] }[])
    for (const set of sets) for (const file of set.files) assert.ok(file.sha1 || file.sha256);
});
