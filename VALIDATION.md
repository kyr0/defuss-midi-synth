# Validation

## 0.4.0 (not released)

VERIFIED: this tree was tested on 2026-11-25 on macOS arm64 (Apple M5 Max) with Node 24.22.1, Bun 1.4.3 and Playwright's Chromium 141.0.7390.37. The profile rows come from the unit runs of the same day, on the same machine, recorded in `../defuss-midi-synth.wt/<unit>/tmp/unit-report.md`; the private assets they used (wavesets, patches) are not in this tree. These results describe this environment and these inputs.

| Check | Observed result |
| --- | --- |
| Tests | `make test`: 158 node tests passed, none failed or skipped, and 19 Python tests of `scripts/fetch-roms.py` passed (2026-11-25); real WASM, no mock DSP. They include every profile core on its real module and the AWE tests on the local build in `profile-assets/local-builds/`. |
| Lint and declarations | `make lint`: Oxlint reported zero warnings or errors, TypeScript strict checking passed, and `scripts/integrity.mjs` verified 83 pinned vendor files. |
| Coverage | `make coverage`: V8 reported 98.05% lines and 90.97% branches across the 18 shared modules (2026-11-25), the seven profile modules among them (`profiles`, `profile-assets`, `profile-clock`, `profile-presets`, `profile-store`, `profile-voices`, `fm-banks`). This excludes the browser facade, the worklet and the C code. |
| Browser | `scripts/e2e.mjs` passed in Chromium with zero page, console, failed-request or HTTP errors: the Sound Engine buttons and the Sound Blaster 16's chip switch, the chip it played last coming back; the CQM on the game bank (`LIBADLMIDI / NUKED CQM · BANK 16`, sounding); GF1 packs of the tests' synthetic patches, an MT-32 pack, an ECW waveset and a stray file dropped on the ROMs list, named by `packs.json` and `devices.json`, newest first, and sorted again by a later drop; one GF1 pack and then the other in its place, a track's WAV rendered with the GF1; the MT-32 pack the core rejects, which names `roland-mt32` and leaves the GF1 playing; the waveset playing; an AWE32 pack through the "Load pack" button, playing on the local build the demo server serves and rendering a track's WAV with TimGM6mb (2026-11-25); a second page playing the stored devices from OPFS without asking for files, "Forget this device" deleting the stored GF1 alone, deleting a stored pack that fails, and "Forget your files" emptying the store; a GM System On by `send` and by `sendMidi` ending a held note, a malformed SysEx a RangeError; `useProfile('sb16-opl3')` with 18 voices; `useProfile('roland-mt32')` without a pack rejecting with its name while `sb16-opl3` plays on; one request for `fm-synth.wasm` for `fm` and `sb16-opl3` together. The script's checks of the player and the instrument passed in the same run (RMS 0.039 for a piano note, 0.021 for a drum, 0.050 for an FM note in the last run, after the review's fixes). |
| Package consumption | `scripts/pack-test.mjs` passed: the packed tarball installed into a clean consumer, rendered with the SoundFont and FM engines and with `sb16-opl3`, ended a note with a GM System On, rejected a profile without its pack and type-checked `profile`, `useProfile` and a `sysex` event. In this environment `bun add` needed `TMPDIR` set to a writable directory; with its default it stopped with EPERM. |
| Module identity | The SHA-256 of every profile module in `vendor/runtime/profiles/` and `profile-assets/local-builds/` equals the build its unit tested. |
| `sb16-cqm` | 9 tests. 295,531 bytes, one import; A4 at 439.24 Hz against 439.22 Hz on the OPL3; a quadratic sine (third harmonic -28.6 dB); 18 voices; resets restore the power-on state bit for bit at the raw ABI; nothing allocated during 5,000 render blocks. Render 73.6 to 74.6 µs per 128 native frames; Doom's E1M1 at 48 kHz 27 to 34 times real time. |
| `awe32`, `awe64` | Built locally, 296,501 bytes each, reproducible. 13 tests; TimGM6mb in DRAM: all 128 programs and the drum kit audible in the Win95, DOS and SDK driver families; output silent for exactly 980 frames; render invariant to block partition, a mutation of the Win95 glide window caught. Init 22.5 to 23.7 ms with the 6 MB SF2; render 0.091 to 0.134 ms median, 1.06 to 1.34 ms p99 per 128 frames. |
| `sb-pci128` | `scripts/profile-ecw-test.mjs`, 29 of 29 on EMAC's EAPCI2M, 4M and 8M: tables and every reachable note's voices agree with ecw2sfz r3 (230,528 notes on 8M); every melodic program sounds; tuning median 0.0 cents on 8M (range -6.9 to +7.9); native and WASM PCM identical over 541,542 samples; 9,000 mutated files clean under ASan and UBSan. Render 19.5 µs median, 35.1 µs p99 at 64 voices. |
| `gus-gf1` | 8 tests on synthetic patches. `scripts/profile-gf1-test.mjs`, 17 of 17 on the 85 mapped Gravis patches and all 190 of the full set: tuning within 10 cents, bend +201.7 and -200.3 cents, the SDK rate table for 14 to 32 voices, native and WASM PCM identical over 66,000 frames, 100,000 mutated patches clean under ASan and UBSan. Render 12.0 µs median, 26.5 µs p99 at 32 voices. |
| `roland-sc55`, `roland-sc55mk2` | 17 tests without ROMs: every image's size and CRC32 checked, wrong packs rejected by role, size and CRC32. A probe of the unit run found MIDI paced at 31,250 baud. With CRC-forged zero-filled stand-ins the boards boot (0.31 to 0.37 s and 2.2 to 2.6 s) and render at 0.17 to 0.26 and 0.18 to 0.24 ms per 128 frames, a lower bound. |
| `roland-mt32` | 3 tests without ROMs; with Munt-style fake ROMs: 32 voices from 8 four-partial notes, no heap allocation over 5,000 renders, FFh restoring the parameter memory, 128-, 64-, 7- and 1-frame partitions bit-identical. Render 0.100 to 0.127 ms per 128 native frames at 32 partials. |
| Seek replay | The replay of a seek to mid-file over the 1,062 library files that parse (a probe of `chaseMask`, counting the bytes of the messages it keeps): median 72 bytes, 90th percentile 212, maximum 5,215, none above the Sound Canvas cores' 16 KiB MIDI IN. Replaying every non-note message would send a median of 189 bytes and up to 47,164, 19 files above 16 KiB. The most SysEx messages in one library file is 40. |
| SysEx and the host | `fm-synth.wasm` with `fm_sysex` renders 86,400,000 frames identical to the 0.3.0 module; `NativeClock` consumes exactly floor(frames times native over output rate) after 2^21 frames at 19,293 to 66,206 Hz; SysEx and notes at odd frames give the same PCM in blocks of 7, 61, 128, 1 and 300 frames as in one render, on the ECW and GF1 cores. |

