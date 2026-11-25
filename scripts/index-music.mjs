// Indexes the albums of docs/music/<album>/ into docs/music/index.json for the demo's music player: each album's
// title, year, composers and cover from its .txt and .jpg, its MIDI files grouped into editions (the album folder
// and its version folders such as GS, MT-32 or Adlib; the "Game Rip" folders hold the games' own formats and are
// left out), each track's title from its file name and its length from src/midifile.ts, and the FM bank of
// libADLMIDI's banks.ini (docs/music/banks.ini) that the game's sound driver used.
// Usage: node --experimental-transform-types scripts/index-music.mjs   (writes covers/ thumbnails with sips on macOS)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { archiveAlbums, archiveFolder, playbackFolder } from './index-game-archive.mjs';
import { computerFolder, indexComputerMusic } from './index-computer-music.mjs';
import { parseSong } from '../src/midifile.ts';

const root = new URL('../docs/music/', import.meta.url);
const SOURCE = 'https://www.karlsitretro.com/game_midi';

/** Album folder -> FM bank (banks.ini number), how it was chosen, why, and the game name of banks.ini that the choice
 *  rests on (checked against the bank's "games" line). "game": banks.ini names the game;
 *  "family": banks.ini's bank for this game expects the game's own patch numbers (:NON-GM:), so these General MIDI
 *  conversions take the same driver's GM bank; "driver": the game's sound driver, not the game, is in banks.ini;
 *  "default": no evidence, so libADLMIDI's default bank 0 (the Miles AIL set). */
const FM = {
  'Age of Empires (1997)': [58, 'driver', 'A Windows 95 game: Windows 9x FM synthesizer driver.'],
  'Age of Empires - The Rise Of Rome (1998)': [58, 'driver', 'A Windows 95 game: Windows 9x FM synthesizer driver.'],
  AgeOfEmpires2: [58, 'driver', 'A Windows 95 game: Windows 9x FM synthesizer driver.'],
  AgeOfEmpires2Conquerors: [58, 'driver', 'A Windows 95 game: Windows 9x FM synthesizer driver.'],
  'Albion (1995) 2': [0, 'game', null, 'Albion'],
  'Alone In The Dark 2 (1993)': [0, 'default'],
  'Blood (1997)': [69, 'game', null, 'Blood'],
  'Descent - Anniversary Edition (1996)': [2, 'game', null, 'Descent'],
  'Descent 2 (1996)': [2, 'family', 'Bank 6 (HMI Descent 2, :NON-GM:) is for the game\'s own HMP files.', 'Descent'],
  'Doom (1993)': [16, 'game', null, 'Doom'],
  'Doom 2 (1994)': [14, 'game', null, 'Doom 2'],
  'Duke Nukem 3D - Duke- Nuclear Winter (1997)': [62, 'game', 'An add-on of Duke Nukem 3D.', 'Duke Nukem 3D'],
  'Dune (1992)': [0, 'default'],
  'Elder Scrolls II - Daggerfall (1996)': [0, 'default'],
  'Heroes of Might and Magic II - The Succession Wars (1996)': [0, 'default'],
  'Heretic (1994)': [15, 'game', null, 'Heretic'],
  'Hexen - Beyond Heretic (1995)': [15, 'game', null, 'Hexen'],
  'Lost Vikings (1993)': [75, 'game', null, 'The Lost Vikings'],
  'Q-Pop - Evolution im Weltraum (1993)': [0, 'default'],
  'Raptor - Call of the Shadows (1994)': [64, 'game', null, 'Raptor'],
  'Settlers II (1996)': [0, 'game', null, 'Settlers 2'],
  'SimCity 2000 (1993)': [0, 'default'],
  'Super Tetris (1991)': [0, 'default'],
  'Tetris Classic (1992)': [0, 'default'],
  'Tetris Gold (1993)': [0, 'default'],
  'Theme Park (1994)': [9, 'game', null, 'Theme Park'],
  'Tyrian (1995)': [0, 'default'],
  'WarCraft - Orcs & Humans (1994)': [18, 'family', 'Bank 43 (AIL Warcraft, :NON-GM:) is for the game\'s own XMI files.', 'Warcraft 2'],
  'Warcraft II - Tides of Darkness (1995)': [18, 'game', null, 'Warcraft 2'],
  'Wolfenstein 3D (1992)': [74, 'game', null, 'Wolfenstein'],
  'X-COM - Terror from the Deep (1995)': [0, 'default'],
  'Z (1996)': [42, 'game', null, 'Z'],
  'Zorro (1995)': [17, 'game', null, 'Zorro'],
};
/** Titles where the .txt's "Game:" line differs from the published title. */
const TITLES = {
  'Age of Empires - The Rise Of Rome': 'Age of Empires: The Rise of Rome',
  'Alone In The Dark 2': 'Alone in the Dark 2',
  'Descent 2 / Descent II': 'Descent II',
  'Duke Nukem 3D - Duke: Nuclear Winter': 'Duke: Nuclear Winter',
  'Warcraft II - Tides of Darkness': 'Warcraft II: Tides of Darkness',
};
/** Platforms where the .txt's "Platform:" line is wrong: Age of Empires and its expansion ran on Windows 95. */
const PLATFORMS = { 'Age of Empires (1997)': 'Windows', 'Age of Empires - The Rise Of Rome (1998)': 'Windows' };
/** Album folders without a .txt: their album fields here. The composers are the ones the files' own text events credit
 *  ("Copyright 1999 by Stephen Rippy", "By Stephen Rippy."; "Q - P O P by K.-L. von Wendt", "by Lars Hammer"). */
