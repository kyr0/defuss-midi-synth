/* SPDX-License-Identifier: MIT
 * ABI 2 adapter for AWE32Emu (turican0/AWE32Emu, pinned in scripts/build-native-profiles.py). Its driver layer
 * (`Synth`: the SBAWE.VXD, SBAWE32.MDI and AWE32 SDK families) writes EMU8000 registers into the measured 86Box
 * EMU8000 core (`86box/snd_emu8k.c`, GPL-2.0-or-later). The upstream sources compile unmodified: they open the
 * ROM and the banks by path, and this file's fopen() resolves three logical names to the DSPK records with
 * fmemopen(), so the module has no file system and the host no file access.
 *
 * DSPK roles: 3 = EMU8000 wave ROM (1048576 B, or 1048574 B for a card dump without the leading word; optional
 * when no bank uses ROM samples), 32 = primary bank (SBK, SF2 or SBAWE32.MDI), 33 = optional 6-byte config,
 * 34 = optional user bank layered over the primary one. Config: u8 driver (0 Win95, 1 DOS, 2 SDK), u8 primary bank
 * describes ROM samples (0/1), u32 LE DRAM KiB (512..28672, a multiple of 512; default 512 for awe32, 4096 for awe64).
 * Both models run the same 32 EMU8000 voices; the AWE64's software voices are not emulated. Without a ROM record the
 * chip's ROM reads zeros, so only banks whose samples sit in DRAM can sound. Output lags the messages by upstream's
 * constant 980 frames (Emu8000Box: the 86Box chip renders 980-frame blocks one block behind the register writes). */
#include "profile_pack.h"
#include "Synth.h"
#include <cerrno>
#include <cstdio>
#include <memory>
#include <string>
#include <wasi/api.h>
#ifndef MODEL_ID
#error MODEL_ID required
#endif
static_assert(MODEL_ID == 3 || MODEL_ID == 4, "awe32 = 3, awe64 = 4");
namespace {
constexpr uint32_t kRate = 44100, kRomBytes = 1048576;
constexpr char kRomName[] = "defuss:rom", kBankName[] = "defuss:bank", kUserName[] = "defuss:user";
/* The Win95 family glides pan after CC10 by one of at most 255 steps per 227 frames (Synth.cpp PanVxd,
 * kVxdPanStepFrames), and Synth::RenderBlock checks the step timer once per call. For that long after a CC10 the
 * adapter renders one frame per call, so the output does not depend on how the host splits blocks. */
constexpr uint32_t kGlideFrames = 255 * 227;
uint32_t glide;
std::unique_ptr<Synth> synth;
uint8_t *asset;
uint32_t asset_size;
profile_record records[64];
const uint8_t *rom_bytes; /* the ROM record or, during init without one, a zeroed image */
uint32_t rom_size;
struct Config { Awe32::Driver driver; bool rombank; int ram_kb; } config;
uint8_t sysex[PROFILE_SYSEX_MAX];
int16_t raw[PROFILE_BLOCK * 2];
float pcm[PROFILE_BLOCK * 2];

/* Builds a synth in the state the upstream command line reaches before its first event (main.cpp order):
 * ROM, 86Box chip, driver family, banks, DRAM copy into the chip, power-on initialisation. */
std::unique_ptr<Synth> build() {
    std::unique_ptr<uint8_t, decltype(&free)> zero(nullptr, &free);
    rom_bytes = records[3].data; rom_size = records[3].size;
    if (!rom_bytes) {
        zero.reset(static_cast<uint8_t *>(calloc(1, kRomBytes)));
        if (!zero) return nullptr;
        rom_bytes = zero.get(); rom_size = kRomBytes;
    }
    std::string err;
    auto s = std::make_unique<Synth>(kRate);
    bool ok = (!records[3].data || s->LoadWaveRom(kRomName, err));
    if (ok) { s->Core().SetChipRamKb(config.ram_kb); ok = s->Core().UseBox86Chip(kRomName, err); }
    rom_bytes = nullptr; rom_size = 0;
    if (!ok) return nullptr;
    s->Core().SetDriver(config.driver);
    /* With the 86Box chip, upstream's own float core still runs, only for voice bookkeeping (envelope stage, address
     * and volume write-back); its samples are discarded. Linear interpolation and no EQ change none of that and cut
     * render time 3 to 7 times (output compared bit for bit in all three driver families). */
    s->Core().SetInterpolation(Emu8000Core::Interp::Linear);
    s->Core().SetEqualizer(false);
    if (!s->LoadBank(kBankName, err, config.rombank)) return nullptr;
    if (records[34].data && !s->LoadBank(kUserName, err, false)) return nullptr;
    if (!records[3].data) { /* nothing can sound from a ROM that is absent */
        if (config.rombank) return nullptr;
        for (size_t i = 0; i < s->BankCount(); i++)
            for (const auto &sample : s->BankAt(i).samples) if (sample.inRom) return nullptr;
    }
    int16_t *ram = s->Core().ChipRam();
    if (!ram || s->Core().DramSize() > s->Core().ChipRamWords()) return nullptr; /* the banks must fit the card's DRAM */
    memcpy(ram, s->Core().DramData(), s->Core().DramSize() * sizeof(int16_t));
    s->Core().PowerOnInit();
    return s;
}
}

