import { OfflineSynth } from '../dist/offline.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
// Load time of the bundled SoundFont, then rendering throughput for 8, 32 and 128 sustained voices.
const loads = [];
for (let run = 0; run < 5; run++) { const start = performance.now(); (await OfflineSynth.create()).close(); loads.push(performance.now() - start); }
loads.sort((a, b) => a - b);
const programs = [0, 48, 19, 52, 73, 40, 56, 89, 4, 24, 32, 68, 11, 61, 81, 95];
const results = [];
for (const notes of [8, 32, 128]) {
  const synth = await OfflineSynth.create();
  const events = [];
  for (let i = 0; i < notes; i++) {
    const channel = i % 16;
    if (i < 16) events.push({ type: 'programChange', time: 0, channel, program: programs[channel] });
    events.push({ type: 'noteOn', time: 0, channel, note: 36 + (i * 7) % 60, velocity: 100 });
  }
  synth.schedule(events);
  const left = new Float32Array(128), right = new Float32Array(128);
  for (let i = 0; i < 500; i++) synth.renderInto(left, right);
  const voices = synth.engine.voices(), times = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now(); for (let i = 0; i < 3750; i++) synth.renderInto(left, right);
    times.push(performance.now() - start);
  }
  synth.close(); times.sort((a, b) => a - b);
  results.push({ notes, voices, secondsOfAudio: 10, medianMs: times[2], realtimeFactor: 10000 / times[2], meanQuantumMicroseconds: times[2] * 1000 / 3750, runsMs: times });
}
// The FM engine plays Doom's E1M1 with its own bank (DMX, bank 16) on 1 and 4 chips: 30 s of the file in 128-frame
// calls, five warmed runs. With tmp/fm-per-sample.wasm (scripts/rebuild-wasm.sh builds it) the same workload also runs
// on the per-sample chip, which the block renderer replaced.
const song = await readFile(new URL("../docs/music/Doom (1993)/02 - At Doom's Gate (E1M1).mid", import.meta.url));
const fm = [];
for (const chips of [1, 4]) {
  const synth = await OfflineSynth.create({ engine: 'fm', chips, fmBank: 16 });
  const left = new Float32Array(128), right = new Float32Array(128), times = [];
  for (let run = 0; run < 6; run++) {
    synth.engine.loadMidi(song); synth.engine.play(false);
    const start = performance.now(); for (let i = 0; i < 11250; i++) synth.renderInto(left, right);
    if (run) times.push(performance.now() - start);
  }
  synth.close(); times.sort((a, b) => a - b);
  fm.push({ chips, secondsOfAudio: 30, medianMs: times[2], realtimeFactor: 30000 / times[2], meanQuantumMicroseconds: times[2] * 1000 / 11250, runsMs: times });
}
const perSample = new URL('../tmp/fm-per-sample.wasm', import.meta.url);
if (existsSync(perSample)) {
  const { parseSong } = await import('../src/midifile.ts').catch(() => ({}));
  if (parseSong) {
    const parsed = parseSong(new Uint8Array(song)), modules = { block: new URL('../vendor/runtime/fm-synth.wasm', import.meta.url), perSample };
    for (const entry of fm) {
      for (const [name, file] of Object.entries(modules)) {
        const { instance } = await WebAssembly.instantiate(await readFile(file), { env: { emscripten_notify_memory_growth: () => undefined } });
        const w = instance.exports; w._initialize?.();
        const frames = Array.from(parsed.times, t => Math.round(t * 48000)), times = [];
        for (let run = 0; run < 6; run++) {
          w.fm_init(48000, entry.chips, 16);
          let index = 0; const start = performance.now();
          for (let position = 0; position < 1440000; position += 128) {
            while (index < parsed.messages.length && frames[index] < position + 128) { const m = parsed.messages[index++]; w.fm_message(m & 0xff, m >>> 8 & 0xff, m >>> 16 & 0xff); }
            w.fm_render(128);
          }
          if (run) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        entry[`${name}ModuleQuantumMicroseconds`] = times[2] * 1000 / 11250;
      }
    }
  }
}
await mkdir('output', { recursive: true });
const result = { runtime: process.version, cpu: cpus()[0]?.model, soundfontLoadMedianMs: loads[2], workload: 'sustained notes on 16 channels with TimGM6mb, 48 kHz, 128-frame calls, five warmed runs of 10 s each', results,
  fmWorkload: "Doom's At Doom's Gate (E1M1) on the FM engine, bank 16, 48 kHz, 128-frame calls, five warmed runs of 30 s each; *ModuleQuantumMicroseconds: the module alone, messages at 128-frame granularity", fm,
  limits: 'Node WASM throughput, not a browser deadline or worst-case latency measurement.' };
await writeFile('output/benchmark.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
