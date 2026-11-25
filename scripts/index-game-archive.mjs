// Each archived game has info.txt, optional song notes and edition subfolders.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parseSong } from '../src/midifile.ts';

export const archiveFolder = 'new_game_music';
export const playbackFolder = 'archive-playback';
const compare = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const clean = name => name.replace(/\.mid$/i, '').replaceAll('_', ' ').trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function notes(path) {
  const bytes = await readFile(path);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
function field(text, key) {
  return text.match(new RegExp('^' + key + ':[ \\t]*([^\\r\\n]*)', 'im'))?.[1].trim() || '';
}

// These XMI conversions store an initial tempo track followed by independently timed sequences.
// Pair each sequence with its conductor in a format-1 file the player and WAV exporter can both read.
function sequences(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'MThd' || bytes.readUInt16BE(8) !== 2) return [bytes];
  const header = Buffer.from(bytes.subarray(0, 8 + bytes.readUInt32BE(4)));
  const chunks = [];
  for (let at = header.length; at < bytes.length;) {
    if (bytes.toString('ascii', at, at + 4) !== 'MTrk') throw new Error('Missing MIDI track');
    const end = at + 8 + bytes.readUInt32BE(at + 4);
    if (end > bytes.length) throw new Error('Incomplete MIDI track');
    chunks.push(bytes.subarray(at, end)); at = end;
  }
  const conductor = chunks.shift();
  if (conductor?.length !== 19 || !conductor.subarray(8, 12).equals(Buffer.from([0, 255, 81, 3])) ||
      !conductor.subarray(15).equals(Buffer.from([0, 255, 47, 0])) || !chunks.length) throw new Error('Unrecognized format-2 conductor');
  header.writeUInt16BE(1, 8); header.writeUInt16BE(2, 10);
  return chunks.map(track => Buffer.concat([header, conductor, track]));
}

// Some rips encode a negative one-tick setup delay as the maximum four-byte MIDI delta.
// Wing Commander 2 has a similarly misplaced final time-signature marker in its conductor.
function correctArchiveDelay(folder, file, bytes) {
  let before, after;
  if (['Civilization', 'Lemmings 2 (PC Game rip)'].includes(folder) && bytes.readUInt16BE(8) === 0) {
    before = 'ffffff7ff0'; after = '00f0';
  } else if (folder === 'Wing Commander 2' && file === 'wc2-32.mid') {
    before = '8bd5fb0fff58040402180800ff2f00'; after = '00ff58040402180800ff2f00';
  } else return bytes;
  const chunk = 8 + bytes.readUInt32BE(4), start = chunk + 8, end = start + bytes.readUInt32BE(chunk + 4);
  const data = bytes.subarray(start, end), needle = Buffer.from(before, 'hex');
  if (!data.includes(needle)) return bytes;
  const fixed = Buffer.from(data.toString('latin1').replaceAll(needle.toString('latin1'), Buffer.from(after, 'hex').toString('latin1')), 'latin1');
  const header = Buffer.from(bytes.subarray(0, start));
  header.writeUInt32BE(fixed.length, chunk + 4);
  return Buffer.concat([header, fixed, bytes.subarray(end)]);
}

export async function archiveAlbums(root, catalog, defaultFm) {
  const source = join(root, archiveFolder);
  const albums = [];
  const folders = (await readdir(source, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort(compare);
  for (const folder of folders) {
    const dir = join(source, folder);
    const files = (await readdir(dir, { recursive: true })).sort(compare);
    const byName = new Map(files.map(f => [f.toLowerCase(), f]));
    const meta = await notes(join(dir, byName.get('info.txt')));
    const year = field(meta, 'Year').match(/^\d{4}/)?.[0];
    const platform = field(meta, 'Platform');
    const composers = field(meta, 'Original Composer').split(/,\s*/).filter(Boolean);
    const existing = catalog.find(a => a.title.toLowerCase() === folder.toLowerCase() && a.year === Number(year) &&
      /^PC/i.test(platform) && ['DOS', 'Windows'].includes(a.platform));
    const editions = new Map(), looseHashes = new Set();
    async function add(file, bytes, edition, zipped = false) {
      const sidecar = byName.get(file.replace(/\.mid$/i, '.txt').toLowerCase());
      const title = (sidecar && field(await notes(join(dir, sidecar)), 'Song Title')) || clean(basename(file));
      const parts = sequences(correctArchiveDelay(folder, file, bytes));
      for (const [i, part] of parts.entries()) {
        let song;
        try { song = parseSong(part); }
        catch (error) {
          console.warn(`Skipping ${folder}/${file}: ${error.message}`); continue;
        }
        if (song.duration === 0) { console.warn(`Skipping ${folder}/${file}: zero duration`); continue; }
        let path = `${archiveFolder}/${folder}/${file}`;
        const suffix = parts.length > 1 ? ` (part ${i + 1})` : '';
        if (part !== bytes || zipped) {
          path = `${playbackFolder}/${folder}/${file.slice(0, -4)}${suffix}.mid`;
          await mkdir(dirname(join(root, path)), { recursive: true });
          await writeFile(join(root, path), part);
        }
        if (!editions.has(edition)) editions.set(edition, []);
        const tracks = editions.get(edition);
        // Git publishes precomposed filenames even when macOS returns decomposed directory entries.
        tracks.push({ number: tracks.length + 1, title: (title + suffix).normalize('NFC'), file: path.normalize('NFC'), duration: Math.round(song.duration * 10) / 10 });
      }
    }
    for (const file of files.filter(f => /\.mid$/i.test(f))) {
      const bytes = await readFile(join(dir, file));
      looseHashes.add(hash(bytes));
      await add(file, bytes, dirname(file) === '.' ? field(meta, 'Type') || 'MIDI' : dirname(file));
    }
    for (const zip of files.filter(f => extname(f).toLowerCase() === '.zip')) {
      const path = join(dir, zip);
      const members = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split(/\r?\n/);
      for (const member of members.filter(f => /\.mid$/i.test(f))) {
        if (member !== basename(member) || /[\\*?[\]]/.test(member)) throw new Error(`Unexpected ZIP member: ${member}`);
        const bytes = execFileSync('unzip', ['-p', path, member], { maxBuffer: 16 * 1024 * 1024 });
        if (!looseHashes.has(hash(bytes))) await add(`${zip}/${member}`, bytes, 'Archived MIDI', true);
      }
    }
    if (!editions.size) throw new Error(`No playable music in ${folder}`);
    albums.push({ id: `archive-${folder}`, title: folder, ...(year ? { year: Number(year) } : {}), platform, composers,
      source: field(meta, 'Archiver') || 'Game MIDI archive', cover: existing?.cover ?? null, thumbnail: existing?.thumbnail ?? null, fm: existing?.fm ?? defaultFm,
      editions: [...editions].map(([name, tracks]) => ({ name, tracks })) });
  }
  return albums;
}
