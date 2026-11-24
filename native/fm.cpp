/* defuss-midi-synth's OPL3 FM synthesizer: a standalone WebAssembly module (fm-synth.wasm) that plays MIDI channel
 * messages through libADLMIDI (adlmidi/, GPL-3.0-or-later with LGPL-2.1-or-later and MIT parts, its notices at the
 * head of each file) on emulated Yamaha YMF262 chips (Nuked OPL3 fast, adlmidi/src/chips/nuked_fast, LGPL-2.1+).
 * It knows nothing of time or byte streams: src/engine.ts dispatches complete messages between render calls, so
 * every message acts at its own output frame, as with midi-synth.wasm (synth.c), whose ABI this one follows.
 * Why libADLMIDI: it carries the voice allocation, the 4-operator and rhythm-mode handling, the volume models of the
 * DOS sound drivers (DMX, Apogee, AIL, HMI, Win9x) and the 79 instrument banks of their games, which together make a
 * General MIDI file sound as the game played it on an OPL3 card. */

#include "adlmidi.h"

#include <stdint.h>
#include <stdlib.h>

#define FM_EXPORT extern "C" __attribute__((used, visibility("default")))

enum {
  FM_BLOCK = 128,     /* the most frames one render call writes: the AudioWorklet's render quantum */
  FM_CHANNELS = 16,
  FM_MAX_CHIPS = 100, /* libADLMIDI's own limit */
  FM_DESCRIBE = 18 * FM_MAX_CHIPS + 1,
};

static ADL_MIDIPlayer *player;
static float fm_out[FM_BLOCK * 2];
static char fm_describe[FM_DESCRIBE], fm_describe_attr[FM_DESCRIBE];
static void *fm_bank_data;
/* Float samples, each in its own 4-byte cell, so a render of n frames writes the left block and then the right. */
static const ADLMIDI_AudioFormat fm_format = {ADLMIDI_SampleType_F32, 4, 4};

/* Creates the synthesizer at rate (8000 to 192000 Hz) with chips emulated OPL3 chips (1 to 100) and the embedded
 * bank of banks.ini's number bank, after closing an earlier one. Every channel starts in its General MIDI state.
 * Returns 1, or 0 when libADLMIDI rejects an argument (no synthesizer is left then). */
FM_EXPORT uint32_t fm_init(uint32_t rate, uint32_t chips, uint32_t bank) {
  if (player)
    adl_close(player);
  player = adl_init((long)rate);
  if (!player)
    return 0;
  if (adl_switchEmulator(player, ADLMIDI_EMU_NUKED_FAST) || adl_setNumChips(player, (int)chips) ||
      adl_setBank(player, (int)bank)) {
    adl_close(player);
    player = 0;
    return 0;
  }
  return 1;
}

/* Selects the embedded bank of banks.ini's number bank (0 to fm_bank_count() - 1) for every channel; the volume
 * model follows the bank. Returns 1, or 0 for a bank that does not exist (the loaded bank stays). */
FM_EXPORT uint32_t fm_set_bank(uint32_t bank) {
  return player && bank < (uint32_t)adl_getBanksCount() && adl_setBank(player, (int)bank) == 0 ? 1u : 0u;
}

/* Allocates bytes in the module's memory for a WOPL bank file that the engine copies in before fm_load_bank, after
 * freeing the previous one; 0 when it cannot. */
FM_EXPORT void *fm_buffer(uint32_t bytes) {
  free(fm_bank_data);
  fm_bank_data = malloc(bytes ? bytes : 1);
  return fm_bank_data;
}

/* Replaces the instruments with the WOPL bank file of bytes at data (fm_buffer's memory). Returns 1, or 0 when it is
 * not a WOPL file libADLMIDI reads; libADLMIDI then keeps the instruments it had. */
FM_EXPORT uint32_t fm_load_bank(const void *data, uint32_t bytes) {
  return player && adl_openBankData(player, data, bytes) == 0 ? 1u : 0u;
}

/* Plays one complete MIDI message: note off (8n), note on (9n, velocity 0 is note off), key pressure (An), control
 * change (Bn), program change (Cn), channel pressure (Dn) and pitch bend (En, data1 the low 7 bits). Channel 10 holds
 * the percussion, as in General MIDI. FFh resets every channel to its General MIDI state and silences every voice.
 * Does nothing before fm_init. */
FM_EXPORT void fm_message(uint32_t status, uint32_t data1, uint32_t data2) {
  ADL_UInt8 channel = (ADL_UInt8)(status & 0x0fu), a = (ADL_UInt8)data1, b = (ADL_UInt8)data2;
  if (!player)
    return;
  if (status == 0xffu) {
    adl_panic(player);
    adl_rt_resetState(player);
    return;
  }
  switch (status & 0xf0u) {
    case 0x80: adl_rt_noteOff(player, channel, a); break;
    case 0x90:
      if (b)
        adl_rt_noteOn(player, channel, a, b);
      else
        adl_rt_noteOff(player, channel, a);
      break;
    case 0xa0: adl_rt_noteAfterTouch(player, channel, a, b); break;
    case 0xb0: adl_rt_controllerChange(player, channel, a, b); break;
    case 0xc0: adl_rt_patchChange(player, channel, a); break;
    case 0xd0: adl_rt_channelAfterTouch(player, channel, a); break;
    case 0xe0: adl_rt_pitchBendML(player, channel, b, a); break;
    default: break;
  }
}

/* Renders frames (at most FM_BLOCK, an even count) of planar float PCM: the left block at the returned address, the
 * right block frames floats after it. frames 0 renders nothing and returns the address, which stays the same for the
 * module's life. Silence before fm_init. */
FM_EXPORT float *fm_render(uint32_t frames) {
  if (frames > FM_BLOCK)
    frames = FM_BLOCK;
  if (!frames)
    return fm_out;
  if (!player) {
    for (uint32_t i = 0; i < frames * 2; i++)
      fm_out[i] = 0.0f;
    return fm_out;
  }
  adl_generateFormat(player, (int)frames * 2, (ADL_UInt8 *)fm_out, (ADL_UInt8 *)(fm_out + frames), &fm_format);
  return fm_out;
}

/* The chip channels a note holds now (a 4-operator voice counts its two channels). */
FM_EXPORT uint32_t fm_voices(void) {
  uint32_t count = 0;
  if (!player)
    return 0;
  adl_describeChannels(player, fm_describe, fm_describe_attr, sizeof fm_describe);
  for (const char *c = fm_describe; *c; c++)
    count += *c != '-';
  return count;
}

/* The chips libADLMIDI emulates, 0 before fm_init. */
FM_EXPORT uint32_t fm_chips(void) { return player ? (uint32_t)adl_getNumChipsObtained(player) : 0u; }

/* The number of embedded banks, numbered as in banks.ini. */
FM_EXPORT uint32_t fm_bank_count(void) { return (uint32_t)adl_getBanksCount(); }

/* The name of embedded bank index as a NUL-terminated string, 0 for an index past the last. */
FM_EXPORT const char *fm_bank_name(uint32_t index) {
  return index < (uint32_t)adl_getBanksCount() ? adl_getBankNames()[index] : 0;
}
