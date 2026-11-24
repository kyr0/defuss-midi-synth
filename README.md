# defuss-midi-synth

A General MIDI synthesizer for the browser and for offline rendering, with two engines in standalone WebAssembly modules:

- **SoundFont** (default): TinySoundFont 0.9 plays SoundFont 2 files. The package bundles TimGM6mb, a General MIDI SoundFont with all 128 General MIDI programs and 8 drum kits (6.0 MB, shipped Brotli-compressed as 5.2 MB).
- **FM**: libADLMIDI 1.6.2 drives emulated Yamaha OPL3 chips (Nuked OPL3), the sound of AdLib and Sound Blaster cards. It embeds 79 instrument banks taken from DOS and Windows games and drivers, and loads WOPL bank files.

Copyright of SoundFonts and music belongs to thier creators.

A song switches engines while it plays and keeps its position. Browser synthesis runs in an AudioWorklet. Node.js, Bun and browser offline rendering use the same engines and the same event scheduler.

## Run the demo

The release includes the compiled WASM, the built package and a self-contained demo in `docs/`. Serve `docs/` over HTTP on localhost or over HTTPS. A page opened through `file:` cannot load the worklet.

```sh
make setup
make dev
```

Open http://127.0.0.1:8080. The page is a DOS screen over Matrix rain, in pixel fonts. It names its engines after the sound cards whose music it plays: "Gravis Ultrasound" is the FM engine and "SoundBlaster 16" the SoundFont engine. It starts on the FM engine with the Bergium visualizer (its Butterchurn pipeline), which rotates every 30 s through 14 presets (`demo/bergium-presets.json`); its SoundFont engine plays Zandro Reveille's OPL-3 FM 128M SoundFont (`docs/sf2_sb16/`, CC BY-SA 4.0), 135 MB, loaded as its 104 MB Brotli file when chosen. The page has a music player for the game soundtracks in `docs/music/` (see below), with an engine switch, skip, speed and volume controls, a shader that follows the sound, and the visualizer, which draws every sound the synthesizer plays. Every track has a WAV button: the page renders the file offline on the engine and bank shown and offers it as a download. On the FM engine a list of the 79 banks replaces the bank's name; each album starts on its game's bank, and a bank picked from the list holds for that album. An album's list holds the tracks of all its editions, each row naming its own. The page opens on Age of Empires II; the album grid starts with the order the author chose, then the rest by title. A bar at the bottom of the window shows downloads above 1 MB, their decompression and WAV rendering. Below the player are piano keys, bank and preset selectors, SF2 and WOPL loading and a demo sequence. A Web MIDI keyboard plays the synthesizer and lights the keys it plays; the scope shows the keys' sound, not the player's. Everything played on the keys or a Web MIDI keyboard is recorded, and "Download your synthesized MIDI." renders the recording as a WAV file. A MIDI, RMI or MUS file of your own plays in the player. Files are processed locally.

`docs/music/` holds 31 game soundtracks as General MIDI files, with covers, from https://www.karlsitretro.com/game_midi (Age of Empires II and The Conquerors without an info file: their fields stand in `scripts/index-music.mjs`, the composer as the files' own text events credit him), and MaliceX's MIDI arrangements of the Jazz Jackrabbit games (2004 to 2005), indexed as two albums with their covers, GM and XG editions and titles from the files' own track names. `node --experimental-transform-types scripts/index-music.mjs` writes `docs/music/index.json`: each album's title, year, composers, cover and editions (GM, GS, MT-32, AdLib and others), each track's title and length, the FM bank of `docs/music/banks.ini` that the game's sound driver used, and a tempo for albums whose files state a wrong clock: Raptor's MIDI files carry the 140 Hz clock of Doom's MUS driver, while Raptor's ran at 70 Hz, so the player loads them at tempo 0.5. The rights to this music stay with its composers and publishers; it is part of the demo site, not of the npm package. The index leaves out Wolfenstein 3D's `Horst-Wessel-Lied.mid`, the NSDAP anthem, whose public performance section 86a of the German Criminal Code forbids.

`make setup` runs `mise install` when mise is available, installs the locked Bun dependencies and installs Chromium for the tests. `mise.toml` pins Bun 1.4.3 and Node 24.22.1. Python 3 and Make run the service and verification helpers. Normal use does not need Emscripten.

