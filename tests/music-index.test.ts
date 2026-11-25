/* docs/music/index.json against the files it indexes and banks.ini: the human asked for every MIDI of the albums with
 * a title, the album's cover and title, and the FM bank of banks.ini for each game (2026-11-23). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSong } from '../src/midifile.ts';

const root = new URL('../docs/music/', import.meta.url);
interface Track { number: number; title: string; file: string; duration: number }
interface Album { id: string; source?: string; tempo?: number; engine?: string; title: string; year?: number; cover: string | null; thumbnail: string | null; fm: { bank: number; name: string; match: string }; editions: { name: string; tracks: Track[] }[] }
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8')) as { format: number; albums: Album[] };
const originalAlbums = index.albums.filter(a => !a.source);
const tracks = originalAlbums.flatMap(a => a.editions.flatMap(e => e.tracks));

test('every MIDI file of the album folders is indexed once, except the excluded one', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(new URL(dir, root))) {
      const path = `${dir}${name}`;
      if (statSync(new URL(path, root)).isDirectory()) { if (!/game rip/i.test(name) && !['covers', 'new_game_music', 'archive-playback', 'non-game-music-opl-waffle-net'].includes(name)) walk(`${path}/`); }
      else if (dir && /\.(mid|midi|rmi|mus)$/i.test(name)) files.push(path);
    }
  };
  walk('');
  const indexed = tracks.map(t => t.file).sort();
  assert.equal(new Set(indexed).size, indexed.length);
  assert.deepEqual(files.filter(f => !indexed.includes(f)), ['Wolfenstein 3D (1992)/01 - Horst-Wessel-Lied.mid']);
  assert.equal(indexed.length, 1016); assert.equal(originalAlbums.length, 35);
  // The human's order of 2026-11-24 and 2026-11-25 first, then the rest by title.
  assert.deepEqual(index.albums.slice(0, 14).map(a => a.title), ['Warcraft II: Tides of Darkness', 'Age of Empires II: The Age of Kings', 'Age of Empires II: The Conquerors',
    'Jazz Jackrabbit 2', 'The Settlers II', 'Q-Pop: Evolution im Weltraum', 'Z', 'Jazz Jackrabbit', 'Raptor: Call of the Shadows',
    'Duke: Nuclear Winter', 'Tyrian', 'Doom 2', 'Wolfenstein 3D', 'Descent II']);
  const rest = originalAlbums.slice(14).map(a => a.title);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'en')));
});
test('tracks carry titles and their files\' lengths; albums their covers', () => {
  for (const album of index.albums) for (const track of album.editions.flatMap(e => e.tracks)) {
    assert.ok(track.title.trim() && !/\.(mid|rmi|mus)$/i.test(track.title), track.file);
    const song = parseSong(new Uint8Array(readFileSync(join(fileURLToPath(root), track.file))));
    assert.equal(track.duration, Math.round(song.duration / (album.tempo ?? 1) * 10) / 10, track.file);
  }
  const raptor = index.albums.find(a => a.id === 'raptor-call-of-the-shadows-1994')!;
  assert.equal(raptor.tempo ?? 1, 1);
  assert.deepEqual(raptor.editions.map(e => [e.name, e.tracks.length]), [['MUS', 16], ['MDS', 15]]);
  for (const album of index.albums) {
    assert.ok(album.title, album.id);
    if (!album.source) assert.ok(album.year && album.year >= 1990 && album.year <= 2000 && album.cover && album.thumbnail, album.id);
    for (const image of [album.cover, album.thumbnail]) if (image) assert.ok(existsSync(new URL(image, root)), `${album.id}: ${image}`);
    assert.ok(album.editions.length >= 1 && album.editions.every(e => e.tracks.length > 0), album.id);
  }
});
test('each archive folder gets a separate album after the original crates, in natural title order', () => {
  const folders = readdirSync(new URL('new_game_music/', root), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const archive = index.albums.slice(originalAlbums.length);
  assert.deepEqual(archive.map(a => a.title), folders);
  assert.ok(archive.every(a => a.source && a.id.startsWith('archive-')));
  assert.equal(new Set(index.albums.map(a => a.id)).size, index.albums.length);
  const files = archive.flatMap(a => a.editions.flatMap(e => e.tracks.map(t => t.file)));
  assert.equal(new Set(files).size, 6475);
  assert.equal(files.length, 6475);
  assert.ok(files.some(f => f.startsWith('archive-playback/') && /\.zip\//i.test(f)));
});

test('each album names the FM bank of banks.ini by its number', () => {
  const ini = readFileSync(new URL('banks.ini', root), 'utf8');
  const names = new Map([...ini.matchAll(/^\[bank-(\d+)\][^[]*?^name\s*=\s*"([^"]*)"/gms)].map(m => [Number(m[1]), m[2]]));
  for (const album of index.albums) {
    assert.equal(album.fm.name, names.get(album.fm.bank), album.id);
    assert.ok(['game', 'family', 'driver', 'default'].includes(album.fm.match), album.id);
  }
  const bank = (id: string) => index.albums.find(a => a.id === id)!.fm.bank;
  // banks.ini's games lines: Doom (16), Doom 2 (14), Wolfenstein (74), Warcraft 2 (18), Descent (2).
  assert.deepEqual([bank('doom-1993'), bank('doom-2-1994'), bank('wolfenstein-3d-1992'), bank('warcraft-ii-tides-of-darkness-1995'), bank('descent-anniversary-edition-1996')], [16, 14, 74, 18, 2]);
});
test('the albums the human chose name their profile', () => {
  // The human's choice of 2026-11-25: Jazz Jackrabbit, Jazz Jackrabbit 2 and The Settlers II play on the Sound Blaster 16 (OPL3).
  assert.deepEqual(index.albums.filter(a => a.engine).map(a => [a.id, a.engine]).sort(),
    [['jazz-jackrabbit-1994', 'sb16-opl3'], ['jazz-jackrabbit-2-1998', 'sb16-opl3'], ['the-settlers-ii-1996', 'sb16-opl3']]);
});

test('the computer music crate indexes every VGZ once by its artist folder', () => {
  const { albums } = JSON.parse(readFileSync(new URL('computer-music.json', root), 'utf8')) as { albums: Album[] };
  const folder = 'non-game-music-opl-waffle-net';
  const artists = readdirSync(new URL(folder + '/', root), { withFileTypes: true }).filter(f => f.isDirectory());
  assert.deepEqual(albums.map(a => a.title).sort(), artists.map(f => f.name).sort());
  for (const album of albums) {
    const dir = folder + '/' + album.title + '/';
    const files = readdirSync(new URL(encodeURI(dir), root)).filter(f => /\.vgz$/i.test(f));
    const tracks = album.editions.flatMap(e => e.tracks);
    assert.deepEqual(tracks.map(t => t.file).sort(), files.map(f => dir + f).sort());
    assert.ok(tracks.every(t => t.title && t.duration > 0));
  }
});