const FIELDS = {
  'Lost Vikings (1993)': { game: 'The Lost Vikings', year: 1993, platform: 'DOS', cover: 'cover.png',
    'composed by': 'Charles Deenen', 'midi versions': 'XMI conversion' },
  AgeOfEmpires2: { game: 'Age of Empires II: The Age of Kings', year: 1999, 'composed by': 'Stephen Rippy', platform: 'Windows', cover: 'AoE2.png' },
  AgeOfEmpires2Conquerors: { game: 'Age of Empires II: The Conquerors', year: 2000, 'composed by': 'Stephen Rippy', platform: 'Windows', cover: 'AoE2_Conquerors.png' },
  'Q-Pop - Evolution im Weltraum (1993)': { game: 'Q-Pop: Evolution im Weltraum', year: 1993, 'composed by': 'K.-L. von Wendt, Lars Hammer', platform: 'Windows', cover: 'qpop.jpg' },
};
/** Files left out of the index, with the reason. */
const EXCLUDE = {
  'Wolfenstein 3D (1992)/01 - Horst-Wessel-Lied.mid':
    'The Horst-Wessel-Lied is the anthem of the NSDAP; playing it publicly is an offence under section 86a of the German Criminal Code (StGB).',
};
/** Folders that hold a project rather than one album: no .txt of the album fields, several games, editions in the
 *  file names. Each album takes the files its pattern matches and its cover from the folder; the titles come from the files' own track names
 *  (episode and world from the file names, where the embedded numbers of 2-2 and 5-2 are swapped), in this order. */
const PROJECTS = {
  JazzJackrabbit: {
    notes: "MIDI arrangements of the games' tracker music by MaliceX (James A. Nguyen) with Steven Picken, Steven Blom and Goku7, Team ChaoS MIDIs, 2004 to 2005 (README.txt).",
    edition: file => file.match(/_?(GM|XG)(v\d+a?)?(_altver)?\.mid$/i)[1].toUpperCase(),
    albums: [
      { title: 'Jazz Jackrabbit', year: 1994, platform: 'DOS', cover: 'jazz.png', pattern: /^JazzJackrabbit_/, titles: {
        MainTheme: 'Main Theme', '1-1': 'Diamondus (1-1)', '1-2': 'Tubelectric (1-2)', '1-3': 'Medivo (1-3)', '2-1': 'Letni (2-1)',
        '2-2': 'Technoir (2-2)', '2-3': 'Orbitus (2-3)', '3-1': 'Fanolint (3-1)', '3-2': 'Scraparap (3-2)', '3-3': 'Megairbase (3-3)',
        '4-1': 'Turtemple (4-1)', '4-2': 'Nippius (4-2)', '4-3': 'Jungrock (4-3)', '5-1': 'Marbelara (5-1)', '5-2': 'Dreempipes (5-2)',
        '5-3': 'Sluggion (5-3)', '6-1': 'Pezrock (6-1)', '6-1 alt': 'Pezrock (6-1, first version)', '6-2': 'Chrysilis (6-2)',
        '6-3': 'Battleships (6-3)', BossGUARDIAN: 'Guardian (episode boss)', '3DBonus': '3D Bonus Stage', WorldClear: 'World Clear',
        Ending: 'Ending Theme', CDDeckstar: 'Deckstar (CD version)', CDDesertoSECRET: 'Deserto (CD version, secret level)',
        CDExoticus: 'Exoticus (CD version)', XMAS94_Level1: "Holiday Hare '94: Level One", XMAS94_Level2: "Holiday Hare '94: Level Two (Silent Night)",
        XMAS95_Level1: "Holiday Hare '95: Level One", XMAS95_Level2: "Holiday Hare '95: Level Two (Little Drummer Boy)" } },
      { title: 'Jazz Jackrabbit 2', year: 1998, platform: 'Windows', cover: 'jazz2.png', pattern: /^JazzJackrabbit2_/, titles: {
        LabRat: 'Lab Rat', Carrotus: 'Carrotus', JazzCastle: 'Jazz Castle', Boss1: 'Boss', BonusStageUnr: 'Bonus Stage (unreleased)',
        TSFHaunted: 'Haunted House (The Secret Files)' } },
    ],
  },
};
/** Spelling fixes in track titles. */
const SPELLING = { Campaing: 'Campaign' };
const EDITION_ORDER = ['GM', 'GM, GS', 'GS', 'MT-32', 'FM', 'Adlib', 'Tandy', 'Unreleased', 'Unfinished'];

