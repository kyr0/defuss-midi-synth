// WAV downloads: renders MIDI offline with the page's instruments, a second of audio per step, so the page repaints its
// progress bar between steps; then hands the file to the browser.
import { OfflineSynth, encodeWav } from './synth/offline.js';

import { createFx, hasEffects } from './fx.js';

const RATE = 48000;

/**
 * Renders with sound ({ engine, fmBank, soundfont, bank, profileSources }: the engine, its embedded FM bank, the SoundFont,
 * a WOPL file's bytes, the user's pack of a hardware profile) on a new OfflineSynth. prepare(offline) loads or schedules what to play and returns the seconds to render.
 * onProgress hears the synthesizer's downloads and decompression, then { phase: 'render', url: name, loaded, total } in
 * frames. Resolves with a 48 kHz, 16-bit stereo WAV.
 */
export async function renderWav(name, sound, prepare, onProgress, queueCapacity = 8192) {
  const offline = await OfflineSynth.create({ sampleRate: RATE, baseUrl: new URL('./synth/', import.meta.url), engine: sound.engine,
    fmBank: sound.fmBank, soundfont: sound.soundfont, profileSources: sound.profileSources, readWasm: sound.readWasm, onProgress, queueCapacity: Math.min(1048576, Math.max(64, queueCapacity)) });
  try {
    if (sound.bank) await offline.loadFmBank(sound.bank);
    const frames = Math.ceil(await prepare(offline) * RATE);
    let context, source;
    if (hasEffects(sound.fx)) {
      const tail = (sound.fx.mix ? sound.fx.decay : 0) + (sound.fx.compressor ? .006 : 0);
      context = new OfflineAudioContext(2, frames + Math.ceil(tail * RATE), RATE);
      source = context.createBufferSource();
      source.buffer = context.createBuffer(2, frames, RATE);
      const fx = await createFx(context, sound.fx);
      fx.input.gain.value = sound.cardGain ?? 1;
      source.connect(fx.input);
      fx.output.connect(context.destination);
    }
    let left = source?.buffer.getChannelData(0) ?? new Float32Array(frames);
    let right = source?.buffer.getChannelData(1) ?? new Float32Array(frames);
    for (let at = 0; at < frames; at += RATE) {
      const n = Math.min(RATE, frames - at);
      offline.renderInto(left.subarray(at, at + n), right.subarray(at, at + n));
      onProgress({ phase: 'render', url: name, loaded: at + n, total: frames });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (source) {
      source.start();
      const processed = await context.startRendering();
      left = processed.getChannelData(0);
      right = processed.getChannelData(1);
    } else if (sound.cardGain !== undefined && sound.cardGain !== 1) {
      for (let i = 0; i < left.length; i++) { left[i] *= sound.cardGain; right[i] *= sound.cardGain; }
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
