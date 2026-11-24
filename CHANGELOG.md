# Changelog

## 0.3.0

- Added a second engine: libADLMIDI 1.6.2 on emulated OPL3 chips (Nuked OPL3 fast), `fm-synth.wasm`, with 79 embedded banks and WOPL loading. Options `engine`, `chips` and `fmBank`; methods `useEngine`, `setFmBank`, `loadFmBank`; `info.kind`, `info.engines` and `info.fm`.
- A block renderer for the OPL3 chip that produces the per-sample chip's output exactly, 1.7 times faster on 1 chip and 4.6 times on 4 chips (Doom's E1M1, `make bench`); `make wasm` checks the equality with a register fuzz and game files.
- Switching engines or FM banks keeps a playing file's position, programs, controllers and held notes.
- `setPlaybackRate` (0.25 to 4) and `rate` in `status()`; `source`, the signal before the output gain.
- `onProgress` reports each download and decompression; the Brotli decoder runs in steps and yields between them. `OfflineSynth.loadMidi` and `play` render files.
- `loadMidi(bytes, { tempo })` scales a file's clock, for files converted at a wrong one (Raptor's 70 Hz music in files with Doom's 140 Hz).
- SoundFonts and WOPL banks load Brotli-compressed, unpacked by defuss-brotli's bundled decoder; TimGM6mb ships as `TimGM6mb.sf2.br` (5.2 MB instead of 6.0). `OfflineSynth.loadSoundFont(source)`. `bun run compress` compresses every soundbank.
- The SoundFont engine plays at -6 dB, so TimGM6mb no longer clips on dense game files; the FM engine's level matches it.
- The demo page has a music player for 29 game soundtracks (`docs/music/index.json`, written by `scripts/index-music.mjs`) built on defuss-shadcn, redesigned as a DOS screen over Matrix rain (pixel fonts, the cover on a CRT tube, pixelated sleeves in crates), with the Bergium visualizer; it labels the engines "Gravis Ultrasound" (FM) and "SoundBlaster 16" (SoundFont), starts on the FM engine with Bergium's Butterchurn rotating through 14 presets, and its SoundFont engine plays the OPL-3 FM 128M SoundFont. It has a progress bar, WAV downloads of every track and of what was played on the keys or a Web MIDI keyboard, Web MIDI input, and a list of the FM banks.

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
