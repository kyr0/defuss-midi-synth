/* Nuked OPL3 block renderer
 *
 * Copyright (C) 2013-2020 Nuke.YKT
 * Copyright (C) 2026 Tony Gies (Nuked-OPL3-fast modifications)
 * Copyright (C) 2026 defuss-midi-synth (block renderer)
 *
 * This file is part of Nuked OPL3 as vendored by defuss-midi-synth. It is free software: you can redistribute it
 * and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software
 * Foundation, either version 2.1 of the License, or (at your option) any later version. It is distributed in the
 * hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
 *
 * Included at the end of nukedopl3_fast.c, so it shares that file's static tables and helpers.
 *
 * OPL3Fast_GenerateBlock renders n native samples, the two front outputs (cha, chb) of what n calls of
 * OPL3Fast_Generate render, sample for sample (tests/opl3-block-test.c compares both on the same register writes).
 * The per-sample generator walks 36 operators, two mix lists and the chip's timers once per sample. This one walks
 * each operator over a run of samples instead: the chip's clocks (envelope timer, tremolo, vibrato, noise) are
 * computed first for the whole run, then each operator runs with its state in locals and its output in an array,
 * and the channels are mixed from those arrays last. A run ends where a buffered register write falls due, so no
 * operator's registers change inside one. An operator that is dormant at the start of a run (fully attenuated, key
 * off, phase and output zero) costs one comparison for the run. Channels 7 and 8 run sample by sample through the
 * per-sample functions, since rhythm mode couples their four operators within each sample.
 *
 * Differences from OPL3Fast_Generate: the rear outputs (chc, chd: mixbuff[2], mixbuff[3]) are not computed. */

#define OPL3_BLOCK 256

enum { opl3_mod_zero = 0, opl3_mod_fb = 1, opl3_mod_slot = 2 };

/* The chip's clocks as each sample's operators see them, and the operators' outputs, for one run. */
typedef struct {
    uint8_t eg_add[OPL3_BLOCK];
    uint8_t eg_timer_lo[OPL3_BLOCK];
    uint8_t eg_state[OPL3_BLOCK];
    uint8_t vibpos[OPL3_BLOCK];
    uint8_t tremolo[OPL3_BLOCK];
    uint8_t noise_hh[OPL3_BLOCK];
    uint8_t noise_sd[OPL3_BLOCK];
    /* Each operator's output: cell 0 holds its output before the run (what a delayed mix tap reads at the first
     * sample), cell k + 1 its output at sample k, so a delayed tap reads the same array one cell earlier. */
    int16_t out[36][OPL3_BLOCK + 1];
    /* Whether the operator is silent for the whole run (dormant at its start), and the first sample at whose end
     * it is dormant (m: never). */
    uint8_t silent[36];
    uint32_t dormant_from[36];
    int32_t mix_left[OPL3_BLOCK];
    int32_t mix_right[OPL3_BLOCK];
} opl3_block;

static opl3_block opl3_block_state;

/* For each waveform, the quarters of the phase (bits 8 and 9 of the 10-bit index) whose logsin_wf entries carry the
 * sign bit: the second half of the sine (0) and of both squares (6, 7), the second quarter of the even sine (4), none
 * of the others. A fully attenuated operator outputs just that sign (0 or -1). tests/opl3-block-test.c checks the
 * table against logsin_wf. */
static const uint8_t opl3_sign_quarters[8] = {0x0c, 0x00, 0x00, 0x00, 0x02, 0x00, 0x0c, 0x0c};

/* The chip's clock state the operators read, advanced sample by sample by OPL3Fast_BlockClock. */
typedef struct {
    uint64_t eg_timer;
    uint32_t noise;
    uint16_t timer;
    uint8_t eg_timerrem, eg_state, eg_add, eg_timer_lo;
    uint8_t vibpos, tremolo, tremolopos, tremolo_dirty, tremoloshift;
    uint8_t noise_hh, noise_sd;
} opl3_clock;

