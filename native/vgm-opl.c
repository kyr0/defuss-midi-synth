// The OPL register stream uses the same Nuked OPL3 chip as the SB16 engine.
#include "adlmidi/src/chips/nuked_fast/nukedopl3_fast.h"

static opl3_chip chips[2];
static int16_t samples[2][2048];

void vgm_reset(int dual) {
    OPL3Fast_Reset(&chips[0], 49716);
    if (dual) OPL3Fast_Reset(&chips[1], 49716);
}

void vgm_write(unsigned chip, uint16_t reg, uint8_t value) {
    OPL3Fast_WriteReg(&chips[chip], reg, value);
}

int16_t *vgm_render(unsigned frames, int dual) {
    OPL3Fast_GenerateBlock(&chips[0], samples[0], frames);
    if (dual) {
        OPL3Fast_GenerateBlock(&chips[1], samples[1], frames);
        for (unsigned i = 0; i < frames * 2; ++i)
            samples[0][i] = (samples[0][i] + samples[1][i]) / 2;
    }
    return samples[0];
}