A SoundFont or WOPL file may come Brotli-compressed: bytes that do not start with the format's signature (`RIFF`, `WOPL3-BANK`) are decompressed with defuss-brotli's decoder, which the package bundles and loads only then (`assets/brotli-decompressor.wasm`, 185 KB). `bun run compress` writes `FILE.br` beside every soundbank in `vendor/soundfonts/` and `docs/` at quality 11.

## Browser API

Install the package tarball with `bun add ./defuss-midi-synth-0.3.0.tgz` (`make pack` writes it to `output/`).

```ts
import { MidiSynth } from 'defuss-midi-synth';

// Run in a click handler. Copy the package's entire dist/ to /synth/.
const context = new AudioContext({ latencyHint: 'interactive' });
await context.resume();
const synth = await MidiSynth.create({ context, baseUrl: new URL('/synth/', location.href) });
const time = context.currentTime + 0.05;
await synth.schedule([
  { time, type: 'programChange', channel: 0, program: 0 },
  { time, type: 'noteOn', channel: 0, note: 60, velocity: 100 },
  { time: time + 0.5, type: 'noteOff', channel: 0, note: 60 },
  { time, type: 'noteOn', channel: 9, note: 36, velocity: 110 },
]);
```

For an unbundled browser import of `dist/index.js`, assets resolve beside the module automatically. Bundlers can move that module, so copy the complete `dist/` directory to a static location and set `baseUrl` to that directory, including its trailing slash. Keep the generated shared JS chunks, `worklet.js` and `assets/` together. Serve `.wasm` as `application/wasm`. The package needs neither SharedArrayBuffer nor cross-origin isolation headers.

`MidiSynth.create` fetches the module of the starting engine (and, for the SoundFont engine, the SoundFont), compiles it and then constructs the worklet. The `onProgress` option hears each download and decompression of the files the synthesizer loads, as `{ phase: 'download' | 'decompress', url, loaded, total }` (`total` 0 while a server sends no length). In a browser downloads report step by step through XMLHttpRequest, and the Brotli decoder reports every 4 MB of input and yields to the event loop between steps, so a page repaints its bar. Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `engine` | `'soundfont'` | The engine that plays first: `'soundfont'` or `'fm'`. `useEngine` loads the other one on demand. |
| `soundfont` | `assets/TimGM6mb.sf2.br` | Other SF2 bytes or a URL relative to `baseUrl`, plain or Brotli-compressed. |
| `maxVoices` | 256 | SoundFont voices to preallocate, up to 4096. |
| `chips` | 2 | Emulated OPL3 chips of the FM engine, 1 to 8; each sounds 18 two-operator voices. |
| `fmBank` | 0 | The FM engine's embedded bank, 0 to 78, numbered as libADLMIDI's `banks.ini` (`docs/music/banks.ini`). |

For the SoundFont engine, `maxVoices` limits the voices. Beyond that limit, a new note takes over the voice furthest into its release, and a note that finds no releasing voice stays silent. Every channel starts in its General MIDI state: program 1, channel volume 100, and the drum kit on channel 10.