/* Records for each of m samples the clocks its operators read, then advances them as m calls of
 * OPL3Fast_Generate4Ch do: the noise register at the start of a sample, tremolo, vibrato, the timer and the
 * envelope timer at its end. c holds the state before the run and receives the state after it. */
static void OPL3Fast_BlockClock(opl3_clock *c, opl3_block *b, uint32_t m)
{
    uint32_t k;
    for (k = 0; k < m; k++)
    {
        uint8_t update_tremolo;
        uint32_t s = c->noise;
        uint32_t f0_8   = (s ^ (s >> 14)) & 0x1ffu;
        uint32_t f9_17  = ((s >> 9) ^ f0_8) & 0x1ffu;
        uint32_t f18_22 = ((s >> 18) ^ f9_17) & 0x1fu;
        uint32_t f23_31 = f0_8 ^ ((f9_17 >> 5) | (f18_22 << 4));
        uint32_t f32_35 = (f9_17 ^ f23_31) & 0x0fu;
        c->noise_hh = (uint8_t)((s >> 13) & 1u);
        c->noise_sd = (uint8_t)((s >> 16) & 1u);
        c->noise = ((f9_17 >> 4) & 0x1fu) | (f18_22 << 5) | (f23_31 << 10) | (f32_35 << 19);

        b->eg_add[k] = c->eg_add;
        b->eg_timer_lo[k] = c->eg_timer_lo;
        b->eg_state[k] = c->eg_state;
        b->vibpos[k] = c->vibpos;
        b->tremolo[k] = c->tremolo;
        b->noise_hh[k] = c->noise_hh;
        b->noise_sd[k] = c->noise_sd;

        update_tremolo = c->tremolo_dirty;
        if ((c->timer & 0x3f) == 0x3f)
        {
            c->tremolopos++;
            if (c->tremolopos == 210)
            {
                c->tremolopos = 0;
            }
            update_tremolo = 1;
        }
        if (update_tremolo)
        {
            if (c->tremolopos < 105)
            {
                c->tremolo = c->tremolopos >> c->tremoloshift;
            }
            else
            {
                c->tremolo = (210 - c->tremolopos) >> c->tremoloshift;
            }
            c->tremolo_dirty = 0;
        }
        if ((c->timer & 0x3ff) == 0x3ff)
        {
            c->vibpos = (c->vibpos + 1) & 7;
        }
        c->timer++;
        if (c->eg_state)
        {
            uint32_t eg_timer_low = (uint32_t)c->eg_timer & 0x1fffu;
            if (!eg_timer_low)
            {
                c->eg_add = 0;
            }
            else
            {
                uint8_t shift = 0;
#if defined(__GNUC__) || defined(__clang__)
                shift = (uint8_t)__builtin_ctz(eg_timer_low);
#else
                while (((eg_timer_low >> shift) & 1) == 0)
                {
                    shift++;
                }
#endif
                c->eg_add = shift + 1;
            }
            c->eg_timer_lo = (uint8_t)(c->eg_timer & 0x3u);
        }
        if (c->eg_timerrem || c->eg_state)
        {
            if (c->eg_timer == UINT64_C(0xfffffffff))
            {
                c->eg_timer = 0;
                c->eg_timerrem = 1;
            }
            else
            {
                c->eg_timer++;
                c->eg_timerrem = 0;
            }
        }
        c->eg_state ^= 1;
    }
}

static void OPL3Fast_ClockLoad(const opl3_chip *chip, opl3_clock *c)
{
    c->eg_timer = chip->eg_timer;
    c->noise = chip->noise;
    c->timer = chip->timer;
    c->eg_timerrem = chip->eg_timerrem;
    c->eg_state = chip->eg_state;
    c->eg_add = chip->eg_add;
    c->eg_timer_lo = chip->eg_timer_lo;
    c->vibpos = chip->vibpos;
    c->tremolo = chip->tremolo;
    c->tremolopos = chip->tremolopos;
    c->tremolo_dirty = chip->tremolo_dirty;
    c->tremoloshift = chip->tremoloshift;
    c->noise_hh = (uint8_t)chip->noise_hh;
    c->noise_sd = (uint8_t)chip->noise_sd;
}

