/* SPDX-License-Identifier: MIT
 * GF1 voice model adapted from QEMU GUSEMU32 hw/audio/gusemu_mixer.c
 * (QEMU 6bf90d4fc5027567cb704d7888f5ec792b4ed75a), Copyright (C) 2000-2007 Tibor "TS" Schütz.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Kept from GUSEMU32: 23.9 fixed-point addresses, the 16-bit address translation
 * ((a & 0xc0000) | (a & 0x1ffff) << 1), the semi-logarithmic volume decode
 * ((256 + mantissa) << exponent) / 512 with 32x ramp precision, the 9-bit linear
 * interpolation between adjacent DRAM samples, and the stop-request handling.
 * Changed, each after the Gravis UltraSound SDK 2.10 documentation (ULTRADOC.TXT,
 * December 1993, sections 2.6.2 and 2.16):
 * - One call renders one frame at the native rate 617400 / active voices (the SDK
 *   rate table), so the address advances by FC >> 1 (FC bits 15-1, nine fraction
 *   bits) and the volume by the ramp increment once per voice update (FUR), divided
 *   by 8 per rate step. GUSEMU32 rescales both to the host rate, and its ramp runs at
 *   half the SDK's full-scale times (0-4095 at rate 0, increment 63: 1.4 ms with 14
 *   voices, 3.3 ms with 32).
 * - Constant-power pan over the 16 positions (SDK patch format: "the total output
 *   power of both channels is constant"), 0 full left, 7 centre, 15 full right
 *   (SDK 2.6.2.13). GUSEMU32 pans linearly.
 * - A loop wrap keeps the overshoot past the boundary, as dosbox-staging does;
 *   GUSEMU32 restarts exactly at the loop start, which detunes short loops.
 * - Per-voice register struct, 20-bit masked DRAM reads, no IRQs, no ramp loops.
 */
#ifndef DEFUSS_GF1_MIXER_H
#define DEFUSS_GF1_MIXER_H
#include "vintage_math.h"
#define GF1_RAM_SIZE (1024u * 1024u)
#define GF1_BANK (256u * 1024u)
/* Voice and ramp control bits, in the upper byte as GUSEMU32 stores byte registers (SDK 2.6.2.1, 2.6.2.14). */
#define GF1_STOPPED 0x100u
#define GF1_STOP_REQUEST 0x200u
#define GF1_16BIT 0x400u
#define GF1_LOOP 0x800u
#define GF1_BIDIR 0x1000u
#define GF1_DECREASE 0x4000u
typedef struct {
    uint16_t control;      /* voice control: GF1_* bits */
    uint16_t freq;         /* FC: bits 15-10 integer, 9-1 fraction */
    uint32_t start, end, pos; /* 23.9: 20-bit (translated) DRAM address << 9 | fraction */
    uint32_t vol32;        /* current volume register (12 bits in 15-4) times 32 */
    uint8_t ramp_start, ramp_end, ramp_rate; /* 8-bit registers: exponent:mantissa, RRMMMMMM */
    uint16_t ramp_control; /* GF1_STOPPED, GF1_STOP_REQUEST, GF1_DECREASE */
    uint8_t pan;           /* 0..15 */
} gf1_voice;
/* round(32767 * cos|sin((n + 1) * pi / 4)), n = (pan - 7) / (pan < 7 ? 7 : 8) */
static const int16_t gf1_pan_q15[16][2] = {{32767,0},{32561,3669},{31945,7291},{30928,10822},{29522,14217},{27745,17433},{25618,20430},{23170,23170},{20787,25329},{18204,27245},{15446,28898},{12539,30273},{9512,31356},{6393,32137},{3212,32609},{0,32767}};
/* SDK convert_to_16: a 16-bit voice addresses samples, bits 19-18 select the 256 KiB bank. */
static inline uint32_t gf1_address16(uint32_t physical) { return (physical & 0xc0000u) | ((physical >> 1) & 0x1ffffu); }
static inline int32_t gf1_read(const uint8_t *ram, uint32_t address, int wide) {
    address &= 0xfffffu;
    if (wide) return rds16(ram + ((address & 0xc0000u) | ((address & 0x1ffffu) << 1))); /* at most 0xffffe */
    return s8(ram[address]) * 256;
}
/* Volume increment per frame in vol32 units: increment * 512 (one 12-bit step) / 8^rate. */
static inline uint32_t gf1_ramp_increment(uint8_t rate) { return (512u * (rate & 63u)) >> (3u * (rate >> 6)); }
static inline void gf1_mix_voice(gf1_voice *v, const uint8_t *ram, int32_t *l, int32_t *r) {
    if (v->control & GF1_STOP_REQUEST) v->control |= GF1_STOPPED;
    if (v->ramp_control & GF1_STOP_REQUEST) v->ramp_control |= GF1_STOPPED;
    if (v->control & v->ramp_control & GF1_STOPPED) return; /* GUSEMU32: neither unit active */
    int wide = (v->control & GF1_16BIT) != 0;
    uint32_t address = v->pos >> 9, frac = v->pos & 511u;
    int32_t a = gf1_read(ram, address, wide), b = gf1_read(ram, address + 1, wide);
    unsigned exponent = v->vol32 >> 17; if (exponent > 15) exponent = 15;
    int32_t volume = (int32_t)(((((v->vol32 >> 9) & 255u) + 256u) << exponent) / 512u);
    int32_t sample = ((a * volume >> 16) * (int32_t)(512u - frac)) / 512 + ((b * volume >> 16) * (int32_t)frac) / 512;
    *l += (sample * gf1_pan_q15[v->pan & 15][0]) >> 15;
    *r += (sample * gf1_pan_q15[v->pan & 15][1]) >> 15;
    if (!(v->ramp_control & GF1_STOPPED)) {
        uint32_t inc = gf1_ramp_increment(v->ramp_rate), lo = (uint32_t)v->ramp_start << 13, hi = (uint32_t)v->ramp_end << 13;
        if (v->ramp_control & GF1_DECREASE) {
            if (v->vol32 <= lo + inc) { v->vol32 = lo; v->ramp_control |= GF1_STOPPED; } else v->vol32 -= inc;
        } else {
            v->vol32 += inc;
            if (v->vol32 >= hi) { v->vol32 = hi; v->ramp_control |= GF1_STOPPED; }
        }
    }
    if (!(v->control & GF1_STOPPED)) {
        int down = (v->control & GF1_DECREASE) != 0;
        int64_t p = (int64_t)v->pos + (down ? -(int64_t)(v->freq >> 1) : (int64_t)(v->freq >> 1));
        int64_t over = down ? (int64_t)v->start - p : p - (int64_t)v->end;
        if (over >= 0) {
            if (v->control & GF1_LOOP) {
                if (v->control & GF1_BIDIR) v->control ^= GF1_DECREASE;
                p = (v->control & GF1_DECREASE) ? (int64_t)v->end - over : (int64_t)v->start + over;
                if (p < (int64_t)v->start) p = v->start; /* overshoot longer than the loop */
                if (p > (int64_t)v->end) p = v->end;
            } else { v->control |= GF1_STOPPED; p = down ? v->start : v->end; }
        }
        v->pos = (uint32_t)p;
    }
}
#endif
