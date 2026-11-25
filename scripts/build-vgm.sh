#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
emcc -O3 -DNDEBUG -Wno-static-in-inline --no-entry native/vgm-opl.c \
  native/adlmidi/src/chips/nuked_fast/nukedopl3_fast.c -sSTANDALONE_WASM=1 \
  -sFILESYSTEM=0 -sEXPORTED_FUNCTIONS=_vgm_reset,_vgm_write,_vgm_render \
  -o docs/soundcards/vgm-opl.wasm
