#!/usr/bin/env bash
# Builds the two standalone modules from native/ (no Emscripten JavaScript glue, one import each), checks their
# imports and exports, verifies the OPL3 block renderer against the per-sample chip, and records the new hashes:
# - vendor/runtime/midi-synth.wasm from native/synth.c and native/tsf.h (TinySoundFont);
# - vendor/runtime/fm-synth.wasm from native/fm.cpp and native/adlmidi/ (libADLMIDI on Nuked OPL3), with SIMD.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v emcc >/dev/null || { echo 'Put emcc on PATH first (or use make wasm-docker).'; exit 1; }
emcc --version | head -1
mkdir -p vendor/runtime tmp/fm-build
exports=_synth_buffer,_synth_load,_synth_message,_synth_set_preset,_synth_render,_synth_voices,_synth_preset_count,_synth_preset_bank,_synth_preset_program,_synth_preset_name
(cd native && emcc -O2 --no-entry synth.c -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 \
  -sFILESYSTEM=0 -sEXPORTED_FUNCTIONS="$exports" -o ../vendor/runtime/midi-synth.wasm)

# libADLMIDI without its file sequencer (src/midifile.ts parses files) and with Nuked OPL3 fast as its only chip.
A=native/adlmidi
FM_DEFINES=(-DNDEBUG -DADLMIDI_DISABLE_MIDI_SEQUENCER -DADLMIDI_DISABLE_DOSBOX_EMULATOR -DADLMIDI_DISABLE_OPAL_EMULATOR
  -DADLMIDI_DISABLE_JAVA_EMULATOR -DADLMIDI_DISABLE_ESFMU_EMULATOR -DADLMIDI_DISABLE_MAME_OPL2_EMULATOR
  -DADLMIDI_DISABLE_YMFM_EMULATOR -I"$A/include" -I"$A/src")
fm_exports=_fm_init,_fm_set_bank,_fm_buffer,_fm_load_bank,_fm_message,_fm_sysex_buffer,_fm_sysex,_fm_render,_fm_voices,_fm_chips,_fm_bank_count,_fm_bank_name
build_fm() { # output, extra flags...
  local out=$1; shift
  rm -f tmp/fm-build/*.o
  for f in "$A"/src/wopl/wopl_file.c "$A"/src/models/model_*.c "$A"/src/chips/nuked_fast/nukedopl3_fast.c; do
    emcc -O2 -msimd128 -Wno-static-in-inline "$@" "${FM_DEFINES[@]}" -c "$f" -o "tmp/fm-build/$(basename "$f").o"
  done
  for f in native/fm.cpp "$A"/src/adlmidi.cpp "$A"/src/adlmidi_load.cpp "$A"/src/adlmidi_midiplay.cpp \
    "$A"/src/adlmidi_opl3.cpp "$A"/src/adlmidi_private.cpp "$A"/src/inst_db.cpp "$A"/src/chips/nuked_opl3_fast.cpp; do
    em++ -std=c++14 -fno-exceptions -fno-rtti -O2 -msimd128 "$@" "${FM_DEFINES[@]}" -c "$f" -o "tmp/fm-build/$(basename "$f").o"
  done
  em++ -O2 -msimd128 -fno-exceptions tmp/fm-build/*.o --no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=16777216 -sFILESYSTEM=0 -sEXPORTED_FUNCTIONS="$fm_exports" -o "$out"
}
sh scripts/build-vgm.sh
build_fm vendor/runtime/fm-synth.wasm
node scripts/check-wasm.mjs

# The block renderer (native/adlmidi/src/chips/nuked_fast/nukedopl3_block.inc.c) must render what the per-sample
# chip renders: a register fuzz at the chip, then real game files through the whole module.
emcc -O2 -Wno-static-in-inline tests/opl3-block-test.c -o tmp/opl3-block-test.cjs
node tmp/opl3-block-test.cjs
build_fm tmp/fm-per-sample.wasm -DDEFUSS_OPL3_PER_SAMPLE
node --experimental-transform-types --no-warnings scripts/fm-parity.mjs vendor/runtime/fm-synth.wasm tmp/fm-per-sample.wasm
node scripts/integrity.mjs --write
