// OPL Waffle organizes recordings by artist. GD3 tags describe the individual recordings.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const computerFolder = 'non-game-music-opl-waffle-net';
export async function indexComputerMusic(root) {
  const path = join(root, computerFolder);
  const folders = await readdir(path, { withFileTypes: true });
  const albums = [];
  const compare = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  for (const title of folders.filter(f => f.isDirectory()).map(f => f.name).sort(compare)) {
    const tracks = [];
    for (const file of (await readdir(join(path, title))).filter(f => /\.vgz$/i.test(f)).sort(compare)) {
      const bytes = gunzipSync(await readFile(join(path, title, file)));
      if (bytes.toString('ascii', 0, 4) !== 'Vgm ') throw new Error(`Invalid VGM: ${title}/${file}`);
      const tag = bytes.readUInt32LE(20) + 20;
      const fields = bytes.toString('ascii', tag, tag + 4) === 'Gd3 '
        ? bytes.toString('utf16le', tag + 12, tag + 12 + bytes.readUInt32LE(tag + 8)).split('\0') : [];
      tracks.push({ number: tracks.length + 1, title: fields[0] || file.slice(0, -4), artist: fields[6] || title,
        year: fields[8]?.match(/\b(?:19|20)\d\d\b/)?.[0] || '', file: `${computerFolder}/${title}/${file}`,
        duration: bytes.readUInt32LE(24) / 44100 });
    }
    if (tracks.length) albums.push({ id: `opl-${title}`, title, computer: true, platform: 'OPL', composers: [title],
      editions: [{ name: 'VGZ', tracks }] });
  }
  await writeFile(join(root, 'computer-music.json'), JSON.stringify({ albums }) + '\n');
  console.log(`Computer music: ${albums.length} artists, ${albums.reduce((n, a) => n + a.editions[0].tracks.length, 0)} recordings`);
}