const banks = parseBanks(await readFile(new URL('banks.ini', root), 'utf8'));
function parseBanks(ini) {
  const out = new Map();
  for (const m of ini.matchAll(/^\[bank-(\d+)\]([\s\S]*?)(?=^\[bank-|(?![\s\S]))/gm)) {
    const field = key => m[2].match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
    out.set(Number(m[1]), { name: field('name'), games: field('games') ?? '', file: field('file') });
  }
  return out;
}
function info(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z -]+):\s*(.*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}
const slug = text => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** "01 - At Doom's Gate (E1M1).mid" -> 1, "At Doom's Gate (E1M1)"; "Q-Pop-02-Purplus.midi" -> 2, "Purplus";
 *  "Track 01.mid" -> 1, "Track 1"; "un21-f.mid" -> 21, "Unreleased 21 (F)"; an all-capital word is set in title case. */
function trackName(file, position) {
  const base = file.replace(/\.(mid|midi|rmi|mus)$/i, '');
  if (/^\d+$/.test(base)) return [position, `Track ${base}`];
  let m = base.match(/^(\d+)\s*-\s*(.+)$/);
  if (m || (m = base.match(/^[A-Za-z-]+-(\d+)-(.+)$/))) return [Number(m[1]), tidy(m[2])];
  if ((m = base.match(/^Track\s*(\d+)$/i))) return [Number(m[1]), `Track ${Number(m[1])}`];
  if ((m = base.match(/^un(\d+)(?:-(\w+))?$/i))) return [Number(m[1]), `Unreleased ${Number(m[1])}${m[2] ? ` (${m[2].toUpperCase()})` : ''}`];
  return [position, tidy(base)];
}
function tidy(title) {
  return title.split(' ').map(word => SPELLING[word] ?? (/^[A-Z][A-Z0-9]{3,}$/.test(word) ? word[0] + word.slice(1).toLowerCase() : word))
    .join(' ').replace(/^(\w)/, c => c.toUpperCase());
}
async function tracks(album, folder) {
  const dir = folder ? `${album}/${folder}` : album;
  const files = (await readdir(new URL(`${dir}/`, root))).filter(f => /\.(mid|midi|rmi|mus)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const out = [];
  for (const [i, file] of files.entries()) {
    const path = `${dir}/${file}`;
    if (EXCLUDE[path]) { console.log(`left out ${path}: ${EXCLUDE[path]}`); continue; }
    const song = parseSong(new Uint8Array(await readFile(new URL(path, root))));
    const [number, title] = file.match(/^Dune - GS - Complete/) ? [1, 'The Complete Soundtrack'] : trackName(file, i + 1);
    out.push({ number, title, file: path, duration: Math.round(song.duration * 10) / 10 });
  }
  return out;
}
// Raptor's two GLB archives identify the cue and edition in each extracted filename.
function raptorEditions(tracks) {
  const cues = new Map([
    ['APOGEE', 'Apogee Fanfare'], ['RINTRO', 'Raptor Intro'], ['MAINMENU', 'Main Menu'], ['HANGAR', 'Hangar'],
    ...Array.from({ length: 8 }, (_, i) => [`RAP${i + 1}`, `Wave Music ${i + 1}`]),
    ...Array.from({ length: 4 }, (_, i) => [`BOSS${i + 1}`, `Boss ${i + 1}`]),
  ]);
  const editions = { MUS: [], MDS: [] };
  for (const track of tracks) {
    const match = track.file.match(/__([A-Z0-9]+)_(MUS|MDS)\.mid$/i);
    if (!match || !cues.has(match[1])) throw new Error(`Unknown Raptor cue: ${track.file}`);
    editions[match[2]].push({ ...track, title: cues.get(match[1]) });
  }
  const order = [...cues.values()];
  return Object.entries(editions).map(([name, list]) => ({
    name, tracks: list.sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title))
      .map((track, i) => ({ ...track, number: i + 1 })),
  }));
}
function thumbnail(album, cover, id) {
  const out = `covers/${id}.jpg`;
  if (!existsSync(new URL(out, root)) && process.platform === 'darwin') {
    execFileSync('sips', ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', fileURLToPath(new URL(cover, root)), '--out', fileURLToPath(new URL(out, root))], { stdio: 'ignore' });
  }
  return existsSync(new URL(out, root)) ? out : cover;
}

/** The albums of a project folder (PROJECTS). */
async function projectAlbums(folder, project) {
  const files = (await readdir(new URL(`${folder}/`, root))).filter(f => /\.mid$/i.test(f));
  const out = [];
  for (const spec of project.albums) {
    const keys = Object.keys(spec.titles), editions = new Map();
    for (const file of files.filter(f => spec.pattern.test(f))) {
      const stem = file.replace(spec.pattern, '').replace(/\.mid$/i, '');
      const alt = /_altver$/i.test(stem) ? ' alt' : '';
      const key = stem.replace(/_altver$/i, '').replace(/_?(GM|XG)(v\d+a?)?$/i, '') + alt;
      const version = stem.match(/(?:GM|XG)v(\d)(\d+)(a?)$/i);
      if (!spec.titles[key]) throw new Error(`${folder}/${file}: no title for ${key}`);
      const edition = project.edition(file), song = parseSong(new Uint8Array(await readFile(new URL(`${folder}/${file}`, root))));
      if (!editions.has(edition)) editions.set(edition, []);
      editions.get(edition).push({ key, title: spec.titles[key], version: version ? `v${version[1]}.${version[2]}${version[3]}` : '', file: `${folder}/${file}`, duration: Math.round(song.duration * 10) / 10 });
    }
    const id = `${slug(spec.title)}-${spec.year}`, cover = `${folder}/${spec.cover}`;
    out.push({
      id, title: spec.title, year: spec.year, composers: [], platform: spec.platform, notes: project.notes, cover, thumbnail: thumbnail(folder, cover, id),
      fm: { bank: 0, name: banks.get(0).name, file: banks.get(0).file, match: 'default', note: 'The games played tracker modules, not MIDI: no driver bank applies.' },
      editions: [...editions].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => {
        list.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key) || a.version.localeCompare(b.version));
        // Two versions of one song in one edition keep both, named by version.
        const twice = new Set(list.filter((t, i) => list.findIndex(u => u.key === t.key) !== i).map(t => t.key));
        return { name, tracks: list.map((t, i) => ({ number: i + 1, title: twice.has(t.key) ? `${t.title} (${t.version})` : t.title, file: t.file, duration: t.duration })) };
      }),
    });
  }
  return out;
}

