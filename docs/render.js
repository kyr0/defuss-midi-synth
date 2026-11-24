// WAV downloads: renders MIDI offline with the page's instruments, a second of audio per step, so the page repaints its
// progress bar between steps; then hands the file to the browser.
import { OfflineSynth, encodeWav } from './synth/offline.js';

const RATE = 48000;

/**
 * Renders with sound ({ engine, fmBank, soundfont, bank }: the engine, its embedded FM bank, the SoundFont, a WOPL file's
 * bytes) on a new OfflineSynth. prepare(offline) loads or schedules what to play and returns the seconds to render.
 * onProgress hears the synthesizer's downloads and decompression, then { phase: 'render', url: name, loaded, total } in
 * frames. Resolves with a 48 kHz, 16-bit stereo WAV.
 */
export async function renderWav(name, sound, prepare, onProgress, queueCapacity = 8192) {
  const offline = await OfflineSynth.create({ sampleRate: RATE, baseUrl: new URL('./synth/', import.meta.url), engine: sound.engine,
    fmBank: sound.fmBank, soundfont: sound.soundfont, onProgress, queueCapacity: Math.min(1048576, Math.max(64, queueCapacity)) });
  try {
    if (sound.bank) await offline.loadFmBank(sound.bank);
    const frames = Math.ceil(await prepare(offline) * RATE), left = new Float32Array(frames), right = new Float32Array(frames);
    for (let at = 0; at < frames; at += RATE) {
      const n = Math.min(RATE, frames - at);
      offline.renderInto(left.subarray(at, at + n), right.subarray(at, at + n));
      onProgress({ phase: 'render', url: name, loaded: at + n, total: frames });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return new Blob([encodeWav({ sampleRate: RATE, left, right })], { type: 'audio/wav' });
  } finally { offline.close(); }
}

/** Offers blob to the user as a download named name. */
export function save(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
