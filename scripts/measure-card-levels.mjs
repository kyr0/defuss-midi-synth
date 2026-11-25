// Run at the project root with Node and FFmpeg. Measure each bank's base gain using the demo's opening track.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { renderWav } from '../docs/render.js';
import { OfflineSynth } from '../docs/synth/offline.js';
import { cards, variantSources } from '../docs/sound-cards.js';

const rate = 48000, seconds = 20, frames = seconds * rate;
const { albums } = JSON.parse(await readFile('docs/music/index.json'));
const album = albums.find(a => a.id === 'warcraft-ii-tides-of-darkness-1995');
const track = album.editions[0].tracks[0];
const midi = await readFile(`docs/music/${track.file}`);
const tempo = album.tempo ?? 1;
function prepare(synth) {
  const { duration } = synth.loadMidi(midi, { tempo });
  assert.ok(duration >= seconds, 'the calibration track must cover the full measurement window');
  synth.play();
  return seconds;
}
function measure(bytes, format) {
  const { status, stderr, error } = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...format, '-i', 'pipe:0',
    '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { input: bytes, encoding: 'utf8' });
  if (error || status !== 0) throw error ?? new Error(stderr);
  const stats = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  const lufs = Number(stats.input_i), peakDbtp = Number(stats.input_tp);
  if (!Number.isFinite(lufs) || !Number.isFinite(peakDbtp)) throw new Error('Non-finite loudness or peak');
  return { lufs, peakDbtp };
}
// Use the default listening volume for the post-gain check. WAV downloads use full master volume.
const master = 0.6;
const referenceKind = 'sb16-opl3';
const report = { reference: referenceKind, sampleRate: rate, startSeconds: 0, seconds, master, file: track.file, fmBank: album.fm.bank, tempo, variants: {} };
const variants = cards.flatMap(card => card.variants);
const reference = variants.find(v => v.kind === referenceKind);
for (const variant of [reference, ...variants.filter(v => v !== reference)]) {
  const { kind, file } = variant, key = file ?? kind;
  const sources = file ? variantSources(variant, await readFile(`docs/soundcards/${file}`)) : {};
  const sound = { engine: kind, fmBank: album.fm.bank, soundfont: sources.soundfont, cardGain: 10 ** (variant.trimDb / 20),
    profileSources: sources.assets ? { [kind]: sources } : undefined };
  const synth = await OfflineSynth.create({ ...sound, sampleRate: rate });
  let raw, playback;
  try {
    prepare(synth);
    const { left, right } = synth.render(frames);
    const stereo = new Float32Array(2 * frames);
    for (let i = 0; i < frames; i++) { stereo[i * 2] = left[i]; stereo[i * 2 + 1] = right[i]; }
    const bytes = Buffer.from(stereo.buffer), format = ['-f', 'f32le', '-ar', String(rate), '-ac', '2'];
    raw = measure(bytes, format);
    const gain = master * sound.cardGain;
    for (let i = 0; i < stereo.length; i++) stereo[i] *= gain;
    playback = measure(bytes, format);
  } finally { synth.close(); }
  const wav = Buffer.from(await (await renderWav(key, sound, prepare, () => {})).arrayBuffer());
  assert.equal(wav.length, 44 + 4 * frames);
  const exported = measure(wav, ['-f', 'wav']);
  const target = report.variants[referenceKind]?.playback.lufs ?? playback.lufs;
  report.variants[key] = { raw, trimDb: variant.trimDb, playback, exported, differenceLU: Number((playback.lufs - target).toFixed(2)) };
  console.log(key, JSON.stringify(report.variants[key]));
}
await mkdir('output', { recursive: true });
await writeFile('output/card-levels.json', JSON.stringify(report, null, 2) + '\n');