static void OPL3Fast_ClockStore(opl3_chip *chip, const opl3_clock *c)
{
    chip->eg_timer = c->eg_timer;
    chip->noise = c->noise;
    chip->timer = c->timer;
    chip->eg_timerrem = c->eg_timerrem;
    chip->eg_state = c->eg_state;
    chip->eg_add = c->eg_add;
    chip->eg_timer_lo = c->eg_timer_lo;
    chip->vibpos = c->vibpos;
    chip->tremolo = c->tremolo;
    chip->tremolopos = c->tremolopos;
    chip->tremolo_dirty = c->tremolo_dirty;
    chip->noise_hh = c->noise_hh;
    chip->noise_sd = c->noise_sd;
}

/* Runs one operator of a channel other than 7 and 8 over m samples, as m calls of OPL3Fast_ProcessSlotMaybeInline
 * with maybe_rhythm 0 do: the operator's changing state is held in locals, the registers it reads stay fixed (no
 * write falls inside a run), its modulation input comes from zeromod, its own feedback or the output array of the
 * earlier operator src, and its tremolo input from the run's tremolo array. Its output for each sample goes to
 * out; returns the first sample at whose end the operator is dormant, or m. */
static uint32_t OPL3Fast_BlockSlot(opl3_chip *chip, opl3_slot *slot, uint8_t fb, opl3_block *b, uint32_t m,
                                   int16_t *out)
{
    const uint32_t write_gen = chip->write_gen;
    const uint8_t key = slot->key;
    const uint16_t eg_tl_ksl = slot->eg_tl_ksl;
    const uint32_t pg_inc = slot->pg_inc;
    const uint8_t reg_vib = slot->reg_vib;
    const uint8_t reg_wf = slot->reg_wf;
    const uint8_t reg_sl = slot->reg_sl;
    const uint16_t *wf = logsin_wf[reg_wf];
    const uint8_t trem_on = slot->trem != (uint8_t *)&chip->zeromod;
    const int16_t *src_out = NULL;
    uint32_t src_dormant_from = 0;
    int mod_kind;
    uint32_t dormant_from = m;
    uint32_t k = 0;

    uint32_t dormant_gen = slot->dormant_gen;
    uint32_t pg_phase = slot->pg_phase;
    uint32_t pg_reset = slot->pg_reset;
    uint16_t pg_phase_out = slot->pg_phase_out;
    uint16_t eg_rout = slot->eg_rout;
    uint16_t eg_out = slot->eg_out;
    uint8_t eg_gen = slot->eg_gen;
    int16_t sout = slot->out;
    int16_t prout = slot->prout;
    int16_t fbmod = slot->fbmod;

    if (slot->mod == &chip->zeromod)
    {
        mod_kind = opl3_mod_zero;
    }
    else if (slot->mod == &slot->fbmod)
    {
        mod_kind = opl3_mod_fb;
    }
    else
    {
        opl3_slot *src = (opl3_slot *)((char *)slot->mod - offsetof(opl3_slot, out));
        uint32_t sn = (uint32_t)(src - &chip->slot[0]);
        mod_kind = opl3_mod_slot;
        src_out = &b->out[sn][1];
        src_dormant_from = b->dormant_from[sn];
    }

    /* A released operator at full attenuation keeps its frequency after its note, so it does not become dormant:
     * every sample it takes ProcessSlotImpl's first path, which advances the phase and outputs the sign of the
     * waveform entry (0 or -1). With key off and no write in the run it stays there for the whole run, unless the
     * trivially-dead conditions can hold, which need fb, pg_inc, eg_tl_ksl, reg_vib and reg_wf all zero. These
     * loops are that path alone, with the sign taken from opl3_sign_quarters instead of the table. */
    if (!key && eg_rout == 0x1ff && dormant_gen != write_gen && (fb | pg_inc | eg_tl_ksl | reg_vib | reg_wf))
    {
        const uint32_t sign = opl3_sign_quarters[reg_wf];
        const uint8_t fb_shift = (uint8_t)(0x09 - fb);
        if (!reg_vib && (mod_kind != opl3_mod_fb || !fb))
        {
            /* No vibrato and no feedback input: sample k's phase is pg_phase + k * pg_inc, independent of the
             * outputs before it, so the loop has no carried dependency. */
            const int16_t entry_out = sout, entry_prout = prout;
            if (mod_kind == opl3_mod_slot)
            {
                for (k = 0; k < m; k++)
                {
                    const uint16_t phase_out = (uint16_t)((pg_phase + k * pg_inc) >> 9);
                    const uint32_t index = (uint16_t)(phase_out + src_out[k]) & 0x3ffu;
                    out[k] = (int16_t)-(int32_t)((sign >> (index >> 8)) & 1u);
                }
            }
            else
            {
                for (k = 0; k < m; k++)
                {
                    const uint32_t index = (uint32_t)((pg_phase + k * pg_inc) >> 9) & 0x3ffu;
                    out[k] = (int16_t)-(int32_t)((sign >> (index >> 8)) & 1u);
                }
            }
            /* The state after the run, as the per-sample path leaves it after sample m - 1. */
            {
                const int16_t before1 = m >= 2 ? out[m - 2] : entry_out;
                const int16_t before2 = m >= 3 ? out[m - 3] : m == 2 ? entry_out : entry_prout;
                fbmod = fb ? (int16_t)((before2 + before1) >> fb_shift) : 0;
                prout = before1;
                sout = out[m - 1];
                pg_phase_out = (uint16_t)((pg_phase + (m - 1) * pg_inc) >> 9);
                pg_phase += m * pg_inc;
            }
        }
        else
        {
            if (!fb)
            {
                fbmod = 0;
            }
            for (k = 0; k < m; k++)
            {
                const uint32_t phaseinc = reg_vib ? slot->pg_inc_vib[b->vibpos[k]] : pg_inc;
                int16_t mod_now;
                uint32_t index;
                if (fb)
                {
                    fbmod = (int16_t)((prout + sout) >> fb_shift);
                }
                prout = sout;
                pg_phase_out = (uint16_t)(pg_phase >> 9);
                pg_phase += phaseinc;
                mod_now = mod_kind == opl3_mod_zero ? 0 : mod_kind == opl3_mod_fb ? fbmod : src_out[k];
                index = (uint16_t)(pg_phase_out + mod_now) & 0x3ffu;
                sout = (int16_t)-(int32_t)((sign >> (index >> 8)) & 1u);
                out[k] = sout;
            }
        }
        eg_out = (uint16_t)(eg_rout + eg_tl_ksl + (trem_on ? b->tremolo[m - 1] : 0));
        pg_reset = 0;
        eg_gen = envelope_gen_num_release;
        k = m;
    }

    for (; k < m; k++)
    {
        const uint8_t tremv = trem_on ? b->tremolo[k] : 0;
        const int16_t mod_in = mod_kind == opl3_mod_zero ? 0 : mod_kind == opl3_mod_fb ? fbmod : src_out[k];
        int16_t mod_now;
        uint16_t phase;

        if (dormant_gen == write_gen)
        {
            out[k] = sout;
            continue;
        }
        if (!key && eg_rout == 0x1ff && eg_gen == envelope_gen_num_release && fb == 0 && pg_inc == 0 && sout == 0
            && prout == 0 && mod_in == 0 && eg_tl_ksl == 0 && tremv == 0 && pg_phase == 0 && reg_vib == 0
            && reg_wf == 0)
        {
            if (!trem_on && (mod_kind != opl3_mod_slot || src_dormant_from <= k))
            {
                dormant_gen = write_gen;
                dormant_from = k;
            }
            out[k] = sout;
            continue;
        }

        if (!key && eg_rout == 0x1ff)
        {
            uint32_t phaseinc;
            if (fb == 0 && pg_inc == 0 && sout == 0 && mod_in == 0 && eg_tl_ksl == 0 && tremv == 0
                && pg_phase == 0 && reg_vib == 0 && reg_wf == 0)
            {
                fbmod = 0;
                prout = 0;
                eg_out = 0x1ff;
                pg_reset = 0;
                eg_gen = envelope_gen_num_release;
                pg_phase_out = 0;
                out[k] = sout;
                continue;
            }
            fbmod = fb ? (int16_t)((prout + sout) >> (0x09 - fb)) : 0;
            prout = sout;
            eg_out = (uint16_t)(eg_rout + eg_tl_ksl + tremv);
            pg_reset = 0;
            eg_gen = envelope_gen_num_release;
            phaseinc = reg_vib ? slot->pg_inc_vib[b->vibpos[k]] : pg_inc;
            pg_phase_out = (uint16_t)(pg_phase >> 9);
            pg_phase += phaseinc;
            mod_now = mod_kind == opl3_mod_fb ? fbmod : mod_in;
            phase = (uint16_t)(pg_phase_out + mod_now);
            sout = (int16_t)((int16_t)wf[phase & 0x3ff] >> 15);
            out[k] = sout;
            continue;
        }

        fbmod = fb ? (int16_t)((prout + sout) >> (0x09 - fb)) : 0;
        prout = sout;
        if (eg_gen == envelope_gen_num_sustain && key && slot->eg_rates[envelope_gen_num_sustain] == 0)
        {
            eg_out = (uint16_t)(eg_rout + eg_tl_ksl + tremv);
            pg_reset = 0;
            if ((eg_rout & 0x1f8) == 0x1f8)
            {
                eg_rout = 0x1ff;
            }
        }
        else
        {
            /* OPL3Fast_EnvelopeCalc */
            uint8_t nonzero, rate_hi, rate_lo, reg_rate, eg_shift, shift = 0, eg_off = 0, reset = 0;
            uint16_t rout;
            int16_t eg_inc = 0;
            const uint8_t st = b->eg_state[k];
            eg_out = (uint16_t)(eg_rout + eg_tl_ksl + tremv);
            if (key && eg_gen == envelope_gen_num_release)
            {
                reset = 1;
                reg_rate = slot->eg_rates[0];
                rate_hi = slot->eg_rate_hi[0];
                rate_lo = slot->eg_rate_lo[0];
            }
            else
            {
                reg_rate = slot->eg_rates[eg_gen];
                rate_hi = slot->eg_rate_hi[eg_gen];
                rate_lo = slot->eg_rate_lo[eg_gen];
            }
            pg_reset = reset;
            nonzero = (reg_rate != 0);
            eg_shift = rate_hi + b->eg_add[k];
            if (nonzero)
            {
                if (rate_hi < 12)
                {
                    if (st)
                    {
                        switch (eg_shift)
                        {
                        case 12:
                            shift = 1;
                            break;
                        case 13:
                            shift = (rate_lo >> 1) & 0x01;
                            break;
                        case 14:
                            shift = rate_lo & 0x01;
                            break;
                        default:
                            break;
                        }
                    }
                }
                else
                {
                    shift = (rate_hi & 0x03) + eg_incstep[rate_lo][b->eg_timer_lo[k]];
                    if (shift & 0x04)
                    {
                        shift = 0x03;
                    }
                    if (!shift)
                    {
                        shift = st;
                    }
                }
            }
            rout = eg_rout;
            if (reset && rate_hi == 0x0f)
            {
                rout = 0x00;
            }
            if ((eg_rout & 0x1f8) == 0x1f8)
            {
                eg_off = 1;
            }
            if (eg_gen != envelope_gen_num_attack && !reset && eg_off)
            {
                rout = 0x1ff;
            }
            switch (eg_gen)
            {
            case envelope_gen_num_attack:
                if (!eg_rout)
                {
                    eg_gen = envelope_gen_num_decay;
                }
                else if (key && shift > 0 && rate_hi != 0x0f)
                {
                    eg_inc = ~eg_rout >> (4 - shift);
                }
                break;
            case envelope_gen_num_decay:
                if ((eg_rout >> 4) == reg_sl)
                {
                    eg_gen = envelope_gen_num_sustain;
                }
                else if (!eg_off && !reset && shift > 0)
                {
                    eg_inc = 1 << (shift - 1);
                }
                break;
            case envelope_gen_num_sustain:
            case envelope_gen_num_release:
                if (!eg_off && !reset && shift > 0)
                {
                    eg_inc = 1 << (shift - 1);
                }
                break;
            }
            eg_rout = (rout + eg_inc) & 0x1ff;
            if (reset)
            {
                eg_gen = envelope_gen_num_attack;
            }
            if (!key)
            {
                eg_gen = envelope_gen_num_release;
            }
        }

        /* OPL3Fast_PhaseGenerateImpl without the rhythm operators, then OPL3Fast_SlotGenerate */
        {
            const uint32_t phaseinc = reg_vib ? slot->pg_inc_vib[b->vibpos[k]] : pg_inc;
            uint16_t wf_data, neg;
            uint32_t level;
            pg_phase_out = (uint16_t)(pg_phase >> 9);
            if (pg_reset)
            {
                pg_phase = 0;
            }
            pg_phase += phaseinc;
            mod_now = mod_kind == opl3_mod_fb ? fbmod : mod_in;
            phase = (uint16_t)(pg_phase_out + mod_now);
            wf_data = wf[phase & 0x3ff];
            neg = (uint16_t)(((int16_t)wf_data) >> 15);
            level = (wf_data & 0x7fff) + ((uint32_t)eg_out << 3);
            if (level > 0x1fff)
            {
                level = 0x1fff;
            }
            sout = (int16_t)((exprom[level & 0xffu] >> (level >> 8)) ^ neg);
        }
        out[k] = sout;
    }

    slot->dormant_gen = dormant_gen;
    slot->pg_phase = pg_phase;
    slot->pg_reset = pg_reset;
    slot->pg_phase_out = pg_phase_out;
    slot->eg_rout = eg_rout;
    slot->eg_out = eg_out;
    slot->eg_gen = eg_gen;
    slot->out = sout;
    slot->prout = prout;
    slot->fbmod = fbmod;
    return dormant_from;
}

