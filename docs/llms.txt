# defuss-midi-synth

A General MIDI synthesizer for the browser and for offline rendering, with its engines in standalone WebAssembly modules:

- **SoundFont** (default): TinySoundFont 0.9 plays SoundFont 2 files. The package bundles TimGM6mb, a General MIDI SoundFont with all 128 General MIDI programs and 8 drum kits (6.0 MB, shipped Brotli-compressed as 5.2 MB).
- **FM**: libADLMIDI 1.6.2 drives emulated Yamaha OPL3 chips (Nuked OPL3), the sound of AdLib and Sound Blaster cards. It embeds 79 instrument banks taken from DOS and Windows games and drivers, and loads WOPL bank files.
- **Hardware profiles** cover the five player cards. Their instrument data ships in `dist/assets/profiles/`. The AWE32 and AWE64 profiles also take a locally supplied WASM core.

A song switches engines while it plays and keeps its position. Browser synthesis runs in an AudioWorklet. Node.js, Bun and browser offline rendering use the same engines and the same event scheduler.

## Run the demo

The release includes the compiled WASM, the built package and a self-contained demo in `docs/`. Serve `docs/` over HTTP on localhost or over HTTPS. A page opened through `file:` cannot load the worklet.

```sh
make setup
make dev
```

Open http://127.0.0.1:8080. The page is a DOS screen over Matrix rain, in pixel fonts, with a music player for the game soundtracks in `docs/music/` (see below), a shader that follows the sound, and the Bergium visualizer (its Butterchurn pipeline), which draws every sound the synthesizer plays and rotates every 30 s through 14 presets (`demo/bergium-presets.json`). The player has skip, speed and volume controls, and every track has a WAV button: the page renders the file offline on the engine and bank shown and offers it as a download. The page opens on Warcraft II, the first album; the album grid starts with the order the author chose, then the rest by title. An album's list holds the tracks of all its editions, each row naming its own. A bar at the bottom of the window shows downloads above 1 MB, their decompression and WAV rendering.

VERIFIED: The player starts on SoundBlaster 128 with the 2 MB ECW waveset. Its cover appears first and the SoundBlaster 16 appears second. The other cards follow in descending release-year order. Click a cover to switch a playing track. The selected card and variant stay active when you change tracks or albums. The SoundBlaster 16 has Yamaha OPL3 and Creative CQM buttons. The SoundBlaster 128 defaults to 2 MB ECW, followed by 4 MB ECW and 8 MB ECW. On either FM chip the bank selector shows 79 banks, with the game's bank selected when an album starts.

VERIFIED: Edit `baseTrimDb` in [docs/card-loudness.json](docs/card-loudness.json) to set the relative volume of each sound card variant in dB. For example, increasing `sb128_EAPCI2M.ECW` by 2 dB raises the SoundBlaster 128 default waveset by 2 dB on every track. Each ECW waveset has its own entry. Reload the page to apply edits to playback and WAV exports. The default compressor uses Auto level to bring the trimmed audio toward −16 LUFS before the volume slider. Clear Auto level to hear the manual trims with ordinary compression, or clear Enable to bypass both.

VERIFIED: The gallery reads its artwork and catalog before audio starts. Selecting a card downloads its core and bank on first use and shows download progress. The page stores each file separately in OPFS using defuss-storage and verifies its SHA-256 before reuse. WAV downloads use the same instruments as the player. Clearing site data or browser eviction requires downloading the files again.

The first tile in "In the crates" opens local MIDI, RMI, MUS, SF2 and WOPL files. The keyboard below the crates has bank and preset selectors and a demo sequence. A Web MIDI keyboard plays the synthesizer and lights the keys it plays; the scope shows the keys' sound, not the player's. Everything played on the keys or a Web MIDI keyboard is recorded, and "Download your synthesized MIDI." renders the recording as a WAV file. A MIDI, RMI or MUS file of your own plays in the player. Files are processed locally.

