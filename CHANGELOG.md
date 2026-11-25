# Changelog

## 0.4.0 (not released)

Not released: the Roland and AWE profiles have not yet played real ROMs, and that run is pending.

- Ten hardware profiles: `soundfont`, `sb16-opl3`, `sb16-cqm`, `awe32`, `awe64`, `sb-pci128`, `gus-gf1`, `roland-sc55`, `roland-sc55mk2` and `roland-mt32`. Options `profile` and `profileSources`, `useProfile(profile, sources?)` on both facades, `info.profile`, and the exports `SYNTH_PROFILES` and `PROFILE_DESCRIPTORS`, whose `availability` and `userAssets` say what the package ships and what the user supplies. `sb16-opl3` is libADLMIDI on one OPL3 chip at the level of `fm`; the legacy `fm` engine stays, beside the profiles.
- Native cores behind one ABI (version 2, `native/profiles/profile_pack.h`), one isolated WebAssembly reactor each, resampled to the output rate by `NativeClock`: Nuked CQM under libADLMIDI, an ECW reconstruction, an UltraMID reconstruction on GUSEMU32's GF1 mixer, SoundCarcass for the SC-55 and SC-55mkII, Munt for the MT-32, and AWE32Emu for the AWE32 and AWE64, built only locally. The package ships every core but AWE in `dist/assets/profiles/`.
- Packs (`.dspack`, DSPK v1) carry a profile's ROMs, wavesets or patches. `scripts/profile-assets.py` makes them and fetches the ECW wavesets and Gravis patches pinned by SHA-256; `scripts/fetch-roms.py` checks ROMs you supply against `scripts/roms/<profile>.json`. `scripts/build-native-profiles.py` and `scripts/build-vintage-wasm.py` build the cores; `scripts/profile-*-test.mjs` test them with private assets.
- System exclusive messages: a `sysex` event, which `schedule` and `send` take; `sendMidi` passes on each complete SysEx; files play their SysEx (F0, divided F7 continuations, F7 escapes) at their frames. A seek or an engine switch replays them in file order after the reset. Each engine gets the original bytes; up to 16 MiB wait in the queue. `fm-synth.wasm` gains `fm_sysex`, and its FFh reset sends XG System On, so a GM or GS mode set before is undone too.
- `setFmBank`, `loadFmBank` and `fmBank` apply to every loaded FM engine: `fm`, `sb16-opl3` and `sb16-cqm`. `fm` and `sb16-opl3` share one download and compile of `fm-synth.wasm`.
- `MidiParser` drops a SysEx longer than 65,536 bytes whole instead of cutting it, and gains `cancel()`; `isReset` matches GM2 System On too.
- A seek, an engine switch or a bank change replays each channel's final state (its last program, pitch bend, channel pressure and controller values) and every SysEx, reset, bank select, RPN, NRPN, data entry and channel mode message, instead of every earlier message. `status().dropped` and `OfflineSynth.dropped` count the messages an engine's input could not take. A MIDI file may hold at most 65,536 SysEx messages.
- Fixed: a file's reset left its held notes held, so an engine switch struck them again.
- The demo has three engine buttons (Sound Blaster 16 with OPL3, with CQM, and SoundFont), the CQM on the game banks, and a list of the profiles that need the user's files, which asks for a pack, keeps it on the device and renders WAV downloads with it.
- The package holds the profile build scripts and the Munt and Nuked CQM source archives (`vendor/sources/`).

## 0.3.0

- Added a second engine: libADLMIDI 1.6.2 on emulated OPL3 chips (Nuked OPL3 fast), `fm-synth.wasm`, with 79 embedded banks and WOPL loading. Options `engine`, `chips` and `fmBank`; methods `useEngine`, `setFmBank`, `loadFmBank`; `info.kind`, `info.engines` and `info.fm`.
- A block renderer for the OPL3 chip that produces the per-sample chip's output exactly, 1.7 times faster on 1 chip and 4.6 times on 4 chips (Doom's E1M1, `make bench`); `make wasm` checks the equality with a register fuzz and game files.
- Switching engines or FM banks keeps a playing file's position, programs, controllers and held notes.
- `setPlaybackRate` (0.25 to 4) and `rate` in `status()`; `source`, the signal before the output gain.
- `onProgress` reports each download and decompression; the Brotli decoder runs in steps and yields between them. `OfflineSynth.loadMidi` and `play` render files.
- `loadMidi(bytes, { tempo })` scales a file's clock, for files converted at a wrong one (Raptor's 70 Hz music in files with Doom's 140 Hz).
- SoundFonts and WOPL banks load Brotli-compressed, unpacked by defuss-brotli's bundled decoder; TimGM6mb ships as `TimGM6mb.sf2.br` (5.2 MB instead of 6.0). `OfflineSynth.loadSoundFont(source)`. `bun run compress` compresses every soundbank.
- The SoundFont engine plays at -6 dB, so TimGM6mb no longer clips on dense game files; the FM engine's level matches it.
- The demo page has a music player for the 34 albums of game music in `docs/music/index.json` (written by `scripts/index-music.mjs`) built on defuss-shadcn, redesigned as a DOS screen over Matrix rain (pixel fonts, the cover on a CRT tube, pixelated sleeves in crates), with the Bergium visualizer; it labels the engines "Gravis Ultrasound" (FM) and "SoundBlaster 16" (SoundFont), starts on the FM engine with Bergium's Butterchurn rotating through 14 presets, plays Jazz Jackrabbit, Jazz Jackrabbit 2 and The Settlers II on the SoundBlaster 16, and its SoundFont engine plays the OPL-3 FM 128M SoundFont. It has a progress bar, WAV downloads of every track and of what was played on the keys or a Web MIDI keyboard, Web MIDI input, and a list of the FM banks.

## 0.2.0

- Replaced the OPL3 engine (libADLMIDI with Nuked-OPL3) with a General MIDI SoundFont synthesizer: TinySoundFont 0.9 in a standalone 51 KB WebAssembly module.
- Bundled TimGM6mb, a General MIDI SoundFont with 128 programs and 8 drum kits; `soundfont` and `loadSoundFont` take any SF2 file.
- Added `info.presets`, `selectPreset` (any bank and program on any channel), `reset`, `sendMidi` for MIDI byte streams with running status, and the sounding voice count in `status()`.
- MIDI file playback now parses Standard MIDI Files (formats 0 and 1, tempo maps, SMPTE division), RMI and MUS in TypeScript; seeking replays program changes and controllers before the target.
- Renders split at a 64-frame grid, so block sizes that are multiples of 64 give identical PCM.
- Default output gain is 1.
- Removed: `chips`, `bank`, `emulator`, `setBank`, `loadBank` (WOPL), `writeOPL`, `reserveChannels` and the `oplWrite` event.

## 0.1.0

- Initial TypeScript browser and offline APIs for OPL3 MIDI synthesis.
- Built Nuked-OPL3-fast 1.8-fast.3 with libADLMIDI 1.6.2 and a matching reference core.
- Added bounded sample-frame scheduling, raw-register events, MIDI transport, WOPL loading and WAV encoding.
- Added a static browser instrument, source archives, rebuild tooling and verification scripts.