/* Runs both operators of channel over m samples (channels other than 7 and 8). */
static void OPL3Fast_BlockChannel(opl3_chip *chip, opl3_channel *channel, opl3_block *b, uint32_t m)
{
    uint8_t ii;
    for (ii = 0; ii < 2; ii++)
    {
        opl3_slot *slot = channel->slotz[ii];
        uint32_t sn = slot->slot_num;
        b->out[sn][0] = slot->out;
        if (slot->dormant_gen == chip->write_gen)
        {
            /* Dormant: out and prout are 0 and stay so until a write; the mix skips the operator. */
            b->silent[sn] = 1;
            b->dormant_from[sn] = 0;
            continue;
        }
        b->silent[sn] = 0;
        b->dormant_from[sn] = OPL3Fast_BlockSlot(chip, slot, channel->fb, b, m, &b->out[sn][1]);
    }
}

/* Runs channels 7 and 8 over m samples sample by sample through OPL3Fast_ProcessSlotMaybeInline, with the chip's
 * clocks set to each sample's values, so the rhythm operators (13, 16, 17) see each other in their order. */
static void OPL3Fast_BlockRhythm(opl3_chip *chip, opl3_block *b, uint32_t m)
{
    opl3_slot *order[4];
    uint8_t fb[4];
    uint32_t k;
    uint8_t ii;
    order[0] = chip->channel[7].slotz[0];
    order[1] = chip->channel[7].slotz[1];
    order[2] = chip->channel[8].slotz[0];
    order[3] = chip->channel[8].slotz[1];
    fb[0] = fb[1] = chip->channel[7].fb;
    fb[2] = fb[3] = chip->channel[8].fb;
    for (ii = 0; ii < 4; ii++)
    {
        b->out[order[ii]->slot_num][0] = order[ii]->out;
        b->silent[order[ii]->slot_num] = 0;
    }
    for (k = 0; k < m; k++)
    {
        chip->eg_add = b->eg_add[k];
        chip->eg_timer_lo = b->eg_timer_lo[k];
        chip->eg_state = b->eg_state[k];
        chip->vibpos = b->vibpos[k];
        chip->tremolo = b->tremolo[k];
        chip->noise_hh = b->noise_hh[k];
        chip->noise_sd = b->noise_sd[k];
        for (ii = 0; ii < 4; ii++)
        {
            OPL3Fast_ProcessSlotMaybeInline(order[ii], fb[ii], 1, chip->write_gen);
            b->out[order[ii]->slot_num][k + 1] = order[ii]->out;
        }
    }
}

