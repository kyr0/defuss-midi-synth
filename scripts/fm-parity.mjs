// Renders game MIDI files of docs/music through two builds of fm-synth.wasm and fails at the first sample where they
// differ. scripts/rebuild-wasm.sh compares the shipped module (block renderer) with a build of the per-sample chip
// (-DDEFUSS_OPL3_PER_SAMPLE): the block renderer must change the speed, not the sound.
// Usage: node --experimental-transform-types scripts/fm-parity.mjs candidate.wasm reference.wasm [--full]
import { readFile, readdir } from 'node:fs/promises';
import { parseSong } from '../src/midifile.ts';

const [candidatePath, referencePath] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const full = process.argv.includes('--full');
const music = new URL('../docs/music/', import.meta.url);
// Albums whose banks cover the drivers and features of the FM engine: DMX, HMI, AIL and Apogee banks, 2- and
// 4-operator voices, rhythm-mode percussion.
const cases = [['Doom (1993)', 16], ['Descent - Anniversary Edition (1996)', 2], ['Warcraft II - Tides of Darkness (1995)', 18],
  ['Blood (1997)', 69], ['Wolfenstein 3D (1992)', 74], ['Theme Park (1994)', 9], ['Hexen - Beyond Heretic (1995)', 15],
  ['Z (1996)', 42], ['Duke Nukem 3D - Duke- Nuclear Winter (1997)', 62], ['Albion (1995) 2', 0], ['Zorro (1995)', 17],
  ['Age of Empires (1997)', 58]];

async function load(path) {
  const { instance } = await WebAssembly.instantiate(await readFile(path), { env: { emscripten_notify_memory_growth: () => undefined } });
  instance.exports._initialize?.();
  return instance.exports;
}
/** Interleaved stereo of seconds of song, its messages dispatched at their frames between render calls. */
function render(w, song, chips, bank, seconds) {
  if (!w.fm_init(48000, chips, bank)) throw new Error(`fm_init rejected ${chips} chips, bank ${bank}`);
  const frames = Array.from(song.times, t => Math.round(t * 48000));
  const total = Math.round(seconds * 48000), out = new Float32Array(total * 2), base = w.fm_render(0);
  let position = 0, index = 0;
  while (position < total) {
    while (index < song.messages.length && frames[index] <= position) {
      const m = song.messages[index++];
      w.fm_message(m & 0xff, m >>> 8 & 0xff, m >>> 16 & 0xff);
    }
    const n = Math.min(128, total - position, (index < song.messages.length ? frames[index] : total) - position);
    w.fm_render(n);
    const view = new Float32Array(w.memory.buffer, base, 256);
    for (let i = 0; i < n; i++) { out[2 * (position + i)] = view[i]; out[2 * (position + i) + 1] = view[n + i]; }
    position += n;
  }
  return out;
}

const candidate = await load(candidatePath), reference = await load(referencePath);
let frames = 0, sounding = 0;
for (const [album, bank] of full ? cases : cases.slice(0, 6)) {
  const files = (await readdir(new URL(`${album}/`, music))).filter(f => /\.mid$/i.test(f)).sort().slice(0, full ? 2 : 1);
  for (const file of files) {
    const song = parseSong(new Uint8Array(await readFile(new URL(`${album}/${file}`, music))));
    for (const chips of full ? [1, 2, 4] : [1, 4]) {
      const a = render(candidate, song, chips, bank, full ? 25 : 12), b = render(reference, song, chips, bank, full ? 25 : 12);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) throw new Error(`${album}/${file}, bank ${bank}, ${chips} chips: frame ${i >> 1} channel ${i & 1} is ${a[i]}, the per-sample chip gives ${b[i]}`);
        if (a[i] !== 0) sounding++;
      }
      frames += a.length / 2;
    }
  }
}
if (!sounding) throw new Error('Every rendered sample was silent');
console.log(`fm-parity: ${frames} frames identical (${(sounding / frames / 2 * 100).toFixed(0)}% of samples nonzero)`);
