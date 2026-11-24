/* docs/music/index.json against the files it indexes and banks.ini: the human asked for every MIDI of the albums with
 * a title, the album's cover and title, and the FM bank of banks.ini for each game (2026-11-23). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { parseSong } from '../src/midifile.ts';

const root = new URL('../docs/music/', import.meta.url);
interface Track { number: number; title: string; file: string; duration: number }
interface Album { id: string; tempo?: number; title: string; year: number; cover: string; thumbnail: string; fm: { bank: number; name: string; match: string }; editions: { name: string; tracks: Track[] }[] }
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8')) as { format: number; albums: Album[] };
const tracks = index.albums.flatMap(a => a.editions.flatMap(e => e.tracks));

test('every MIDI file of the album folders is indexed once, except the excluded one', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(new URL(dir, root))) {
      const path = `${dir}${name}`;
      if (statSync(new URL(path, root)).isDirectory()) { if (!/game rip/i.test(name) && name !== 'covers') walk(`${path}/`); }
      else if (dir && /\.(mid|midi|rmi|mus)$/i.test(name)) files.push(path);
    }
  };
  walk('');
  const indexed = tracks.map(t => t.file).sort();
  assert.equal(new Set(indexed).size, indexed.length);
  assert.deepEqual(files.filter(f => !indexed.includes(f)), ['Wolfenstein 3D (1992)/01 - Horst-Wessel-Lied.mid']);
  assert.equal(indexed.length, 943); assert.equal(index.albums.length, 33);
  // The human's order of 2026-11-24 first, then the rest by title.
  assert.deepEqual(index.albums.slice(0, 11).map(a => a.title), ['Warcraft II: Tides of Darkness', 'Age of Empires II: The Age of Kings', 'Age of Empires II: The Conquerors',
    'Jazz Jackrabbit 2', 'The Settlers II', 'Z', 'Raptor: Call of the Shadows', 'Tyrian', 'Doom 2', 'Wolfenstein 3D', 'Descent II']);
  const rest = index.albums.slice(11).map(a => a.title);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'en')));
});
test('tracks carry titles and their files\' lengths; albums their covers', () => {
  for (const album of index.albums) for (const track of album.editions.flatMap(e => e.tracks)) {
    assert.ok(track.title.trim() && !/\.(mid|rmi|mus)$/i.test(track.title), track.file);
    const song = parseSong(new Uint8Array(readFileSync(new URL(track.file, root))));
    assert.equal(track.duration, Math.round(song.duration / (album.tempo ?? 1) * 10) / 10, track.file);
  }
  // Raptor's files carry Doom's 140 Hz MUS clock; its driver ran at 70 Hz (the human, 2026-11-24).
  assert.deepEqual(index.albums.filter(a => a.tempo).map(a => [a.id, a.tempo]), [['raptor-call-of-the-shadows-1994', 0.5]]);
  for (const album of index.albums) {
    assert.ok(album.title && album.year >= 1990 && album.year <= 2000, album.id);
    for (const image of [album.cover, album.thumbnail]) assert.ok(existsSync(new URL(image, root)), `${album.id}: ${image}`);
    assert.ok(album.editions.length >= 1 && album.editions.every(e => e.tracks.length > 0), album.id);
  }
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
