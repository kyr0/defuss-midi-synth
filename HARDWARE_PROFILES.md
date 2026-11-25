# Hardware profiles — 0.4.0 integration R2

Base: kyr0/defuss-midi-synth `35a89d7af5623e69c35ac0c214bb2c551586f8c0`.

| Profile | Core | Verification |
|---|---|---|
| soundfont | TinySoundFont | Original WASM, playback tested |
| sb16-opl3 | libADLMIDI / one Nuked OPL3 | Original WASM, playback tested |
| sb16-cqm | libADLMIDI / Nuked CQM | Pinned native adapter and build recipe; not compiled |
| awe32 | AWE32Emu / measured 86Box EMU8000 | Pinned adapter, local build only; not compiled |
| awe64 | Same EMU8000, 32 hardware voices | Pinned adapter, local build only; not compiled |
| sb-pci128 | Native ECW reconstruction | Compiled WASM; synthetic ECW playback tested |
| gus-gf1 | GUSEMU32 GF1 register mixer + reconstructed PAT MIDI driver | Compiled WASM; synthetic PAT playback tested |
| roland-sc55 | SoundCarcass | Pinned adapter and build recipe; not compiled |
| roland-sc55mk2 | SoundCarcass | Pinned adapter and build recipe; not compiled |
| roland-mt32 | Munt | Pinned adapter and build recipe; not compiled |

No placeholder external-core entries remain. No profile silently maps to a generic SF2 engine. `fm` remains an independent legacy multichip mode. Authentic sound still depends on actual banks, driver behavior, timing, analog path and hardware comparisons. ECW and GF1 are experimental reconstructions, not bit-perfect original-driver emulation.

## PCI128 — native ECW, not SF2