/* Adds the channels of one mix list (mix_left or mix_right, with their out_left or out_right taps) into mix over m
 * samples, as the mix loops of OPL3Fast_Generate4Ch do for the front outputs: the channel's taps summed in 16 bits,
 * masked by its route (cha or chb), summed in 32 bits. A tap reads an operator's output array, a delayed tap the
 * same array one cell earlier; a silent operator's tap adds 0. Each loop is a plain array sum. */
static void OPL3Fast_BlockMix(opl3_chip *chip, opl3_block *b, opl3_channel **list, uint8_t count, int right,
                              int32_t *mix, uint32_t m)
{
    int16_t accm[OPL3_BLOCK];
    uint8_t ii;
    uint32_t k;
    for (k = 0; k < m; k++)
    {
        mix[k] = 0;
    }
    for (ii = 0; ii < count; ii++)
    {
        opl3_channel *channel = list[ii];
        int16_t **taps = right ? channel->out_right : channel->out_left;
        const int16_t *tap[4];
        uint8_t ntaps = 0;
        uint8_t jj;
        if (!(right ? channel->chb : channel->cha))
        {
            continue;
        }
        for (jj = 0; jj < channel->out_cnt && jj < 4; jj++)
        {
            int16_t *p = taps[jj];
            ptrdiff_t offset;
            uint32_t sn;
            if (p == &chip->zeromod)
            {
                continue;
            }
            offset = (char *)p - (char *)&chip->slot[0];
            sn = (uint32_t)(offset / (ptrdiff_t)sizeof(opl3_slot));
            if (b->silent[sn])
            {
                continue;
            }
            tap[ntaps++] = offset % (ptrdiff_t)sizeof(opl3_slot) == (ptrdiff_t)offsetof(opl3_slot, prout)
                         ? &b->out[sn][0] : &b->out[sn][1];
        }
        if (ntaps == 1)
        {
            const int16_t *t0 = tap[0];
            for (k = 0; k < m; k++)
            {
                mix[k] += t0[k];
            }
            continue;
        }
        if (ntaps == 0)
        {
            continue;
        }
        {
            const int16_t *t0 = tap[0], *t1 = tap[1];
            for (k = 0; k < m; k++)
            {
                accm[k] = (int16_t)(t0[k] + t1[k]);
            }
        }
        for (jj = 2; jj < ntaps; jj++)
        {
            const int16_t *t = tap[jj];
            for (k = 0; k < m; k++)
            {
                accm[k] = (int16_t)(accm[k] + t[k]);
            }
        }
        for (k = 0; k < m; k++)
        {
            mix[k] += accm[k];
        }
    }
}

