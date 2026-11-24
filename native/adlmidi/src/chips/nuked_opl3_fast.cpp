/*
 * Interfaces over Yamaha OPL3 (YMF262) chip emulators
 *
 * Copyright (c) 2017-2026 Vitaly Novichkov (Wohlstand)
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

#include "nuked_opl3_fast.h"
#include "nuked_fast/nukedopl3_fast.h"
#include <cstring>

NukedOPL3Fast::NukedOPL3Fast() :
    OPLChipBaseT()
{
    m_chip = new opl3_chip;
    NukedOPL3Fast::setRate(m_rate);
}

NukedOPL3Fast::~NukedOPL3Fast()
{
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    delete chip_r;
}

void NukedOPL3Fast::setRate(uint32_t rate)
{
    OPLChipBaseT::setRate(rate);
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    std::memset(chip_r, 0, sizeof(opl3_chip));
    OPL3Fast_Reset(chip_r, rate);
}

void NukedOPL3Fast::reset()
{
    OPLChipBaseT::reset();
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    std::memset(chip_r, 0, sizeof(opl3_chip));
    OPL3Fast_Reset(chip_r, m_rate);
}

void NukedOPL3Fast::writeReg(uint16_t addr, uint8_t data)
{
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    OPL3Fast_WriteRegBuffered(chip_r, addr, data);
}

void NukedOPL3Fast::writePan(uint16_t addr, uint8_t data)
{
    (void)addr;
    (void)data; // Hardware panning is controlled through register C0.
}

void NukedOPL3Fast::nativeGenerate(int16_t *frame)
{
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    OPL3Fast_Generate(chip_r, frame);
}

const char *NukedOPL3Fast::emulatorName()
{
    return "Nuked OPL3 Fast (by tgies)";
}

bool NukedOPL3Fast::hasFullPanning()
{
    return false;
}

OPLChipBase::ChipType NukedOPL3Fast::chipType()
{
    return CHIPTYPE_OPL3;
}

#if !defined(ADLMIDI_ENABLE_HQ_RESAMPLER) && !defined(DEFUSS_OPL3_PER_SAMPLE)
/* defuss-midi-synth: the output of OPLChipBaseT's generate32 and generateAndMix32, rendered with
 * OPL3Fast_GenerateBlock. It first counts the native samples that frames output frames consume, renders them as
 * one block, then interpolates between them with the resampler's own arithmetic and state, so the result equals
 * one resampledGenerate per frame. */
template <bool mix>
void NukedOPL3Fast::renderBlocks(int32_t *output, size_t frames)
{
    enum { native_max = 512 };
    opl3_chip *chip_r = reinterpret_cast<opl3_chip*>(m_chip);
    int16_t native[2 * native_max];
    const int32_t rateratio = m_rateratio;
    while(frames > 0)
    {
        size_t count = 0, needed = 0, i = 0;
        int32_t samplecnt = m_samplecnt;
        while(count < frames)
        {
            int32_t cnt = samplecnt;
            size_t add = 0;
            while(cnt >= rateratio)
            {
                cnt -= rateratio;
                ++add;
            }
            if(needed + add > native_max)
                break;
            needed += add;
            samplecnt = cnt + (1 << rsm_frac);
            ++count;
        }
        OPL3Fast_GenerateBlock(chip_r, native, (uint32_t)needed);
        samplecnt = m_samplecnt;
        for(size_t f = 0; f < count; ++f)
        {
            int32_t frame[2];
            while(samplecnt >= rateratio)
            {
                m_oldsamples[0] = m_samples[0];
                m_oldsamples[1] = m_samples[1];
                m_samples[0] = native[2 * i];
                m_samples[1] = native[2 * i + 1];
                ++i;
                samplecnt -= rateratio;
            }
            frame[0] = (int32_t)((m_oldsamples[0] * (rateratio - samplecnt) + m_samples[0] * samplecnt) / rateratio);
            frame[1] = (int32_t)((m_oldsamples[1] * (rateratio - samplecnt) + m_samples[1] * samplecnt) / rateratio);
            if(mix)
            {
                output[0] += frame[0];
                output[1] += frame[1];
            }
            else
            {
                output[0] = frame[0];
                output[1] = frame[1];
            }
            output += 2;
            samplecnt += (1 << rsm_frac);
        }
        m_samplecnt = samplecnt;
        frames -= count;
    }
}

void NukedOPL3Fast::generate32(int32_t *output, size_t frames)
{
    if(isRunningAtPcmRate())
    {
        OPLChipBaseT<NukedOPL3Fast>::generate32(output, frames);
        return;
    }
    renderBlocks<false>(output, frames);
}

void NukedOPL3Fast::generateAndMix32(int32_t *output, size_t frames)
{
    if(isRunningAtPcmRate())
    {
        OPLChipBaseT<NukedOPL3Fast>::generateAndMix32(output, frames);
        return;
    }
    renderBlocks<true>(output, frames);
}
#endif