Reproduce with `make verify`; the profile scripts need your own assets and state their commands in their headers ([HARDWARE_PROFILES.md](HARDWARE_PROFILES.md#packs)).

### Throughput, 2026-11-25

VERIFIED: `make bench` on the Apple M5 Max under Node 24.22.1, at a load average of about 10 from other processes. Creating an offline synthesizer with the bundled SoundFont, its Brotli decompression included, took 50.8 ms (median of five); the 0.3.0 tables give the load (5.3 ms) and TimGM6mb's decompression (61 ms) separately. Sustained notes on 16 channels with TimGM6mb at 48 kHz in 128-frame calls, five warmed runs of 10 s of audio:

| Notes | Sounding voices | Median for 10 s | Mean time per 128 frames | Faster than real time |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 16 | 28.2 ms | 7.5 microseconds | 355x |
| 32 | 51 | 83.4 ms | 22.2 microseconds | 120x |
| 128 | 210 | 352.3 ms | 94.0 microseconds | 28x |

The FM engine played Doom's E1M1 with bank 16, five warmed runs of 30 s of audio:

| Chips | Median for 30 s | Mean time per 128 frames | Faster than real time | Module, block renderer | Module, per-sample chip |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 240.8 ms | 21.4 microseconds | 125x | 18.8 microseconds | 33.9 microseconds |
| 4 | 389.0 ms | 34.6 microseconds | 77x | 28.6 microseconds | 119.4 microseconds |

A 128-frame quantum at 48 kHz lasts 2,667 microseconds. These are Node WASM throughput measurements, not browser deadline, mobile or worst-case latency evidence.

### Scope, 0.4.0

UNKNOWN: how the Roland and AWE profiles play real ROMs. No SC-55, SC-55mkII or MT-32 ROM and no EMU8000 ROM or Creative bank has run; their checks used stand-ins, fake ROMs and TimGM6mb in DRAM. The release waits for that run (`scripts/profile-sc55-test.mjs`, `scripts/profile-mt32-test.mjs`, `scripts/profile-awe-test.mjs`).

UNKNOWN: whether any profile sounds like its hardware. No recording of a real card or module was compared, so the ECW and GF1 driver curves, the CQM's level and polarity, and the Roland timing stay reconstructions or emulator output ([HARDWARE_PROFILES.md](HARDWARE_PROFILES.md#fidelity-limits)).

HYPOTHESIS: on the Sound Canvas cores, notes after a seek sound late by the replay's time on the emulated MIDI cable, up to 1.7 s for the largest replay of 5,215 bytes at 3,125 bytes per second. Falsifier: the onset of a note after a seek into a dense file, measured with ROMs.

UNKNOWN: Safari and Firefox behavior, physical MIDI-device input, and the cost inside an AudioWorklet of the work some cores do on the audio thread: the Sound Canvas boot, the AWE and CQM resets, the GF1 patch uploads. `make wasm` and `make wasm-docker` were not rerun for this pass; the SysEx unit ran `make wasm` for the new `fm-synth.wasm`.

## 0.3.0

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
| Music index | 34 albums and 954 tracks, the author's fourteen first; every MIDI file of the album folders is indexed once except the excluded one; each length matches the parsed file; each cover exists; each FM bank name matches `banks.ini`. |
| Coverage | V8 reported 97.02% lines and 87.70% branches across assets, brotli, engine, gm, midifile, offline, parser, queue, session, types and voices. This excludes the browser facade, the worklet and the C code; the browser-only XMLHttpRequest download runs in the e2e test. |
| Brotli | Every compressed bank decompresses to its source's bytes (TimGM6mb 61 ms, the 135 MB SoundFont 1.46 s under Node.js); compressed and plain SoundFonts and WOPL banks give identical presets and PCM; bytes that are neither keep the loaded SoundFont. The stepwise decoder gives defuss-brotli's bytes, reports its progress to the end and rejects truncated input and output beyond its limit; `onProgress` heard the SoundFont's download, then its decompression. |
| Package consumption | The packed tarball installed into a clean consumer; TypeScript declarations checked; Node and Bun each rendered nonzero PCM with the bundled SoundFont and with the FM engine, switched engines, and wrote a WAV. |
| Browser | Real WASM in an AudioWorklet: analyzer RMS 0.044 for a piano note, 0.022 for a crash cymbal of the TR 808 kit on channel 4 and 0.050 for an FM note; zero page, console, failed-request or HTTP errors. |
| Browser interactions | The player: Warcraft II first and selected, all editions in one list, the bank list (79 banks, a picked bank held for the album's next track), Jazz Jackrabbit 2 and The Settlers II starting on the SoundBlaster 16, an engine picked on Jazz Jackrabbit 2 held for its next track and Doom back on the FM engine, with one download of the SoundFont, a track's WAV download (8.7 s for Doom's 6.7 s intro), the progress bar's download and decompression of the SoundFont at 50 MB/s, album list, play and pause, automatic next track, speed 2x (2.2 to 3.8 s of position in 1.5 s), skip by 10 s, seeking, previous and next, volume and mute tied to the output slider, the excluded track absent, the FM engine (the page's default) with each game's bank, Raptor at tempo 0.5 (0:33 for Wave Music 1, the position moving at half speed), the progress bar moving while focused with its fill at the position, the 104 MB Brotli-compressed OPL-3 FM 128M SoundFont (129 presets, 1.6 s from a local server in a probe) and back to FM, and the visualizer, Bergium from the start on the first of its 14 presets: it drew 30 more frames, stepped to the next preset, and turned off. The options read "No Visuals", "Bergium", "Gravis Ultrasound" and "SoundBlaster 16". The instrument: keyboard and pointer notes, bank and preset selection, velocity, demo, stop, panic, MIDI, RMI and MUS files in the player, a Brotli-compressed WOPL file and the return to the game's bank, a Brotli-compressed SF2 file, a rejected SF2 keeping the loaded one, a stub Web MIDI keyboard lighting its key and moving the scope, the recording's WAV downloads on both engines, starting over, the scope flat while only the player sounds, and malformed-file recovery. |
| Source node | With the output gain at 0, `source` still carried the note (RMS 0.032) while `output` was silent. |
| Lifecycle and errors | Queue overflow, a missing preset, an FM bank out of range, a percussion preset outside channel 10, a playback rate out of range, repeated disposal, caller-context preservation and owned-context closure passed. |
| Layout | The Matrix rain and the cover on its CRT shader drew (defuss-shadcn's `data-ready`), the rain sped up with the music, the sleeves carry their years, the text is set in VT323, and the footer has no API notes. A full-page desktop screenshot, the 390 px phone layout per section (player, crates, synth) and the visualizer were captured; the phone document has no horizontal overflow. |

Reproduce with `make verify` and `make wasm`; their reports, renders and screenshots go to `output/`.

### Throughput, 0.3.0

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

### Scope, 0.3.0

UNKNOWN: Safari and Firefox behavior, physical MIDI-device input, and `make wasm-docker` (not run for this release). `fm-synth.wasm` uses WebAssembly SIMD, which browsers have supported since Chrome 91, Firefox 89 and Safari 16.4. TinySoundFont implements neither reverb, chorus, SoundFont modulators nor aftertouch, so files that rely on them sound drier than on a full GS or XG synthesizer. SoundFont and file parsing run on the worklet thread and can interrupt audio; load them between playback operations.

HYPOTHESIS: in one of nine Chromium runs, the worklet received a `currentFrame` below the frames it had already rendered, and the instance stopped. The worklet now passes the later of the two frames. A probe that counted such quanta found none in three later runs, and seven runs since the change passed; a repeat with that probe in place would confirm or refute the cause.
