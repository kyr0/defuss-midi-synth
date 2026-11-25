/* SPDX-License-Identifier: MIT
 * Native ABI 2 (profile_pack.h) bridge to Munt's libmt32emu C++ API; libmt32emu itself is LGPL-2.1-or-later.
 * Assets: one DSPK v1 pack for model 9 holding role 1, a full MT-32 control ROM image, and role 2, the full MT-32
 * PCM ROM image. libmt32emu identifies both by size and SHA-1 (its ROMInfo table); a pack is accepted only when both
 * belong to one MT-32 machine configuration (control 1.04 .. 1.07, BlueRidge, 2.03 .. 2.07 with the MT-32 PCM ROM). */
#define MT32EMU_API_TYPE 0
#include <cstdarg>
#include <cstring>
#include "profile_pack.h"
#include "mt32emu.h"

using namespace MT32Emu;

namespace {
/* The reactor has no console: Munt's debug and LCD reports are dropped instead of written to stdout. */
class SilentReportHandler : public ReportHandler3 {
public:
    void printDebug(const char *, va_list) {}
    void showLCDMessage(const char *) {}
};
SilentReportHandler reports;
Synth *synth;
ArrayFile *files[2];
const ROMImage *images[2];
uint8_t *asset;
uint32_t asset_size;
uint8_t sysex[PROFILE_SYSEX_MAX];
float stereo[2], planar[PROFILE_BLOCK * 2];
PartialState partials[DEFAULT_MAX_PARTIALS];
/* Data set 1 to address 7F 00 00, the MT-32's "all parameters reset"; Munt's dumpSysexBank emits the same message. */
const uint8_t MT32_RESET[] = {0xf0, 0x41, 0x10, 0x16, 0x12, 0x7f, 0x00, 0x00, 0x01, 0xf7};

const ROMInfo *full(File *file, const ROMInfo *const *known, ROMInfo::Type type) {
    const ROMInfo *info = ROMInfo::getROMInfo(file, known);
    return info && info->type == type && info->pairType == ROMInfo::Full ? info : NULL;
}

/* The MT-32 machine whose compatible ROM list holds both images; CM-32L/LAPC-I and CM-32LN are other models. */
const MachineConfiguration *mt32_machine(File *control, File *pcm) {
    for (const MachineConfiguration *const *m = MachineConfiguration::getAllMachineConfigurations(); *m; m++) {
        if (strncmp((*m)->getMachineID(), "mt32_", 5)) continue;
        const ROMInfo *const *known = (*m)->getCompatibleROMInfos();
        if (full(control, known, ROMInfo::Control)) return full(pcm, known, ROMInfo::PCM) ? *m : NULL;
    }
    return NULL;
}
}

extern "C" {
PROFILE_EXPORT uint32_t profile_abi(void) { return PROFILE_ABI; }
PROFILE_EXPORT uint32_t profile_model(void) { return 9; }
PROFILE_EXPORT void profile_close(void) {
    if (synth) { synth->close(); delete synth; synth = NULL; }
    for (int i = 0; i < 2; i++) {
        if (images[i]) ROMImage::freeROMImage(images[i]);
        delete files[i];
        images[i] = NULL; files[i] = NULL;
    }
    free(asset); asset = NULL; asset_size = 0;
}
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (synth || !n || n > PROFILE_MAX_ASSET) return NULL;
    free(asset); asset = static_cast<uint8_t *>(malloc(n)); asset_size = asset ? n : 0;
    return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    profile_record r[64];
    if (synth || !asset || n != asset_size || !profile_parse(asset, n, 9, r) || !r[1].size || !r[2].size) return 0;
    for (int i = 3; i < 64; i++) if (r[i].size) return 0;
    files[0] = new ArrayFile(r[1].data, r[1].size);
    files[1] = new ArrayFile(r[2].data, r[2].size);
    const MachineConfiguration *machine = mt32_machine(files[0], files[1]);
    if (machine) {
        images[0] = ROMImage::makeROMImage(files[0], machine->getCompatibleROMInfos());
        images[1] = ROMImage::makeROMImage(files[1], machine->getCompatibleROMInfos());
        synth = new Synth(&reports);
        /* Every reverb mode keeps its buffers, so a reverb-mode SysEx never allocates on the audio thread. */
        synth->preallocateReverbMemory(true);
        if (synth->open(*images[0], *images[1], DEFAULT_MAX_PARTIALS, AnalogOutputMode_COARSE)) return 1;
    }
    profile_close();
    return 0;
}
/* 32 kHz: the LA32 sample rate; AnalogOutputMode_COARSE filters at that rate without upsampling. */
PROFILE_EXPORT uint32_t profile_rate(void) { return synth ? synth->getStereoOutputSampleRate() : 0; }
/* Sounding LA32 partials (0 .. 32); one note takes one to four of them. */
PROFILE_EXPORT int32_t profile_voices(void) {
    if (!synth) return 0;
    synth->getPartialStates(partials);
    int32_t active = 0;
    for (unsigned i = 0; i < synth->getPartialCount(); i++) active += partials[i] != PartialState_INACTIVE;
    return active;
}
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!synth) return 0;
    if (s == 0xff) { synth->playSysexNow(MT32_RESET, sizeof MT32_RESET); return 1; }
    if (s < 0x80 || s > 0xef || a > 127 || b > 127) return 0;
    synth->playMsgNow(s | a << 8 | b << 16);
    return 1;
}
PROFILE_EXPORT uint8_t *profile_sysex_buffer(void) { return sysex; }
/* Every well-framed message goes to Munt, which applies MT-32 DT1 writes and ignores what the MT-32 ignores
 * (other manufacturers or models, checksum errors, GM/GS/XG resets), as the hardware does. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n) {
    if (!synth || !profile_sysex_valid(sysex, n)) return 0;
    synth->playSysexNow(sysex, n);
    return 1;
}
/* One frame per Munt call. TVP draws its timer jitter from rand() partial by partial within a call, so the draws, and
 * the output, would depend on how the host splits blocks; frame steps keep the output partition-invariant. */
PROFILE_EXPORT float *profile_render(uint32_t n) {
    if (!synth || n > PROFILE_BLOCK) return NULL;
    for (uint32_t i = 0; i < n; i++) { synth->render(stereo, 1); planar[i] = stereo[0]; planar[n + i] = stereo[1]; }
    return planar;
}
}