`docs/music/` holds 31 game soundtracks as General MIDI files, with covers, from https://www.karlsitretro.com/game_midi (Age of Empires II and The Conquerors without an info file: their fields stand in `scripts/index-music.mjs`, the composer as the files' own text events credit him), the eleven tracks of Q-Pop: Evolution im Weltraum (1993), which the author added (no info file either; the composers K.-L. von Wendt and Lars Hammer as the files credit them), and MaliceX's MIDI arrangements of the Jazz Jackrabbit games (2004 to 2005), indexed as two albums with their covers, GM and XG editions and titles from the files' own track names. The Lost Vikings (DOS, 1993) adds 47 numbered XMI-to-MIDI conversions with the supplied cover. `node --experimental-transform-types scripts/index-music.mjs` writes `docs/music/index.json`: each album's title, year, composers, cover and editions (GM, GS, MT-32, AdLib and others), each track's title and length, the FM bank of `docs/music/banks.ini` that the game's sound driver used, and the profile of the albums the author assigned one. Raptor has 16 MUS tracks and 15 MDS tracks, each played at the tempo encoded in its MIDI file. The rights to this music stay with its composers and publishers; it is part of the demo site, not of the npm package. The index leaves out Wolfenstein 3D's `Horst-Wessel-Lied.mid`, the NSDAP anthem, whose public performance section 86a of the German Criminal Code forbids.

VERIFIED: Gaming Crates appends one album per folder in `docs/music/new_game_music/`, sorted by title after the original collection. The indexer reads the archive’s album and song notes. It writes playable MIDI copies for ZIP entries, independent MIDI sequences and corrected timing in `docs/music/archive-playback/`.

The Computer Music Creates section indexes The OPL Archive release 10 from `docs/music/non-game-music-opl-waffle-net/`. Its 215 artist folders hold 1,341 VGZ recordings. The same indexing command writes `docs/music/computer-music.json` using the recordings’ titles, artists, dates and durations. Both crates use searchable defuss-shadcn virtual grids. Selecting a VGZ loads the Nuked OPL decoder on demand and plays its register stream through the player’s effects.


`make setup` runs `mise install` when mise is available, installs the locked Bun dependencies and installs Chromium for the tests. `mise.toml` pins Bun 1.4.3 and Node 24.22.1. Python 3 and Make run the service and verification helpers. Normal use does not need Emscripten.

A SoundFont or WOPL file may come Brotli-compressed: bytes that do not start with the format's signature (`RIFF`, `WOPL3-BANK`) are decompressed with defuss-brotli's decoder, which the package bundles and loads only then (`assets/brotli-decompressor.wasm`, 185 KB). `bun run compress` writes `FILE.br` beside every soundbank in `vendor/soundfonts/` and `docs/` at quality 11.

## Browser API

Install the package tarball with `bun add ./defuss-midi-synth-0.4.0.tgz` (`make pack` writes it to `output/`).

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

`MidiSynth.create` fetches the module of the starting engine (and, for the SoundFont engine, the SoundFont; for a native profile, its pack), compiles it and then constructs the worklet. The `onProgress` option hears each download and decompression of the files the synthesizer loads, as `{ phase: 'download' | 'decompress', url, loaded, total }` (`total` 0 while a server sends no length). In a browser downloads report step by step through XMLHttpRequest, and the Brotli decoder reports every 4 MB of input and yields to the event loop between steps, so a page repaints its bar. Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `engine` | `'soundfont'` | The engine that plays first: `'soundfont'`, `'fm'` or a profile id. `useEngine` loads another one on demand. |
| `profile` | none | The profile that plays first, one of `SYNTH_PROFILES`. Given with `engine`, both must name the same one, else a RangeError. |
| `profileSources` | none | Per native profile `{ wasm?, assets? }`: its module and its pack, as bytes or a URL relative to `baseUrl`. |
| `readWasm` | Built-in byte reader | Optional async reader for engine module URLs. Return a Uint8Array. The browser and offline renderers both accept it. |
| `soundfont` | `assets/TimGM6mb.sf2.br` | Other SF2 bytes or a URL relative to `baseUrl`, plain or Brotli-compressed. |
| `maxVoices` | 256 | SoundFont voices to preallocate, up to 4096. |
| `chips` | 2 | Emulated OPL3 chips of the `fm` engine, 1 to 8; each sounds 18 two-operator voices. `sb16-opl3` always has one. |
| `fmBank` | 0 | The embedded bank an FM engine (`fm`, `sb16-opl3`, `sb16-cqm`) starts on, 0 to 78, numbered as libADLMIDI's `banks.ini` (`docs/music/banks.ini`). |

