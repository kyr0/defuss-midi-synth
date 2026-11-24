# Validation: 0.3.0

VERIFIED: the release was built and tested on macOS arm64 (Apple M5 Max) with Node 24.22.1, Bun 1.4.3, Homebrew's emcc 7.0.0-git and Playwright's Chromium 141.0.7390.37. These results describe this environment and the included test inputs.

| Check | Observed result |
| --- | --- |
| Native build | `make wasm` built `midi-synth.wasm` (51,409 bytes) and `fm-synth.wasm` (329,678 bytes); each imports only `env.emscripten_notify_memory_growth`. A second build gave identical bytes. |
| OPL3 block renderer | Equal to the per-sample chip: 4,000 fuzz rounds of register writes (4,502,943 samples) and 6,912,000 frames of six game files through both modules (`make wasm`). |
| Locked installation | `bun install --frozen-lockfile` succeeded. |
| Lint and declarations | Oxlint reported zero warnings or errors; TypeScript strict checking passed. |
| Tests | 36 passed, none failed or skipped; real WASM, no mock DSP. |
| Pitch and General MIDI | A written two-sine SoundFont plays 480 Hz at its original key and 960 Hz an octave up, through program 1, on channel 10 and through a bank 128 preset on channel 3. Pitch bend spans two semitones, and RPN 0 widens it to an octave. On the FM engine a flute's A4 sounds at 440 Hz within 1% and A3 an octave below, in banks 0, 16 and 72. |
| Banks and presets | 136 SoundFont presets. The FM engine names the 79 banks of `banks.ini` in order, lists 128 programs and the percussion, rejects bank 79 and a WOPL file that is none, loads libADLMIDI's test bank, and plays percussion on channel 10 only. |
| Engine switch and rate | A playing file keeps its position across switches and sounds on the new engine; at rate 2 a 0.5 s file ends after 0.25 s, at 0.5 the clock runs at half speed. |
| Block invariance | Identical PCM (SHA-256) for one 240,000-frame render and for blocks of 64 to 4096 frames, on both engines. At blocks of 1, 31, 127 and 257 frames, onsets stay at their frames. |
| Files | SMF formats 0 and 1 with tempo maps, SMPTE division, GM resets in files, RMI and MUS give the specified times. Seeking replays program changes before the target. Malformed, truncated and format 2 files are rejected. |
| Music index | 33 albums and 943 tracks, the author's eleven first; every MIDI file of the album folders is indexed once except the excluded one; each length matches the parsed file; each cover exists; each FM bank name matches `banks.ini`. |
| Coverage | V8 reported 97.02% lines and 87.70% branches across assets, brotli, engine, gm, midifile, offline, parser, queue, session, types and voices. This excludes the browser facade, the worklet and the C code; the browser-only XMLHttpRequest download runs in the e2e test. |
| Brotli | Every compressed bank decompresses to its source's bytes (TimGM6mb 61 ms, the 135 MB SoundFont 1.46 s under Node.js); compressed and plain SoundFonts and WOPL banks give identical presets and PCM; bytes that are neither keep the loaded SoundFont. The stepwise decoder gives defuss-brotli's bytes, reports its progress to the end and rejects truncated input and output beyond its limit; `onProgress` heard the SoundFont's download, then its decompression. |
| Package consumption | The packed tarball installed into a clean consumer; TypeScript declarations checked; Node and Bun each rendered nonzero PCM with the bundled SoundFont and with the FM engine, switched engines, and wrote a WAV. |
| Browser | Real WASM in an AudioWorklet: analyzer RMS 0.044 for a piano note, 0.022 for a crash cymbal of the TR 808 kit on channel 4 and 0.050 for an FM note; zero page, console, failed-request or HTTP errors. |
| Browser interactions | The player: Age of Empires II first and selected, all editions in one list, the bank list (79 banks, a picked bank held for the album's next track), a track's WAV download (8.7 s for Doom's 6.7 s intro), the progress bar's download and decompression of the SoundFont at 50 MB/s, album list, play and pause, automatic next track, speed 2x (2.2 to 3.8 s of position in 1.5 s), skip by 10 s, seeking, previous and next, volume and mute tied to the output slider, the excluded track absent, the FM engine (the page's default) with each game's bank, Raptor at tempo 0.5 (0:33 for Wave Music 1, the position moving at half speed), the progress bar moving while focused with its fill at the position, the 104 MB Brotli-compressed OPL-3 FM 128M SoundFont (129 presets, 1.6 s from a local server in a probe) and back to FM, and the visualizer, Bergium from the start on the first of its 14 presets: it drew 30 more frames, stepped to the next preset, and turned off. The options read "No Visuals", "Bergium", "Gravis Ultrasound" and "SoundBlaster 16". The instrument: keyboard and pointer notes, bank and preset selection, velocity, demo, stop, panic, MIDI, RMI and MUS files in the player, a Brotli-compressed WOPL file and the return to the game's bank, a Brotli-compressed SF2 file, a rejected SF2 keeping the loaded one, a stub Web MIDI keyboard lighting its key and moving the scope, the recording's WAV downloads on both engines, starting over, the scope flat while only the player sounds, and malformed-file recovery. |
| Source node | With the output gain at 0, `source` still carried the note (RMS 0.032) while `output` was silent. |
| Lifecycle and errors | Queue overflow, a missing preset, an FM bank out of range, a percussion preset outside channel 10, a playback rate out of range, repeated disposal, caller-context preservation and owned-context closure passed. |
| Layout | The Matrix rain and the cover on its CRT shader drew (defuss-shadcn's `data-ready`), the rain sped up with the music, the sleeves carry their years, the text is set in VT323, and the footer has no API notes. A full-page desktop screenshot, the 390 px phone layout per section (player, crates, synth) and the visualizer were captured; the phone document has no horizontal overflow. |

The raw reports, logs, renders and screenshots are in `evidence/`. Reproduce with `make verify` and `make wasm`; fresh results go to `output/`.

## Throughput measurement

VERIFIED: on the Apple M5 Max under Node 24.22.1 (`make bench`), loading the bundled SoundFont took 5.3 ms (median of five). Sustained notes on 16 channels with TimGM6mb were rendered at 48 kHz in 128-frame calls, five warmed runs of ten seconds of audio each:

| Notes | Sounding voices | Median for 10 s | Mean time per 128 frames | Faster than real time |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 16 | 28.3 ms | 7.6 microseconds | 353x |
| 32 | 51 | 86.3 ms | 23.0 microseconds | 116x |
| 128 | 210 | 360.5 ms | 96.1 microseconds | 28x |

The FM engine played Doom's At Doom's Gate (E1M1) with bank 16, five warmed runs of 30 s of audio. The last two columns time the module alone, the block renderer against the per-sample chip it replaced:

| Chips | Median for 30 s | Mean time per 128 frames | Faster than real time | Module, block renderer | Module, per-sample chip |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 255.8 ms | 22.7 microseconds | 117x | 20.9 microseconds | 36.4 microseconds |
| 4 | 417.7 ms | 37.1 microseconds | 72x | 32.1 microseconds | 148.0 microseconds |

A 128-frame quantum at 48 kHz lasts 2,667 microseconds. These are Node WASM throughput measurements, not browser deadline, mobile or worst-case latency evidence. Run `make bench` on the target hardware for a relevant local measurement.

## Scope

UNKNOWN: Safari and Firefox behavior, physical MIDI-device input, and `make wasm-docker` (not run for this release). `fm-synth.wasm` uses WebAssembly SIMD, which browsers have supported since Chrome 91, Firefox 89 and Safari 16.4. TinySoundFont implements neither reverb, chorus, SoundFont modulators nor aftertouch, so files that rely on them sound drier than on a full GS or XG synthesizer. SoundFont and file parsing run on the worklet thread and can interrupt audio; load them between playback operations.

HYPOTHESIS: in one of nine Chromium runs, the worklet received a `currentFrame` below the frames it had already rendered, and the instance stopped. The worklet now passes the later of the two frames. A probe that counted such quanta found none in three later runs, and seven runs since the change passed; a repeat with that probe in place would confirm or refute the cause.