/* The only file access upstream performs: read-only opens of the logical names above. */
extern "C" FILE *fopen(const char *path, const char *mode) {
    const uint8_t *data = nullptr; uint32_t size = 0;
    if (path && !strcmp(path, kRomName)) { data = rom_bytes; size = rom_size; }
    else if (path && !strcmp(path, kBankName)) { data = records[32].data; size = records[32].size; }
    else if (path && !strcmp(path, kUserName)) { data = records[34].data; size = records[34].size; }
    if (!data || !size || !mode || mode[0] != 'r' || strchr(mode, '+')) { errno = ENOENT; return nullptr; }
    return fmemopen(const_cast<uint8_t *>(data), size, "r");
}
/* Upstream prints with std::cout, which links std::cin and so WASI fd_read. Defined here, stdin is closed (EBADF)
 * and the module keeps the host's import list. */
extern "C" __wasi_errno_t __wasi_fd_read(__wasi_fd_t, const __wasi_iovec_t *, size_t, __wasi_size_t *nread) {
    if (nread) *nread = 0;
    return __WASI_ERRNO_BADF;
}

extern "C" {
PROFILE_EXPORT uint32_t profile_abi() { return PROFILE_ABI; }
PROFILE_EXPORT uint32_t profile_model() { return MODEL_ID; }
PROFILE_EXPORT void profile_close() { synth.reset(); memset(records, 0, sizeof records); free(asset); asset = nullptr; asset_size = 0; }
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (synth || !n || n > PROFILE_MAX_ASSET) return nullptr;
    free(asset); asset = static_cast<uint8_t *>(malloc(n)); asset_size = asset ? n : 0;
    return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    if (synth || !n || n != asset_size || !profile_parse(asset, n, MODEL_ID, records)) return 0;
    for (unsigned i = 0; i < 64; i++) if (records[i].size && i != 3 && i != 32 && i != 33 && i != 34) return 0;
    if (!records[32].size || (records[3].size && records[3].size != kRomBytes && records[3].size != kRomBytes - 2)) return 0;
    config = {Awe32::Driver::Win95, false, MODEL_ID == 3 ? 512 : 4096};
    if (records[33].size) {
        const uint8_t *c = records[33].data; uint32_t ram = records[33].size == 6 ? profile_le32(c + 2) : 0;
        if (records[33].size != 6 || c[0] > 2 || c[1] > 1 || ram < 512 || ram > 28672 || ram % 512) return 0;
        config = {c[0] == 1 ? Awe32::Driver::Dos : c[0] == 2 ? Awe32::Driver::Sdk : Awe32::Driver::Win95, c[1] != 0, int(ram)};
    }
    synth = build();
    return synth ? 1 : 0;
}
PROFILE_EXPORT uint32_t profile_rate() { return synth ? kRate : 0; }
PROFILE_EXPORT int32_t profile_voices() {
    if (!synth) return 0;
    int n = 0;
    for (int i = 0; i < Synth::kMaxVoices; i++) n += synth->Core().IsVoiceActive(i);
    return n;
}
/* Power-on state = a synth rebuilt from the same records: the driver layer has no reset entry point. */
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!synth) return 0;
    if (s == 0xff) { synth.reset(); glide = 0; synth = build(); return synth ? 1 : 0; }
    if (s < 0x80 || s > 0xef || a > 127 || b > 127) return 0;
    const uint8_t ch = s & 15;
    switch (s & 0xf0) {
    case 0x80: synth->NoteOff(ch, a); break;
    case 0x90: if (b) synth->NoteOn(ch, a, b); else synth->NoteOff(ch, a); break;
    case 0xb0:
        if (a == 10 && config.driver == Awe32::Driver::Win95) glide = kGlideFrames;
        synth->ControlChange(ch, a, b);
        break;
    case 0xc0: synth->ProgramChange(ch, a); break;
    case 0xd0: synth->ChannelPressure(ch, a); break;
    case 0xe0: synth->PitchBend(ch, int16_t(int(a | b << 7) - 8192)); break;
    default: break; /* polyphonic pressure: the drivers ignore it */
    }
    return 1;
}
PROFILE_EXPORT uint8_t *profile_sysex_buffer() { return sysex; }
/* The driver layer interprets no SysEx (upstream README, "Open points"): resets rebuild, the rest is ignored. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n) {
    if (!synth || !profile_sysex_valid(sysex, n)) return 0;
    return profile_sysex_is_reset(sysex, n) ? profile_message(0xff, 0, 0) : 1;
}
PROFILE_EXPORT float *profile_render(uint32_t n) {
    if (!synth || n > PROFILE_BLOCK) return nullptr;
    uint32_t at = 0;
    for (; at < n && glide; at++, glide--) synth->RenderBlock(raw + 2 * at, 1);
    if (at < n) synth->RenderBlock(raw + 2 * at, n - at);
    for (uint32_t i = 0; i < n; i++) { pcm[i] = raw[2 * i] / 32768.f; pcm[n + i] = raw[2 * i + 1] / 32768.f; }
    return pcm;
}
}