- `native/profiles/pci128.c` directly parses ECLW bank/drum maps, instrument regions and layers, patches, lookup tables, sample headers and original signed 16-bit waveform data. Supports native sample loops, interpolation, tuning, pitch bend, CC, sustain, program/drum selection, exclusive groups, volume/pitch envelopes and vibrato. Internal synthesis clock 22,050 Hz; 256-frame envelope/control clock; five pan positions; cap 64 voices (chosen, not verified original polyphony).
- The [public-domain ecw2sfz r3 decoder](https://sourceforge.net/p/ecw2sfz/code/3/tree/trunk/MIDI/ECW.pm) was used as a decoding reference. The actual upstream Perl code is fetched using `fetch-ecw-reference`; `verify-ecw-reference` executes it and compares extracted sample bytes. The decoder itself is not a renderer. C port follows its field interpretation, with bounded parsing. The [ECW specification 1.5](https://web.archive.org/web/20160618082953if_/http://johnengelmann.net/technology/ecw/ecw.txt) provides the format documentation. The [SF2ECW 1.0a post](https://www.tgames.fr/en/pc/progs-pc/sf2ecw-v1-0a-convert-any-sf2-soundfont-to-ecw-creative-ensoniq-sound-blaster-soundfonts-t12238.html) supplied published reverse-engineering constraints for the DOS synthesis path; its member-gated converter was not accessible, so its code was not incorporated. No proprietary Creative driver code is included.
- Original bank downloads are listed in [EMAC OEM driver archive](https://ftp.emacinc.com/LegacyProducts/SBC/pcm-5896/Drivers/sound/AUDIO/ENGLISH/WIN95DRV/). Expected original file lengths are 2,259,070 / 4,986,999 / 8,292,462 bytes, as independently listed [here](https://flaterco.com/kb/audio/Semi_MIDI_DOS.html). No bank bytes were downloaded in the development container. Download locally; use official driver media if mirror fails. First-use lock is a record of downloaded bytes, not independent authentication; `--lock` accepts a prior trusted hash lock. The packs contain the unmodified original ECW bytes.

```sh
python3 scripts/profile-assets.py fetch-ecw profile-assets/ecw
python3 scripts/profile-assets.py fetch-ecw-reference profile-assets/reference
python3 scripts/profile-assets.py verify-ecw-reference profile-assets/reference/ecw2sfz-r3 profile-assets/ecw
node scripts/smoke-ecw.mjs profile-assets/ecw
```

Offline import of existing bank:

```sh
python3 scripts/profile-assets.py pack sb-pci128 profile-assets/EAPCI8M.ECW.dspack 32=/path/to/EAPCI8M.ECW
```

The ECW runtime uses `profileSources['sb-pci128'].assets` to choose one of the three packs. Do not hot-swap banks of a live module; create a fresh synth to change waveset. The demo's default file is `assets/profiles/sb-pci128.dspack`.

Known ECW limitations: exact proprietary envelope/tuning/gain/velocity transfer functions, wavetable envelopes, loop flag ≥129 displacement, effect behavior, Windows driver variants and real-card fidelity are not established. The 22.05 kHz DOS model is not a measured Windows PCI128 driver. The actual bank smoke test reports silent programs; it is a functional check, not fidelity verification.

## Gravis UltraSound — GF1

`gf1_mixer.h` adapts the MIT-licensed GUSEMU32 mixer (Tibor Schütz) from [QEMU](https://github.com/qemu/qemu/blob/6bf90d4fc5027567cb704d7888f5ec792b4ed75a/hw/audio/gusemu_mixer.c): GF1 address wiring, register frequency, logarithmic volume, fractional sample position, four-bit pan, loops and volume ramp. The new MIDI driver loads original GF1PATCH110 `.PAT` samples into 1 MiB emulated DRAM, handles sample selection and cache eviction, and uses 14–32 voices with rate = floor(617400 / voices). It does not run original UltraMID x86 code. Envelope/ramp mapping, original allocation policy and analog model require validation.

```sh
python3 scripts/profile-assets.py fetch-gus profile-assets/gus --memory 1024 --voices 32
```

Downloads the original INI and mapped PAT files, using the pinned [darker-cpp SHA256 manifest](https://github.com/Lost-Engines/darker-cpp/blob/4d8e73863859c2b5d5b655ac3e031ccdb25c4aee/scripts/gravis.sha256). `--memory` chooses the original patch substitution table, not a physical RAM-size change; emulated RAM is always 1 MiB. For user-owned files, `pack-gus` accepts JSON mapping decimal program (0..127) or 128+drum-note to relative `.PAT` file names.

## AWE32/AWE64

The source recipe fetches [AWE32Emu](https://github.com/turican0/AWE32Emu/tree/17b0578fe59909dfaa784b5531d6d1a3a80729ce) and integrates its `Synth`, `SoundFont`, and measured 86Box EMU8000 core. The file readers are patched to use in-memory ROM and bank records. Driver profile selects Win95, DOS or SDK. Both profiles have 32 hardware voices; AWE64's additional software voices are not emulated. Default RAM 512/4096 KiB, configurable. The upstream reconstructed driver license is undecided; this archive contains the integration adapter, not upstream unlicensed driver files or derived binary. Build only locally for evaluation after checking applicable rights. Do not distribute without license resolution.

```sh
python3 scripts/build-native-profiles.py --local-awe awe32 awe64
python3 scripts/profile-assets.py fetch-awe-rom profile-assets/awe32.raw
python3 scripts/profile-assets.py pack-awe awe32 profile-assets/awe32.raw /path/to/SYNTHGM.SBK profile-assets/awe32.dspack --driver win95 --rom-only
```

`--rom-only` means the supplied bank maps samples already present in ROM; omit for RAM-uploading banks. `--user-bank` adds an optional RAM bank. Build outputs are isolated in `profile-assets/local-builds/`. Supply via `profileSources`; for private local demo testing copy manually after build. Do not publish them. The adapter has not been compiled or exercised with AWE assets.

## Other backends

`build-native-profiles.py` pins [86Box CQM](https://github.com/86Box/86Box/tree/141ae59ca07f63267384ea12024bc51e2371b49b), [SoundCarcass](https://github.com/superctr/sound-carcass/tree/6adfa172ccf59bd14fcd581601d3c64669cb0935) and [Munt](https://github.com/munt/munt/tree/f5b968c4faf180c7e687346a4e0ad426eee5f2af). Build with Emscripten SDK 4.0.10, CMake, Git, Node and Python 3. CQM uses embedded libADLMIDI banks; optional WOPL role 32. Roland requires original matching ROMs; SC-55/SC-55mkII boot/program plus descrambled wave (role 3) or raw wave chips (16..23) in the upstream required order. MT-32: control/PCM (1/2). Use `profile-assets.py fetch URL DEST --sha256 HASH` for independently verified authorized assets. No generic substitute or automatic download of unverified ROM variants.

```sh
python3 scripts/build-native-profiles.py sb16-cqm roland-sc55 roland-sc55mk2 roland-mt32
python3 scripts/profile-assets.py pack roland-mt32 profile-assets/roland-mt32.dspack 1=profile-assets/MT32_CONTROL.ROM 2=profile-assets/MT32_PCM.ROM
```

These adapters are not compiled here. Existing scheduler discards arbitrary SysEx and collapses reset variants; this is particularly limiting for MT-32 and GS. Firmware boot cost inside AudioWorklet is untested. Public redistribution must comply with all respective core licenses and corresponding-source/relink obligations. ROMs and banks remain private local assets.

## API and local demo

Browser/offline facades accept `profile` or legacy `engine`, not conflicting values. `useProfile` switches the active engine. Profile-specific WASM and asset URLs or bytes can override defaults.

```ts
import { MidiSynth } from 'defuss-midi-synth';
const synth = await MidiSynth.create({
  profile: 'sb-pci128',
  profileSources: {
    'sb-pci128': { assets: '/private/EAPCI8M.ECW.dspack' },
  },
});
await synth.useProfile('sb16-opl3');
```

After `make build`, the normal build stages CQM/Roland/ECW/GF1 WASM and notices if present. Private packs are not automatically copied. For a private local website, copy the chosen ECW pack to `docs/synth/assets/profiles/sb-pci128.dspack`, GUS pack to `docs/synth/assets/profiles/gus-gf1.dspack`, and any other matching packs to `<id>.dspack`; for AWE also copy local WASM. Ensure these paths are never published. `dist/assets/profiles/` is the corresponding package runtime path. The ten hardware labels are shown; unbuilt or missing-asset profiles reject visibly.

## ABI and validation

One isolated WASM32 reactor per engine; native rate, shared integer-phase causal linear resampler, common scheduler. `profile_abi()` -> 1, `profile_model()` -> ID, `profile_buffer(bytes)` -> ptr, `profile_init(bytes)` -> 1, `profile_rate()` -> Hz, `profile_message(status,a,b)` -> 1, `profile_render(n)` -> planar Float32 left[n], right[n] (n <= 128), `profile_voices()` -> count or -1, `profile_close()`. No arbitrary host access. ECW/GF1 WASM binaries have zero imports. Native ABI accepts channel messages and FF reset only.

DSPK v1: `DSPK`, u32 LE version, model, record count, repeated u32 LE role, length and raw bytes; max 128 MiB. Role 1/2 boot/program or control/PCM, 3 wave ROM, 16..23 raw chips, 32 bank, 33 config, 34 optional AWE user bank. No duplicate roles or trailing bytes. GPAT is a nested bundle of indexed unmodified PAT records.

Build reproducibility: `python3 scripts/build-vintage-wasm.py` uses LLVM clang/wasm-ld; full upstream Emscripten optional builds require network and the SDK. Run the complete upstream suite, all real-bank/ROM tests, native-vs-WASM parity, SysEx upgrade, browser E2E, and hardware comparison before release. This is a development integration, not a finished release.
