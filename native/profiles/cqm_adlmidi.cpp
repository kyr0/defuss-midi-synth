/* SPDX-License-Identifier: LGPL-2.1-or-later
 * Replacement for libADLMIDI's NukedOPL3Fast adapter in the CQM-only build.
 * Uses the actual Nuked CQM core, not OPL3 with altered patches. */
#include "nuked_opl3_fast.h"
#include "cqm.h"
#include <stdint.h>
NukedOPL3Fast::NukedOPL3Fast(): OPLChipBaseT() { m_chip=new cqm_t; setRate(m_rate); }
NukedOPL3Fast::~NukedOPL3Fast() { delete static_cast<cqm_t*>(m_chip); }
void NukedOPL3Fast::setRate(uint32_t rate) { OPLChipBaseT::setRate(rate); CQM_Reset(static_cast<cqm_t*>(m_chip),49716,49716); }
void NukedOPL3Fast::reset() { OPLChipBaseT::reset(); CQM_Reset(static_cast<cqm_t*>(m_chip),49716,49716); }
void NukedOPL3Fast::writeReg(uint16_t addr,uint8_t data) { CQM_WriteRegBuffered(static_cast<cqm_t*>(m_chip),addr,data); }
void NukedOPL3Fast::writePan(uint16_t,uint8_t) {} // hardware C0 pan bits
static int16_t sample(int32_t v) { v/=2; return v>32767?32767:v<-32768?-32768:static_cast<int16_t>(v); }
void NukedOPL3Fast::nativeGenerate(int16_t* frame) { int32_t raw[2]; CQM_Generate(static_cast<cqm_t*>(m_chip),raw); frame[0]=sample(raw[0]); frame[1]=sample(raw[1]); }
const char* NukedOPL3Fast::emulatorName() { return "Nuked CQM (86Box)"; }
bool NukedOPL3Fast::hasFullPanning() { return false; }
OPLChipBase::ChipType NukedOPL3Fast::chipType() { return CHIPTYPE_OPL3; }