| API | Behavior |
| --- | --- |
| `info` | The active engine's name and `kind`, the loaded `engines`, sample rate, voice limit and the presets as `{ bank, program, name }`: bank 0 holds the General MIDI programs, bank 128 the drum kits. Once the FM engine is loaded, `info.fm` holds its bank names, its bank (-1 for a loaded WOPL file) and its chips. |
| `useEngine(kind)` | Make `'soundfont'` or `'fm'` play, fetching and compiling it the first time. A loaded file keeps its position: its programs and controllers up to there are replayed into the new engine and its held notes struck again. Scheduled events are cleared. |
| `setFmBank(bank)` | Select an embedded FM bank (0 to 78); a playing file plays on with the new instruments. |
| `loadFmBank(source)` | Replace the FM instruments with a WOPL bank file (bytes or a URL, plain or Brotli-compressed); a rejected file keeps the bank. |
| `setPlaybackRate(rate)` | Play the loaded file at 0.25 to 4 times its tempo, at the same pitch. |
| `noteOn`, `noteOff`, `programChange`, `controlChange`, `pitchBend` | Send a validated event; the optional last argument is absolute AudioContext time. |
| `selectPreset(channel, bank, program)` | Select any preset of `info.presets` on any channel. On the SoundFont engine a drum kit also plays outside channel 10; on the FM engine bank 128 (the percussion) is channel 10's alone. A pair the engine lacks throws a RangeError. |
| `reset()` | Every channel back to its General MIDI state. |
| `sendMidi(bytes, time)` | Parse a MIDI byte stream (Web MIDI input, an emulated MPU-401) with running status across calls. The GM, GS and XG reset messages and System Reset become resets. |
| `send(event, time)` | Send any typed event, including channel and poly pressure. |
| `schedule(events)` | Atomically enqueue a batch; the promise acknowledges acceptance. |
| `clearScheduled()` | Remove future events; sounding notes continue. |
| `panic()` | Clear queued events and end every sound at once. File transport keeps emitting later notes; `stop()` stops it. |
| `loadSoundFont(source)` | Replace the SoundFont with SF2 bytes or a URL, plain or Brotli-compressed; resolves with the new `info`. Stops the transport and clears queued events. A rejected file keeps the loaded SoundFont. |
| `loadMidi(bytes, { tempo })` | Parse a Standard MIDI File (format 0 or 1), an RMI file or a MUS file. Stops the transport, clears events and returns title and duration. `tempo` (0.25 to 4, default 1) scales the file's own clock for files converted at a wrong one: 0.5 plays a MIDI file converted from Raptor's 70 Hz MUS data at Doom's 140 Hz, or such a MUS file, at its real speed. Positions, seeking and the duration count real seconds. |
| `play(loop)`, `pause()`, `stop()`, `seek(seconds)` | Control file playback. `stop()` rewinds and returns to real-time synthesis. |
| `status()` | Transport position, rate and end state, frame, queue depth, late-event count and sounding voices. |
| `setGain(value)` | Smooth output gain, from 0 to 4 (default 1). |
| `output` | GainNode for analyzers, effects or recording destinations. |
| `source` | The signal before `output`'s gain, for meters and visualizers that should not follow the volume. |
| `dispose()` | Idempotent cleanup; closes only an internally created AudioContext. |

The FM engine plays the General MIDI programs of its bank with libADLMIDI's driver: volume, expression, pan, sustain, modulation, pitch bend with its RPN range, and the percussion of channel 10. Banks differ in which instruments sound right, because each game tuned its own; `docs/music/index.json` names the bank of each soundtrack's game.

Channels and programs use zero-based MIDI numbering. Pitch bend is 0 through 16383, with 8192 centered; the default range is two semitones and RPN 0 changes it. TinySoundFont handles volume, expression, pan, sustain, bank select (controllers 0 and 32), the RPNs for pitch bend range and tuning, and the channel mode messages 120, 121 and 123. Channel and poly pressure are accepted and have no effect, because TinySoundFont has no aftertouch. It also ignores reverb and chorus sends and SoundFont modulators. `pause()` freezes file playback and the synthesizer; use `stop()` before returning to live playing. MIDI files are limited to 16 MiB and SoundFonts to 256 MiB. Decoder failures reject the operation. A WASM trap or processor failure stops that instance and rejects pending requests.

`MidiParser` and `isReset` are exported for code that needs the byte-stream parser on its own, `GM_PROGRAMS` for the 128 General MIDI program names.

## Timing

Events use output sample frames, derived by rounding `time * sampleRate`. Equal timestamps keep their submission order. Renders split at event frames and at every multiple of 64 output frames. TinySoundFont updates envelopes, filters and LFOs once per block of up to 64 frames, so render blocks that are multiples of 64 produce the same PCM as one long render. At any block size every event still acts at its own frame. Late arrivals run at the next available frame and increment `lateEvents`; they cannot alter audio already rendered. Immediate note calls can therefore be counted as late. Use a lookahead suited to the application, such as 50 ms, for sequenced events. File messages also act at their own frames.

The default event capacity is 8192. `queueCapacity` sets it at creation. Overflow rejects the whole batch without partial insertion. `clearScheduled`, panic, SoundFont changes, MIDI loading, seek and stop cancel queued events. A request timeout rejects its promise but does not cancel a command already sent to the worklet.

## Offline rendering