/* Renders m samples (1 to OPL3_BLOCK) during which no buffered write falls due before the last; the writes due at
 * the last apply after it, as in OPL3Fast_Generate4Ch. buf receives m interleaved stereo frames. */
static void OPL3Fast_BlockRun(opl3_chip *chip, int16_t *buf, uint32_t m)
{
    opl3_block *b = &opl3_block_state;
    opl3_clock clock;
    opl3_writebuf *writebuf;
    uint32_t k;
    uint8_t ii;

    if (chip->mix_dirty)
    {
        OPL3Fast_RebuildMixLists(chip);
    }
    OPL3Fast_ClockLoad(chip, &clock);
    OPL3Fast_BlockClock(&clock, b, m);

    for (ii = 0; ii < 7; ii++)
    {
        OPL3Fast_BlockChannel(chip, &chip->channel[ii], b, m);
    }
    if (chip->rhy & 0x20)
    {
        OPL3Fast_BlockRhythm(chip, b, m);
    }
    else
    {
        /* Without rhythm mode, operators 13, 16 and 17 differ from the others only in that operator 13's phase
         * sets the hi-hat bits each sample (tc's bits change only in rhythm mode), and that they never take the
         * fast paths, which give the same results as the full path outside rhythm mode. So channels 7 and 8 run as
         * blocks, and the hi-hat bits come from operator 13's last phase. */
        opl3_slot *hh = &chip->slot[13];
        OPL3Fast_BlockChannel(chip, &chip->channel[7], b, m);
        OPL3Fast_BlockChannel(chip, &chip->channel[8], b, m);
        chip->rm_hh_bit2 = (hh->pg_phase_out >> 2) & 1;
        chip->rm_hh_bit3 = (hh->pg_phase_out >> 3) & 1;
        chip->rm_hh_bit7 = (hh->pg_phase_out >> 7) & 1;
        chip->rm_hh_bit8 = (hh->pg_phase_out >> 8) & 1;
    }
    for (ii = 9; ii < 18; ii++)
    {
        OPL3Fast_BlockChannel(chip, &chip->channel[ii], b, m);
    }
    OPL3Fast_ClockStore(chip, &clock);

    OPL3Fast_BlockMix(chip, b, chip->mix_left, chip->nmix_left, 0, b->mix_left, m);
    OPL3Fast_BlockMix(chip, b, chip->mix_right, chip->nmix_right, 1, b->mix_right, m);
    for (k = 0; k < m; k++)
    {
        buf[2 * k] = OPL3Fast_ClipSample(b->mix_left[k]);
        buf[2 * k + 1] = OPL3Fast_ClipSample(k ? b->mix_right[k - 1] : chip->mixbuff[1]);
    }
    chip->mixbuff[0] = b->mix_left[m - 1];
    chip->mixbuff[1] = b->mix_right[m - 1];

    chip->writebuf_samplecnt += m - 1;
    while ((writebuf = &chip->writebuf[chip->writebuf_cur]), writebuf->time <= chip->writebuf_samplecnt)
    {
        if (!(writebuf->reg & 0x200))
        {
            break;
        }
        writebuf->reg &= 0x1ff;
        OPL3Fast_WriteReg(chip, writebuf->reg, writebuf->data);
        chip->writebuf_cur = (chip->writebuf_cur + 1) % OPL_WRITEBUF_SIZE;
    }
    chip->writebuf_samplecnt++;
}

void OPL3Fast_GenerateBlock(opl3_chip *chip, int16_t *buf, uint32_t n)
{
    while (n)
    {
        uint32_t m = n < OPL3_BLOCK ? n : OPL3_BLOCK;
        const opl3_writebuf *writebuf = &chip->writebuf[chip->writebuf_cur];
        if (writebuf->reg & 0x200)
        {
            uint64_t due = writebuf->time <= chip->writebuf_samplecnt ? 1 : writebuf->time - chip->writebuf_samplecnt + 1;
            if (due < m)
            {
                m = (uint32_t)due;
            }
        }
        OPL3Fast_BlockRun(chip, buf, m);
        buf += 2 * m;
        n -= m;
    }
}