For the SoundFont engine, `maxVoices` limits the voices. Beyond that limit, a new note takes over the voice furthest into its release, and a note that finds no releasing voice stays silent. Every channel starts in its General MIDI state: program 1, channel volume 100, and the drum kit on channel 10.

| API | Behavior |
| --- | --- |
| `info` | The active engine's name, `kind` and `profile` (for a profile), the loaded `engines`, sample rate, voice limit and the presets as `{ bank, program, name }`: bank 0 holds the General MIDI programs, bank 128 the drum kits. Once an FM engine is loaded, `info.fm` holds its bank names, its bank (-1 for a loaded WOPL file) and its chips. |
| `useEngine(kind)` | Make `'soundfont'`, `'fm'` or a profile play, fetching and compiling it the first time. A loaded file keeps its position: its state up to there is replayed into the new engine and its held notes struck again. Scheduled events are cleared. |
| `useProfile(profile, sources?)` | `useEngine` for profiles; `'fm'` is a RangeError. `sources` (`{ wasm?, assets? }`) supplies a native profile's pack after creation, such as files a user picks, merged into that profile's `profileSources` entry, so a module given at creation stays. Once the profile is loaded or loading it keeps its pack, and new sources reject. |
| `setFmBank(bank)` | Select an embedded bank (0 to 78) on every loaded FM engine: `fm`, `sb16-opl3`, `sb16-cqm`. A playing file plays on with the new instruments. |
| `loadFmBank(source)` | Replace the instruments of every loaded FM engine with a WOPL bank file (bytes or a URL, plain or Brotli-compressed); a rejected file keeps the bank and the playing file's state. |
| `setPlaybackRate(rate)` | Play the loaded file at 0.25 to 4 times its tempo, at the same pitch. |
| `noteOn`, `noteOff`, `programChange`, `controlChange`, `pitchBend` | Send a validated event; the optional last argument is absolute AudioContext time. |
| `selectPreset(channel, bank, program)` | Select any preset of `info.presets` on any channel. On the SoundFont engine a drum kit also plays outside channel 10; on every other engine bank 128 (the percussion) is channel 10's alone. A pair the engine lacks throws a RangeError. |
| `reset()` | Every channel back to its General MIDI state; on a native profile, the core's power-on state. |
| `sendMidi(bytes, time)` | Parse a MIDI byte stream (Web MIDI input, an emulated MPU-401) with running status across calls. Each complete SysEx becomes a `sysex` event; System Reset becomes a reset. |
| `send(event, time)` | Send any typed event, including channel and poly pressure and `sysex`. |
| `schedule(events)` | Atomically enqueue a batch; the promise acknowledges acceptance. |
| `clearScheduled()` | Remove future events; sounding notes continue. |
| `panic()` | Clear queued events and end every sound at once. File transport keeps emitting later notes; `stop()` stops it. |
| `useSoundFont(source)` | In the browser, load and select an SF2 in one operation. A playing song keeps its position. |
| `loadSoundFont(source)` | Replace the SoundFont with SF2 bytes or a URL, plain or Brotli-compressed; resolves with the new `info`. Clears queued events and, while the SoundFont engine plays, stops the transport. A rejected file keeps the loaded SoundFont. Before `useEngine('soundfont')` has loaded that engine, it rejects without downloading. |
| `loadMidi(bytes, { tempo })` | Parse a Standard MIDI File (format 0 or 1), an RMI file or a MUS file, with at most 65,536 SysEx messages. Stops the transport, clears events and returns title and duration. For MIDI and RMI, `metadata` includes the format, track count and available initial tempo, time signature, copyright and text. `tempo` (0.25 to 4, default 1) scales the file's own clock for files converted at a wrong one: 0.5 plays a MIDI file converted from Raptor's 70 Hz MUS data at Doom's 140 Hz, or such a MUS file, at its real speed. Positions, seeking and the duration count real seconds. |
| `play(loop)`, `pause()`, `stop()`, `seek(seconds)` | Control file playback. `stop()` rewinds and returns to real-time synthesis. |
| `status()` | Transport position, rate and end state, frame, queue depth, late-event count, sounding voices, and `dropped`: the MIDI and SysEx messages the active engine's input could not take (always 0 on the SoundFont and FM engines). |
| `setGain(value)` | Smooth output gain, from 0 to 4 (default 1). |
| `output` | GainNode for analyzers, effects or recording destinations. |
| `source` | The signal before `output`'s gain, for meters and visualizers that should not follow the volume. |
| `dispose()` | Idempotent cleanup; closes only an internally created AudioContext. |