```ts
import { OfflineSynth, encodeWav } from 'defuss-midi-synth/offline';
import { readFile, writeFile } from 'node:fs/promises';

const synth = await OfflineSynth.create({ sampleRate: 48000 });
try {
  const { duration } = synth.engine.loadMidi(await readFile('song.mid'));
  synth.engine.play(false);
  // One more second lets the last notes release.
  await writeFile('song.wav', encodeWav(synth.render(Math.ceil((duration + 1) * 48000))));
} finally {
  synth.close();
}
```

`render(frames)` allocates planar Float32 output. `renderInto(left, right)` reuses caller buffers for streaming. Offline time starts at zero and advances with rendering. `schedule(events)` and `sendMidi(bytes, time)` work as in the browser, with time in seconds from zero. `OfflineSynth.create` takes the browser's engine options (`engine`, `chips`, `fmBank`, `soundfont`, `maxVoices`, `onProgress`); `loadMidi(bytes, { tempo })` and `play(loop)` play a file through the following renders; `useEngine(kind)`, `loadSoundFont(source)` and `loadFmBank(source)` (async) and `setFmBank(bank)` work as in the browser, `engine.loadMidi(bytes, { tempo })` as `loadMidi` does. The public `engine` provides `loadSoundFont`, `loadMidi`, `play`, `pause`, `stop`, `seek`, `setRate`, `panic`, `voices`, `info` and `playbackInfo`. `session.stats()` reports timing counters. Under Node.js (22.3 or later) and Bun the package reads its assets from the file system; the `soundfont` option takes other SF2 bytes or a file URL. `encodeWav` writes 16-bit stereo PCM and rejects non-finite samples.

## Build and verify

| Command | Result |
| --- | --- |
| `make build` | ESM, declarations, worklet and static demo assets. |
| `make verify` | Lint and types, real WASM tests, shared-core coverage, packed consumer and Chromium checks. |
| `make bench` | SoundFont load time, warmed Node WASM throughput of both engines and, after `make wasm`, the FM block renderer against the per-sample chip, in `output/benchmark.json`. |
| `make pack` | npm-compatible tarball in `output/`. |
| `make release-hashes` | SHA-256 of every release file in `RELEASE_SHA256.json`. |
| `make start`, `make stop`, `make status`, `make log` | Background demo server and logs. |
| `make wasm` | Rebuild `vendor/runtime/midi-synth.wasm` and `fm-synth.wasm` from `native/` with the `emcc` on PATH, then check the FM block renderer against the per-sample chip (a register fuzz and game files). |
| `make wasm-docker` | Rebuild with the `emscripten/emsdk:4.0.10` container. |
| `make vae` | Run the bundled defuss-vae verification gate in a git working tree. |

`native/synth.c` and `native/fm.cpp` are the engines' C entries. `native/tsf.h` is TinySoundFont 0.9, copied unchanged; `native/adlmidi/` is libADLMIDI 1.6.2 trimmed to what the FM engine uses, with Nuked OPL3 fast and this project's block renderer ([native/ARCH.md](native/ARCH.md)). The prebuilt module, the SoundFont and the native sources are hashed in [vendor/SHA256SUMS.json](vendor/SHA256SUMS.json). Builds check these hashes before JS packaging, and `make wasm` rewrites them; review those changes before release. The tarball holds `dist/` (module, SoundFont and their licence files), `src/` and `native/`.

The test suite checks pitch against SoundFont 2 rules with a SoundFont the tests write, FM pitch, banks, WOPL loading and engine switching, the General MIDI defaults, sample-accurate scheduling, block-size invariance, the MIDI, RMI and MUS parsers, file transport, SoundFont replacement, queue saturation, disposal and WAV encoding. The Chromium test drives every control of the demo, the music player included, and the public API in a real AudioWorklet. [VALIDATION.md](VALIDATION.md) scopes the evidence.

## License

The package is distributed under GPL-3.0-or-later. TinySoundFont keeps its MIT licence and TimGM6mb its GPL-2.0 licence. libADLMIDI is GPL-3.0-or-later; Nuked OPL3 and libADLMIDI's chip interface are LGPL-2.1-or-later, its volume models and file readers MIT. The notices ship beside the files they cover in `dist/assets/`. See [THIRD_PARTY.md](THIRD_PARTY.md) for provenance.
