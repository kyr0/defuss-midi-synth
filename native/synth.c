/* defuss-midi-synth's General MIDI synthesizer: a standalone WebAssembly module (midi-synth.wasm) that plays MIDI
 * channel messages through TinySoundFont (tsf.h, MIT, its notice at its head) from a SoundFont 2 file.
 * It knows nothing of time or byte streams: src/engine.ts dispatches complete messages between render calls, so
 * every message acts at its own output frame.
 * Why a module without glue: it imports only emscripten_notify_memory_growth, so an AudioWorklet, Node and Bun
 * instantiate the same bytes with one import object (src/engine.ts, SYNTH_IMPORTS).
 * Why planar output: TSF_STEREO_UNWEAVED writes the left block then the right block, so the engine copies each
 * channel with one typed-array set instead of de-interleaving per sample. */

#define TSF_NO_STDIO
#define TSF_IMPLEMENTATION
#include "tsf.h"

#include <stdint.h>

#define SYNTH_EXPORT __attribute__((used, visibility("default")))

enum {
  SYNTH_BLOCK = 128,        /* the most frames one render call writes: the AudioWorklet's render quantum */
  SYNTH_DRUMS = 9,          /* channel 10 of General MIDI, counted from 0 */
  SYNTH_CHANNELS = 16,
  SYNTH_GM_VOLUME = 100,    /* the channel volume (controller 7) at power-up and after a GM reset */
};

static tsf *synth;
static float synth_out[SYNTH_BLOCK * 2];

/* Puts every channel in its General MIDI state: program 1 of bank 0, the drum kit on channel 10, the controllers at
 * their defaults (reset all controllers) and the channel volume at 100, General MIDI's power-up value (TSF's reset
 * leaves 127), after silencing every voice at once. Creating all 16 channels here also keeps TSF from allocating a
 * channel during rendering. */
static void synth_gm_reset(void) {
  tsf_reset(synth);
  for (int channel = 0; channel < SYNTH_CHANNELS; channel++) {
    tsf_channel_midi_control(synth, channel, 121, 0);
    tsf_channel_midi_control(synth, channel, 7, SYNTH_GM_VOLUME);
    tsf_channel_set_presetnumber(synth, channel, 0, channel == SYNTH_DRUMS);
  }
}

/* Plays one complete MIDI message: note off (8n), note on (9n, velocity 0 is note off), control change (Bn; TSF keeps
 * volume, expression, pan, sustain, bank select, data entry for the pitch bend range and tuning RPNs, and the channel
 * modes 120, 121 and 123), program change (Cn, from the drum banks on channel 10) and pitch bend (En, 14 bits, data1
 * the low 7). Key and channel pressure (An, Dn) do nothing: TinySoundFont has no aftertouch. FFh resets the
 * synthesizer to the General MIDI state. Does nothing before synth_load. */
SYNTH_EXPORT void synth_message(uint32_t status, uint32_t data1, uint32_t data2) {
  int channel = (int)(status & 0x0fu);
  if (!synth)
    return;
  if (status == 0xffu) {
    synth_gm_reset();
    return;
  }
  switch (status & 0xf0u) {
    case 0x80: tsf_channel_note_off(synth, channel, (int)data1); break;
    case 0x90:
      if (data2)
        tsf_channel_note_on(synth, channel, (int)data1, (float)data2 / 127.0f);
      else
        tsf_channel_note_off(synth, channel, (int)data1);
      break;
    case 0xb0: tsf_channel_midi_control(synth, channel, (int)data1, (int)data2); break;
    case 0xc0: tsf_channel_set_presetnumber(synth, channel, (int)data1, channel == SYNTH_DRUMS); break;
    case 0xe0: tsf_channel_set_pitchwheel(synth, channel, (int)(data1 | data2 << 7)); break;
    default: break;
  }
}

/* Selects the preset of bank and program on channel directly, also a drum kit of bank 128 on a channel other than 10,
 * which a program change cannot reach. Returns 1, or 0 when the SoundFont has no such preset (the channel keeps its
 * preset) or nothing is loaded. */
SYNTH_EXPORT uint32_t synth_set_preset(uint32_t channel, uint32_t bank, uint32_t program) {
  if (!synth || channel >= SYNTH_CHANNELS)
    return 0;
  return tsf_channel_set_bank_preset(synth, (int)channel, (int)bank, (int)program) ? 1u : 0u;
}

/* Allocates bytes in the module's memory for the SoundFont that the engine copies in before synth_load; 0 when it
 * cannot. */
SYNTH_EXPORT void *synth_buffer(uint32_t bytes) {
  return malloc(bytes);
}

/* Loads the SoundFont of bytes at data (from synth_buffer, which it frees) for planar stereo output at rate frames
 * per second with the gain gain_db, preallocates max_voices voices when it is above 0 (TSF then never allocates
 * during note on and steals the voice furthest into its release), replaces the SoundFont loaded before and puts the
 * channels in their General MIDI state. Returns 1, or 0 for bytes that are no SoundFont or memory that runs out; the
 * SoundFont loaded before then stays. */
SYNTH_EXPORT uint32_t synth_load(void *data, uint32_t bytes, uint32_t rate, float gain_db, uint32_t max_voices) {
  tsf *loaded = tsf_load_memory(data, (int)bytes);
  free(data);
  if (!loaded)
    return 0;
  tsf_set_output(loaded, TSF_STEREO_UNWEAVED, (int)rate, gain_db);
  if (max_voices && !tsf_set_max_voices(loaded, (int)max_voices)) {
    tsf_close(loaded);
    return 0;
  }
  if (synth)
    tsf_close(synth);
  synth = loaded;
  synth_gm_reset();
  return 1;
}

/* Renders frames (at most 128) frames of the sounding voices, the left channel's frames followed by the right
 * channel's, and returns their address in the module's memory; silence before synth_load. */
SYNTH_EXPORT float *synth_render(uint32_t frames) {
  if (frames > SYNTH_BLOCK)
    frames = SYNTH_BLOCK;
  if (synth)
    tsf_render_float(synth, synth_out, (int)frames, 0);
  else
    memset(synth_out, 0, sizeof synth_out);
  return synth_out;
}

/* The voices that sound now: 0 when the synthesizer is silent, so the engine may skip rendering. */
SYNTH_EXPORT uint32_t synth_voices(void) {
  return synth ? (uint32_t)tsf_active_voice_count(synth) : 0u;
}

/* The presets of the loaded SoundFont: their count, and for preset index index (0 to count - 1) its bank, its program
 * number and the address of its name (at most 19 bytes, zero terminated; TSF terminates it). 0 for an index out of
 * range or before synth_load. */
SYNTH_EXPORT uint32_t synth_preset_count(void) {
  return synth ? (uint32_t)tsf_get_presetcount(synth) : 0u;
}

SYNTH_EXPORT uint32_t synth_preset_bank(uint32_t index) {
  return synth && index < (uint32_t)synth->presetNum ? synth->presets[index].bank : 0u;
}

SYNTH_EXPORT uint32_t synth_preset_program(uint32_t index) {
  return synth && index < (uint32_t)synth->presetNum ? synth->presets[index].preset : 0u;
}

SYNTH_EXPORT const char *synth_preset_name(uint32_t index) {
  return synth && index < (uint32_t)synth->presetNum ? synth->presets[index].presetName : 0;
}
