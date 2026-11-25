import { readdir, readFile } from 'node:fs/promises';
/** The known ROM revisions by profile (scripts/roms/*.json): set names and each file's name, role, size, SHA-1 and
 *  SHA-256, no ROM data. The demo page identifies the user's ROM files by them (docs/profile-files.js). */
export async function romTable(dir = 'scripts/roms') {
  const roms = {};
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
    const table = JSON.parse(await readFile(`${dir}/${file}`, 'utf8'));
    roms[table.profile] = { sets: table.sets.map(s => ({ name: s.name, files: s.files.map(({ name, role, size, sha1, sha256 }) => ({ name, role, size, sha1: sha1 ?? null, sha256: sha256 ?? null })) })) };
  }
  return roms;
}