The FM engines play the General MIDI programs of their bank with libADLMIDI's driver: volume, expression, pan, sustain, modulation, pitch bend with its RPN range, and the percussion of channel 10. Banks differ in which instruments sound right, because each game tuned its own; `docs/music/index.json` names the bank of each soundtrack's game.

Channels and programs use zero-based MIDI numbering. Pitch bend is 0 through 16383, with 8192 centered; the default range is two semitones and RPN 0 changes it. TinySoundFont handles volume, expression, pan, sustain, bank select (controllers 0 and 32), the RPNs for pitch bend range and tuning, and the channel mode messages 120, 121 and 123. Channel and poly pressure are accepted and have no effect, because TinySoundFont has no aftertouch. It also ignores reverb and chorus sends and SoundFont modulators. `pause()` freezes file playback and the synthesizer; use `stop()` before returning to live playing. MIDI files are limited to 16 MiB and 65,536 SysEx messages (more is a RangeError), SoundFonts to 256 MiB. Decoder failures reject the operation. A WASM trap or processor failure stops that instance and rejects pending requests.

`MidiParser` (with `cancel()`, which drops a message in progress) and `isReset` (the GM, GM2, GS and XG resets) are exported for code that needs the byte-stream parser on its own, `GM_PROGRAMS` for the 128 General MIDI program names, `SYNTH_PROFILES` and `PROFILE_DESCRIPTORS` for the profiles.

## Hardware profiles

VERIFIED: `SYNTH_PROFILES` lists `soundfont`, `sb16-opl3`, `sb16-cqm`, `sb-pci128`, `gus-gf1`, `awe32` and `awe64`. PCI 128 defaults to the 2 MB ECW waveset. To select the 4 MB or 8 MB variant, pass `{ assets: 'assets/profiles/sb-pci128-4m.dspack' }` or `{ assets: 'assets/profiles/sb-pci128-8m.dspack' }` to `useProfile('sb-pci128', sources)`. The alternate PCI SoundFont is `assets/profiles/pci128.sf2`. The GF1 defaults to its 1024 KiB patch set. AWE32 and AWE64 include their EMU8000 ROM and GS bank. Supply their local core as `profileSources[profile].wasm`. Both SB16 chips use embedded FM banks.

```ts
import { MidiSynth } from 'defuss-midi-synth';

const synth = await MidiSynth.create({ context, baseUrl: new URL('/synth/', location.href), profile: 'sb-pci128' });
await synth.useProfile('gus-gf1');

```

A profile loads on first use and reports through `onProgress`; concurrent calls share one load, and `fm` and `sb16-opl3` share one download and compile of `fm-synth.wasm`. A profile that cannot load rejects with an Error that names the profile, the file and what makes it available, and the engine that played plays on. An AWE profile requires a module in `profileSources`. `sb16-opl3` is libADLMIDI on one chip with 18 voices, at the level of `fm`; `sb16-cqm` plays the same banks on a CQM chip, lists their 79 names in `info.fm` also without another FM engine, and follows `fmBank`, `setFmBank` and `loadFmBank`; an FM engine loaded later starts on the current bank. [HARDWARE_PROFILES.md](HARDWARE_PROFILES.md) states each profile's core, licence, test status, cost and fidelity limits.

### Keep the user's files

