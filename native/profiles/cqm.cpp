/* SPDX-License-Identifier: GPL-3.0-or-later
 * sb16-cqm (profile 2): General MIDI through libADLMIDI (../adlmidi, GPL-3.0-or-later) on one emulated Creative CQM
 * (CT1978) FM chip, the Nuked CQM core of 86Box (LGPL-2.1-or-later), behind the ABI 2 of profile_pack.h. The chip
 * replaces libADLMIDI's Nuked OPL3 adapter (cqm_adlmidi.cpp); scripts/build-native-profiles.py (cqm) builds both.
 *
 * Assets: no DSPK pack plays libADLMIDI's embedded bank 0. A DSPK v1 pack for model 2 holds exactly one record:
 *   role 32: a WOPL bank file (libADLMIDI's format), which replaces the instruments and brings its volume model;
 *   role 33: 4 bytes, u32 LE, the number of an embedded bank as numbered in libADLMIDI's banks.ini (0 .. count - 1).
 * Any other record, both records, or a bank libADLMIDI rejects make profile_init return 0.
 *
 * Power-on state is a new libADLMIDI player on one new chip with the configured instruments: profile_init makes it,
 * and profile_message(0xFF) and the GM, GM2, GS and XG reset SysEx messages make it again, so what follows a reset
 * renders as on a new instance. Rendering calls only adl_generateFormat into static memory. */
#include "profile_pack.h"
#include "adlmidi.h"

enum { CQM_MODEL = 2, CQM_RATE = 49716, CQM_CHANNELS = 18 }; /* one chip: 18 two-operator channels */

static ADL_MIDIPlayer *player;
static uint8_t *asset;
static uint32_t asset_size;
static const uint8_t *wopl; /* inside asset */
static uint32_t wopl_size, bank;
static float out[PROFILE_BLOCK * 2];
static uint8_t sysex[PROFILE_SYSEX_MAX];
static char describe[CQM_CHANNELS + 1], describe_attr[CQM_CHANNELS + 1];
static const ADLMIDI_AudioFormat format = {ADLMIDI_SampleType_F32, 4, 4}; /* planar float: left block, then right */

static void stop() {
    if (player) adl_close(player);
    player = nullptr;
}

/* The power-on state; 1, or 0 when libADLMIDI rejects the setup (no player is left then). libADLMIDI's emulator id
 * NUKED_FAST is the class cqm_adlmidi.cpp implements with the CQM core: this build compiles no other chip. */
static uint32_t start() {
    stop();
    player = adl_init(CQM_RATE);
    if (!player || adl_switchEmulator(player, ADLMIDI_EMU_NUKED_FAST) || adl_setNumChips(player, 1) ||
        (wopl ? adl_openBankData(player, wopl, wopl_size) : adl_setBank(player, (int)bank))) {
        stop();
        return 0;
    }
    return 1;
}

extern "C" {
PROFILE_EXPORT uint32_t profile_abi() { return PROFILE_ABI; }
PROFILE_EXPORT uint32_t profile_model() { return CQM_MODEL; }
PROFILE_EXPORT void profile_close() {
    stop();
    free(asset);
    asset = nullptr;
    asset_size = 0;
    wopl = nullptr;
}
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (player || !n || n > PROFILE_MAX_ASSET) return nullptr;
    free(asset);
    asset = (uint8_t *)malloc(n);
    asset_size = asset ? n : 0;
    return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    if (player || n != asset_size) return 0;
    wopl = nullptr;
    wopl_size = bank = 0;
    if (n) {
        profile_record r[64];
        if (!profile_parse(asset, n, CQM_MODEL, r) || !r[32].size == !r[33].size) return 0;
        for (unsigned i = 1; i < 64; i++)
            if (i != 32 && i != 33 && r[i].size) return 0;
        if (r[33].size) {
            if (r[33].size != 4 || (bank = profile_le32(r[33].data)) >= (uint32_t)adl_getBanksCount()) return 0;
        } else {
            wopl = r[32].data;
            wopl_size = r[32].size;
        }
    }
    return start();
}
PROFILE_EXPORT uint32_t profile_rate() { return CQM_RATE; } /* 86Box clocks CQM_Generate at 49716 Hz */
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!player) return 0;
    if (s == 0xff) return start();
    if (s < 0x80 || s > 0xef || a > 127 || b > 127) return 0;
    const ADL_UInt8 ch = (ADL_UInt8)(s & 15), x = (ADL_UInt8)a, y = (ADL_UInt8)b;
    switch (s & 0xf0) {
        case 0x80: adl_rt_noteOff(player, ch, x); break;
        case 0x90: if (y) adl_rt_noteOn(player, ch, x, y); else adl_rt_noteOff(player, ch, x); break;
        case 0xa0: adl_rt_noteAfterTouch(player, ch, x, y); break;
        case 0xb0: adl_rt_controllerChange(player, ch, x, y); break;
        case 0xc0: adl_rt_patchChange(player, ch, x); break;
        case 0xd0: adl_rt_channelAfterTouch(player, ch, x); break;
        default: adl_rt_pitchBendML(player, ch, y, x); break;
    }
    return 1;
}
PROFILE_EXPORT uint8_t *profile_sysex_buffer() { return sysex; }
/* A reset message first restores the power-on state; libADLMIDI then reads every message itself (GM, GS and XG
 * mode, master volume, GS percussion channels) and ignores the rest, which counts as deliberately ignored. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n) {
    if (!player || !profile_sysex_valid(sysex, n)) return 0;
    if (profile_sysex_is_reset(sysex, n) && !start()) return 0;
    adl_rt_systemExclusive(player, sysex, n);
    return 1;
}
PROFILE_EXPORT float *profile_render(uint32_t n) {
    if (!player || n > PROFILE_BLOCK) return nullptr;
    if (n) adl_generateFormat(player, (int)n * 2, (ADL_UInt8 *)out, (ADL_UInt8 *)(out + n), &format);
    return out;
}
/* The chip channels notes hold now; a 4-operator voice counts its two channels. */
PROFILE_EXPORT int32_t profile_voices() {
    int32_t count = 0;
    if (!player) return 0;
    adl_describeChannels(player, describe, describe_attr, sizeof describe);
    for (const char *c = describe; *c; c++) count += *c != '-';
    return count;
}
}