await mkdir(new URL('covers/', root), { recursive: true });
const albums = [];
const isDir = async path => (await stat(new URL(path, root))).isDirectory();
for (const album of (await readdir(root)).sort((a, b) => a.localeCompare(b, 'en'))) {
  if (!(await isDir(album)) || ['covers', computerFolder, archiveFolder, playbackFolder].includes(album)) continue;
  if (PROJECTS[album]) { albums.push(...await projectAlbums(album, PROJECTS[album])); continue; }
  const names = await readdir(new URL(`${album}/`, root));
  const fields = FIELDS[album], txt = names.find(n => n.endsWith('.txt'));
  const jpg = fields?.cover ?? names.find(n => /\.jpe?g$/i.test(n));
  if (!(txt || fields) || !FM[album]) throw new Error(`${album}: needs a .txt or an entry in FIELDS, and an entry in FM`);
  const meta = fields ?? info(await readFile(new URL(`${album}/${txt}`, root), 'utf8'));
  const versions = (meta['midi versions'] ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const folders = [];
  for (const n of names) if (!/game rip/i.test(n) && await isDir(`${album}/${n}`)) folders.push(n);
  // The album folder holds the versions its .txt names that have no folder of their own.
  const rootLabel = versions.filter(v => !folders.includes(v)).join(', ') || 'GM';
  const editions = [];
  const main = await tracks(album, '');
  if (album === 'Raptor - Call of the Shadows (1994)') editions.push(...raptorEditions(main));
  else if (main.length) editions.push({ name: rootLabel, tracks: main });
  for (const folder of folders) {
    const list = await tracks(album, folder);
    if (list.length) editions.push({ name: folder, tracks: list });
  }
  const rank = name => { const i = EDITION_ORDER.indexOf(name); return i < 0 ? EDITION_ORDER.length : i; };
  editions.sort((a, b) => rank(a.name) - rank(b.name));
  const year = fields?.year ?? Number(album.match(/\((\d{4})\)/)[1]);
  const title = TITLES[meta.game] ?? meta.game;
  const id = `${slug(title)}-${year}`;
  const [bank, match, note, game] = FM[album];
  const entry = banks.get(bank);
  if (!entry) throw new Error(`${album}: banks.ini has no bank ${bank}`);
  if (game && !entry.games.split(/[;,]/).map(g => g.trim()).includes(game)) throw new Error(`${album}: banks.ini bank ${bank} does not list ${game}`);
  albums.push({
    id, title, year,
    composers: (meta['composed by'] ?? '').split(',').map(c => c.trim()).filter(c => c && c !== 'Unknown'),
    platform: PLATFORMS[album] ?? meta.platform ?? 'DOS',
    ...(meta['additional info'] ? { notes: meta['additional info'] } : {}),
    cover: jpg ? `${album}/${jpg}` : null,
    thumbnail: jpg ? thumbnail(album, `${album}/${jpg}`, id) : null,
    fm: { bank, name: entry.name, file: entry.file, match, ...(note ? { note } : {}) },
    editions,
  });
}
/** The albums the human put first (2026-11-24; Warcraft II moved to the front the same day; on 2026-11-25 Q-Pop after
 *  The Settlers II, Jazz Jackrabbit before Raptor and Duke before Tyrian), in this order; the rest follow by title. */
const FIRST = ['warcraft-ii-tides-of-darkness-1995', 'age-of-empires-ii-the-age-of-kings-1999', 'age-of-empires-ii-the-conquerors-2000',
  'jazz-jackrabbit-2-1998', 'the-settlers-ii-1996', 'q-pop-evolution-im-weltraum-1993', 'z-1996', 'jazz-jackrabbit-1994',
  'raptor-call-of-the-shadows-1994', 'duke-nuclear-winter-1997', 'tyrian-1995', 'doom-2-1994', 'wolfenstein-3d-1992', 'descent-ii-1996'];
/** Albums with a profile of their own (the human's choice of 2026-11-25: Sound Blaster 16 with one OPL3); the player
 *  switches to an album's profile when one of its tracks starts, and albums without one play on the page's default. */
const ENGINE = { 'jazz-jackrabbit-1994': 'sb16-opl3', 'jazz-jackrabbit-2-1998': 'sb16-opl3', 'the-settlers-ii-1996': 'sb16-opl3' };
for (const [id, engine] of Object.entries(ENGINE)) {
  const album = albums.find(a => a.id === id);
  if (!album) throw new Error(`ENGINE names ${id}, which is not indexed`);
  album.engine = engine;
}
const rank = album => { const at = FIRST.indexOf(album.id); return at < 0 ? FIRST.length : at; };
for (const id of FIRST) if (!albums.some(a => a.id === id)) throw new Error(`FIRST names ${id}, which is not indexed`);
albums.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en'));
const bank = banks.get(0);
albums.push(...await archiveAlbums(fileURLToPath(root), albums, { bank: 0, name: bank.name, file: bank.file, match: 'default' }));
const count = albums.reduce((n, a) => n + a.editions.reduce((m, e) => m + e.tracks.length, 0), 0);
await writeFile(new URL('index.json', root), JSON.stringify({ format: 1, source: SOURCE, albums }, null, 2) + '\n');
console.log(`index.json: ${albums.length} albums, ${count} tracks`);
await indexComputerMusic(fileURLToPath(root));