`openProfileStore()` keeps a profile's pack, and the module of a local build, in the browser's origin private file system (OPFS) through [defuss-storage](https://www.npmjs.com/package/defuss-storage), so a later visit plays them without asking for the files again. The files stay on the device. `createProfileStore(adapter)` does the same on any defuss-storage adapter, such as `createFileStorage(dir)` in Node or `createOPFSStorage()` in a worker.

```ts
import { MidiSynth, openProfileStore } from 'defuss-midi-synth';

const store = await openProfileStore();             // OPFS: defuss-storage/defuss-midi-synth
await store.save('gus-gf1', { assets: pack });  // after the user picked it once
const sources = await store.load('gus-gf1');    // a later visit: { assets } or undefined
if (sources) await synth.useProfile('gus-gf1', sources);
await store.profiles();                             // ['gus-gf1']
await store.remove('gus-gf1');                  // forget the user's files
```

`save` replaces the parts it is given and keeps the others; it writes at most 64 MiB at once and smaller writes on an adapter whose `maxWriteBytes` is lower, and a save the adapter refuses leaves the stored copy as it was. `load` resolves `undefined` when nothing is stored, and skips a pack whose records do not add up to its size, or a module `WebAssembly.validate` refuses: a save that stopped partway leaves such a file. `openProfileStore` rejects outside a browser with OPFS. It uses defuss-storage's directory adapter over the OPFS directory `defuss-storage/<name>`, the one `createOPFSStorage({ name })` uses, because the OPFS adapter needs a dedicated worker's sync access handles and a page calls this on its main thread. The two adapters lock files under different names, so they do not exclude each other: use one of them for a store at a time. The browser keeps the files as best-effort site data, which the Storage Standard lets it evict under storage pressure; the store does not call `navigator.storage.persist()`.

### Make a pack

## System exclusive messages

A `sysex` event, `{ type: 'sysex', data }`, holds one message from F0 to F7 as a Uint8Array or an array of bytes: 2 to 65,536 bytes, data bytes below 80h, else a RangeError. `schedule` and `send` take it; `sendMidi` makes one of every complete SysEx in a byte stream, keeps real-time bytes inside it as messages of their own, and drops a message longer than 65,536 bytes whole. Each engine receives the message as it was sent and applies what its hardware or driver knows:

| Engine | SysEx it applies |
| --- | --- |
| `soundfont` | The GM, GM2, GS and XG resets; GM Master Volume, on TinySoundFont's channel-volume curve. The rest is ignored. |
| `fm`, `sb16-opl3`, `sb16-cqm` | The four resets, then libADLMIDI's own: GM System On and Off, the GS reset and rhythm part assignment, XG System On, GM Master Volume. |
| `awe32`, `awe64`, `sb-pci128`, `gus-gf1` | The four resets; the rest is ignored. |

A file's SysEx events (F0, divided F7 continuations and F7 escapes) play at their frames. A seek, an engine switch or a bank change resets the engine and replays the file's state before the position in file order: every SysEx and reset, every bank select, RPN, NRPN, data entry and channel mode message, and of each channel the last program, pitch bend, channel pressure and value of every other controller. Scheduled SysEx are not replayed, like scheduled channel messages.

## Timing

Events use output sample frames, derived by rounding `time * sampleRate`. Equal timestamps keep their submission order. Renders split at event frames and at every multiple of 64 output frames. TinySoundFont updates envelopes, filters and LFOs once per block of up to 64 frames, so render blocks that are multiples of 64 produce the same PCM as one long render. At any block size every event still acts at its own frame. Late arrivals run at the next available frame and increment `lateEvents`; they cannot alter audio already rendered. Immediate note calls can therefore be counted as late. Use a lookahead suited to the application, such as 50 ms, for sequenced events. File messages also act at their own frames.

The default event capacity is 8192. `queueCapacity` sets it at creation. Up to 16 MiB of SysEx bytes wait in the queue at once. Overflow of either rejects the whole batch without partial insertion. `clearScheduled`, panic, SoundFont changes, MIDI loading, seek and stop cancel queued events. A request timeout rejects its promise but does not cancel a command already sent to the worklet.

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

`render(frames)` allocates planar Float32 output. `renderInto(left, right)` reuses caller buffers for streaming. Offline time starts at zero and advances with rendering. `schedule(events)` and `sendMidi(bytes, time)` work as in the browser, with time in seconds from zero. `OfflineSynth.create` takes the browser's engine options (`engine`, `profile`, `profileSources`, `chips`, `fmBank`, `soundfont`, `maxVoices`, `onProgress`); `loadMidi(bytes, { tempo })` and `play(loop)` play a file through the following renders; `useEngine(kind)`, `useProfile(profile, sources?)`, `loadSoundFont(source)` and `loadFmBank(source)` (async) and `setFmBank(bank)` work as in the browser, `engine.loadMidi(bytes, { tempo })` as `loadMidi` does. The public `engine` provides `loadSoundFont`, `loadMidi`, `play`, `pause`, `stop`, `seek`, `setRate`, `panic`, `voices`, `info` and `playbackInfo`; unlike the synthesizer's own methods, these leave scheduled events queued, which `session.clear()` removes. `session.stats()` reports timing counters, and the `dropped` getter what `status().dropped` reports in the browser. Under Node.js (22.3 or later) and Bun the package reads its assets from the file system; the `soundfont` option and `profileSources` take bytes or a file URL. `encodeWav` writes 16-bit stereo PCM and rejects non-finite samples.

## Build and verify

| Command | Result |
| --- | --- |
| `make build` | ESM, declarations, worklet, the bundled profile cores and static demo assets. |
| `make verify` | Lint and types, real WASM tests, shared-core coverage, packed consumer and Chromium checks. |
| `make bench` | SoundFont load time, warmed Node WASM throughput of the SoundFont and FM engines and, after `make wasm`, the FM block renderer against the per-sample chip, in `output/benchmark.json`. |
| `make pack` | npm-compatible tarball in `output/`. |
| `make release-hashes` | SHA-256 of every release file in `RELEASE_SHA256.json`. |
| `make start`, `make stop`, `make status`, `make log` | Background demo server and logs. |
| `make wasm` | Rebuild `vendor/runtime/midi-synth.wasm` and `fm-synth.wasm` from `native/` with the `emcc` on PATH, then check the FM block renderer against the per-sample chip (a register fuzz and game files). |
| `make wasm-docker` | Rebuild with the `emscripten/emsdk:4.0.10` container. |
| `make vae` | Run the bundled defuss-vae verification gate in a git working tree. |
| `python3 scripts/build-native-profiles.py <profile>...` | Rebuild the CQM core from its pinned upstream commit with Emscripten (`emcc`, `em++`, `emar`, Node, Git); `--local-awe awe32 awe64` builds the AWE cores into `profile-assets/local-builds/`. |
| `python3 scripts/build-vintage-wasm.py` | Rebuild the ECW and GF1 cores with an LLVM clang that targets wasm32, without Emscripten. |

`native/synth.c` and `native/fm.cpp` are the engines' C entries, `native/profiles/` the profile adapters and in-tree cores. `native/tsf.h` is TinySoundFont 0.9, copied unchanged; `native/adlmidi/` is libADLMIDI 1.6.2 trimmed to what the FM engine uses, with Nuked OPL3 fast and this project's block renderer ([native/ARCH.md](native/ARCH.md)). The prebuilt modules, the SoundFont and the native sources are hashed in [vendor/SHA256SUMS.json](vendor/SHA256SUMS.json). Builds check these hashes before JS packaging. `make wasm` rewrites them; after the profile build scripts, `node scripts/integrity.mjs --write` does. Review those changes before release. The tarball holds `dist/` (modules, SoundFont and their licence files), `src/`, `native/`, the two profile build scripts and the Nuked CQM source archive of `vendor/sources/`.

The test suite checks pitch against SoundFont 2 rules with a SoundFont the tests write, FM pitch, banks, WOPL loading and engine switching, the General MIDI defaults, sample-accurate scheduling, block-size invariance, the MIDI, RMI and MUS parsers, SysEx in files and streams, file transport, SoundFont replacement, queue saturation, disposal and WAV encoding, and each profile core on its real module. The Chromium test drives every control of the demo, the music player and the hardware list included, and the public API in a real AudioWorklet. [VALIDATION.md](VALIDATION.md) scopes the evidence.

## License

This project's own source code is licensed under the MIT License ([LICENSE](LICENSE)), except the two CQM adapter files, whose SPDX lines name GPL-3.0-or-later and LGPL-2.1-or-later. The package as a whole is distributed under GPL-3.0-or-later, because its modules link libADLMIDI. Copyright in the SoundFonts, FM instrument banks, music files and other third-party components remains with their respective holders; [THIRD_PARTY.md](THIRD_PARTY.md) lists each with its source and licence. The ROMs, ECW wavesets and Gravis patches that packs hold are neither part of the package nor of the site.
