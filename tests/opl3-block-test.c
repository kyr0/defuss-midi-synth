/* Differential test of OPL3Fast_GenerateBlock (native/adlmidi/src/chips/nuked_fast/nukedopl3_block.inc.c): two
 * chips take the same buffered register writes; one renders through OPL3Fast_Generate sample by sample, the other
 * through OPL3Fast_GenerateBlock; every output sample must be equal. The writes are drawn by a fixed pseudo-random
 * sequence over the registers a MIDI driver writes (operator parameters, waveforms, frequencies, key on and off,
 * feedback, connection and output routing, 4-operator pairs, rhythm mode, vibrato and tremolo depth), in bursts
 * between renders of 1 to 3000 samples, as libADLMIDI interleaves them. Built with emcc and run in node by
 * scripts/opl3-test.mjs; exits 0 when every sample matched. */

#include "../native/adlmidi/src/chips/nuked_fast/nukedopl3_fast.c"

#include <stdio.h>

static uint32_t rng = 0x9e3779b9u;

static uint32_t next(void)
{
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return rng;
}

static uint32_t below(uint32_t n) { return next() % n; }

static opl3_chip reference, block;
static int16_t out_reference[2 * 3000], out_block[2 * 3000];

static void write_both(uint16_t reg, uint8_t value)
{
    OPL3Fast_WriteRegBuffered(&reference, reg, value);
    OPL3Fast_WriteRegBuffered(&block, reg, value);
}

/* One register write of the kind a driver issues, biased toward audible settings. */
static void random_write(void)
{
    static const uint8_t operator_offsets[18] = {0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21};
    const uint16_t high = (uint16_t)(below(2) << 8);
    const uint8_t op = operator_offsets[below(18)];
    const uint8_t ch = (uint8_t)below(9);
    switch (below(14))
    {
    case 0: write_both(0x20 | high | op, (uint8_t)next()); break;
    case 1: write_both(0x40 | high | op, (uint8_t)(below(4) ? below(0x30) | (below(4) << 6) : next())); break;
    case 2: write_both(0x60 | high | op, (uint8_t)(below(3) ? 0xf0 | below(16) : next())); break;
    case 3: write_both(0x80 | high | op, (uint8_t)next()); break;
    case 4: write_both(0xe0 | high | op, (uint8_t)below(8)); break;
    case 5: write_both(0xa0 | high | ch, (uint8_t)next()); break;
    case 6:
    case 7: write_both(0xb0 | high | ch, (uint8_t)(below(64) | (below(3) ? 0x20 : 0))); break;
    case 8: write_both(0xc0 | high | ch, (uint8_t)(below(16) | (below(4) ? 0x30 : (uint8_t)(below(16) << 4)))); break;
    case 9: write_both(0xb0 | high | ch, (uint8_t)below(32)); break; /* key off */
    case 10: write_both(0x104, (uint8_t)below(64)); break;
    case 11: write_both(0xbd, (uint8_t)next()); break;
    case 12: write_both(0x105, (uint8_t)(below(8) ? 1 : 0)); break;
    default: write_both(0x08, (uint8_t)(below(2) << 6)); break;
    }
}

int main(void)
{
    const int rounds = 4000;
    long samples = 0;
    int round;
    {
        /* The sign table of the released-operator loops matches every waveform entry. */
        int wf, index;
        for (wf = 0; wf < 8; wf++)
        {
            for (index = 0; index < 1024; index++)
            {
                if (((logsin_wf[wf][index] >> 15) & 1) != ((opl3_sign_quarters[wf] >> (index >> 8)) & 1))
                {
                    printf("FAIL sign table: waveform %d entry %d\n", wf, index);
                    return 1;
                }
            }
        }
    }
    OPL3Fast_Reset(&reference, 49716);
    OPL3Fast_Reset(&block, 49716);
    write_both(0x105, 1);
    for (round = 0; round < rounds; round++)
    {
        uint32_t writes = below(8) ? 1 + below(40) : 0;
        uint32_t n = 1 + (below(4) ? below(3000) : below(8));
        uint32_t i;
        if (below(200) == 0)
        {
            OPL3Fast_Reset(&reference, 49716);
            OPL3Fast_Reset(&block, 49716);
            write_both(0x105, (uint8_t)below(2));
        }
        for (i = 0; i < writes; i++)
        {
            random_write();
        }
        for (i = 0; i < n; i++)
        {
            OPL3Fast_Generate(&reference, &out_reference[2 * i]);
        }
        OPL3Fast_GenerateBlock(&block, out_block, n);
        for (i = 0; i < 2 * n; i++)
        {
            if (out_reference[i] != out_block[i])
            {
                printf("FAIL round %d sample %u channel %u: per-sample %d, block %d\n", round, i / 2, i % 2,
                       out_reference[i], out_block[i]);
                return 1;
            }
        }
        samples += n;
    }
    printf("PASS %d rounds, %ld samples, identical\n", rounds, samples);
    return 0;
}
