/* SPDX-License-Identifier: LGPL-2.1-or-later
 * libADLMIDI's NukedOPL3Fast chip class (adlmidi/src/chips/nuked_opl3_fast.h) implemented with the Nuked CQM core of
 * 86Box (cqm.c and cqm.h, extracted from the pinned source by scripts/build-native-profiles.py), for the sb16-cqm
 * build, which compiles this file in place of nuked_opl3_fast.cpp and no OPL3 core. libADLMIDI drives it like an
 * OPL3: the CQM takes the YMF262 register set (18 channels, 4-operator and rhythm modes, C0 pan bits).
 *
 * Clock: 86Box calls CQM_Generate once per 49716 Hz sample (nuked_cqm_drv_init: CQM_Reset(.., FREQ_49716,
 * FREQ_49716), since its commit f0f3c47209 "Fix CQM pitch"), libADLMIDI's nativeRate, so its resampler runs as for
 * the OPL3. Level: 86Box halves both its Nuked OPL3 and its Nuked CQM driver output before the same Sound Blaster
 * mixer; libADLMIDI halves neither chip, so CQM_Generate's output is taken unscaled, clipped to 16 bits as libADLMIDI
 * clips the OPL3's. */
#include "nuked_opl3_fast.h"
#include "cqm.h"
#include <stdint.h>

static cqm_t *chip(void *p) { return static_cast<cqm_t *>(p); }
static int16_t clip(int32_t v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : static_cast<int16_t>(v); }

NukedOPL3Fast::NukedOPL3Fast() : OPLChipBaseT() {
    m_chip = new cqm_t;
    NukedOPL3Fast::setRate(m_rate);
}
NukedOPL3Fast::~NukedOPL3Fast() { delete chip(m_chip); }
void NukedOPL3Fast::setRate(uint32_t rate) {
    OPLChipBaseT::setRate(rate);
    CQM_Reset(chip(m_chip), nativeRate, nativeRate);
}
void NukedOPL3Fast::reset() {
    OPLChipBaseT::reset();
    CQM_Reset(chip(m_chip), nativeRate, nativeRate);
}
void NukedOPL3Fast::writeReg(uint16_t addr, uint8_t data) { CQM_WriteRegBuffered(chip(m_chip), addr, data); }
void NukedOPL3Fast::writePan(uint16_t, uint8_t) {} /* panning is the chip's C0 bits */
void NukedOPL3Fast::nativeGenerate(int16_t *frame) {
    int32_t raw[2];
    CQM_Generate(chip(m_chip), raw);
    frame[0] = clip(raw[0]);
    frame[1] = clip(raw[1]);
}
const char *NukedOPL3Fast::emulatorName() { return "Nuked CQM (86Box)"; }
bool NukedOPL3Fast::hasFullPanning() { return false; }
OPLChipBase::ChipType NukedOPL3Fast::chipType() { return CHIPTYPE_OPL3; }
