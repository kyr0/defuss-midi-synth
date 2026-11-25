/* SPDX-License-Identifier: MIT
 * gus-gf1: a General MIDI driver that plays original Gravis UltraSound GF1PATCH110 patches
 * through the GF1 voice model of gf1_mixer.h (adapted from QEMU GUSEMU32). It reconstructs
 * Gravis' UltraMID driver from documents and does not execute UltraMID code.
 *
 * Sources: Gravis UltraSound SDK 2.10 documentation (ULTRADOC.TXT, Dec 1993): the patch format
 * (Appendix F), the GF1 voice rate table, registers (2.6.2) and volume ramps (2.16), the
 * 32-byte DRAM allocation granularity (UltraMemAlloc); ULTRAMID.INI, whose per-DRAM-size
 * substitution scripts/profile-assets.py applies when it packs the patches; the usage text
 * of ULTRAMID.EXE 1.12 ("-16 use 16-bit midi patches", "-c preload general midi patch set",
 * "Can't use -16 and -c parameters simultaneously", "Loading 8-bit patches").
 *
 * Our choices where no source says how: attenuation from velocity, CC7 and CC11 (the GM2
 * 40 log10 law in GF1 log units), pan offset from CC10, the wave chosen outside every
 * range, the reduction to 8 bits (high byte), LFO shape (triangle) and update rate (every
 * 32 frames), voice stealing, eviction order (least recently used, never a sounding wave),
 * hi-hat exclusion, and the immediate start of the next envelope segment (UltraMID used
 * the GF1 ramp IRQ, whose latency is not modelled).
 *
 * Driver data (DSPK role 33): byte 0 active voices 14..32; optional byte 1 flags:
 * bit 0 keeps 16-bit patches 16-bit (UltraMID -16), bit 1 preloads every mapped patch at
 * init (UltraMID -c). Without bit 0, 16-bit waves are stored as 8 bits, UltraMID's default.
 */
#include "profile_pack.h"
#include "gf1_mixer.h"
#define GUS_VOICES 32u
#define MAX_WAVES 4096u
#define MAX_LAYERS 4u
#define LFO_PERIOD 32u
#define FLAG_16BIT 1u
#define FLAG_PRELOAD 2u
/* Patch modes byte (SDK Appendix F). */
#define MODE_16BIT 1u
#define MODE_UNSIGNED 2u
#define MODE_LOOP 4u
#define MODE_BIDIR 8u
#define MODE_REVERSE 16u
#define MODE_SUSTAIN 32u
#define MODE_ENVELOPE 64u
#define MODE_FAST_RELEASE 128u

typedef struct {
    const uint8_t *data;
    uint32_t bytes, frames, loop_start, loop_end; /* loop points: 23.9, relative to the wave */
    uint32_t low, high, root;                     /* Hz * 1000 */
    uint16_t rate, scale_factor;
    int16_t scale_note;
    uint8_t modes, balance, rates[6], offsets[6], tremolo[3], vibrato[3];
    int32_t address;                              /* DRAM byte address, -1 when not resident */
    uint32_t size, used;
    uint16_t refs;
} wave;
typedef struct { uint16_t first[MAX_LAYERS]; uint8_t count[MAX_LAYERS], layers; } patch;
typedef struct { uint8_t program, volume, expression, pan, sustain, rpn_msb, rpn_lsb, bend_range; uint16_t bend; } channel;
typedef struct {
    gf1_voice chip;
    wave *w;
    uint32_t age, base, ticks, sweep_ticks, trem_phase, vib_phase, trem_step, vib_step;
    int32_t level;                    /* 12-bit target of the current segment, after attenuation */
    uint8_t active, ch, key, vel, held, released, stage, ramping, hold;
} voice;

static uint8_t *asset;
static uint32_t asset_size, rate, voice_count, flags, ready, serial, clock;
static uint8_t ram[GF1_RAM_SIZE];
static float pcm[PROFILE_BLOCK * 2];
static wave waves[MAX_WAVES];
static unsigned wave_count;
static patch patches[256];
static uint16_t resident[MAX_WAVES]; /* wave indices sorted by DRAM address */
static unsigned resident_count;
static channel channels[16];
static voice voices[GUS_VOICES];
static uint8_t sysex[PROFILE_SYSEX_MAX];
/* round(512 * log2(127 / x)): 256 GF1 volume units per halving, so 40 log10(x / 127) dB. */
static const uint16_t attenuation[128] = {4095,3578,3066,2767,2554,2389,2255,2141,2042,1955,1877,1807,1743,1684,1629,1578,1530,1485,1443,1403,1365,1329,1295,1262,1231,1201,1172,1144,1117,1091,1066,1042,1018,995,973,952,931,911,891,872,853,835,817,800,783,766,750,734,719,703,689,674,660,646,632,618,605,592,579,566,554,542,530,518,506,495,483,472,461,451,440,430,419,409,399,389,379,370,360,351,341,332,323,314,305,297,288,279,271,263,254,246,238,230,222,214,207,199,191,184,177,169,162,155,148,141,134,127,120,113,106,99,93,86,80,73,67,61,54,48,42,36,30,24,18,12,6,0};

/* GF1PATCH110 (SDK Appendix F): 129-byte header, 63-byte instrument header, 47-byte layer
 * header, then per wave a 96-byte header and wave_size bytes of data. Only the first
 * instrument is used ("All of the gravis patches contain only one instrument"). */
static int parse_wave(const uint8_t *h, const uint8_t *data, uint32_t bytes) {
    if (wave_count >= MAX_WAVES) return 0;
    unsigned modes = h[55], wide = modes & MODE_16BIT;
    uint32_t frames = wide ? bytes / 2 : bytes, ls = profile_le32(h + 12), le = profile_le32(h + 16);
    if (frames < 2 || bytes > GF1_BANK || !rd16(h + 20) || !profile_le32(h + 30)) return 0;
    if (wide) { ls /= 2; le /= 2; } /* byte offsets; odd ones (PISTOL.PAT) floor to a sample */
    /* Fractions (23.9 bits 8-5): low nibble for the loop start, high nibble for the loop end.
     * The SDK text says the reverse; the Gravis set disagrees: with this order 125 of the 140
     * looped waves of one to three periods match their root frequency better (TiMidity agrees). */
    uint32_t start = ls << 9 | (uint32_t)(h[7] & 15) << 5, end = le << 9 | (uint32_t)(h[7] >> 4) << 5;
    if ((modes & MODE_LOOP) && (start >= end || le > frames)) return 0;
    wave *w = &waves[wave_count++];
    *w = (wave){.data = data, .bytes = bytes, .frames = frames, .loop_start = start, .loop_end = end,
        .low = profile_le32(h + 22), .high = profile_le32(h + 26), .root = profile_le32(h + 30), .rate = rd16(h + 20),
        .scale_note = rds16(h + 56), .scale_factor = rd16(h + 58), .modes = (uint8_t)modes,
        .balance = h[36] > 15 ? 15 : h[36], .address = -1};
    if (w->scale_factor == 1 || w->scale_factor == 2) w->scale_factor *= 1024; /* "from 0 to 2048 or 0 to 2" */
    if (w->scale_factor > 2048) w->scale_factor = 2048;
    memcpy(w->rates, h + 37, 6); memcpy(w->offsets, h + 43, 6); memcpy(w->tremolo, h + 49, 3); memcpy(w->vibrato, h + 52, 3);
    return 1;
}
static int parse_pat(const uint8_t *p, uint32_t n, unsigned index) {
    if (n < 129 + 63 || memcmp(p, "GF1PATCH110", 11) || !p[82]) return 0; /* UltraMID rejects 100: "Old patch" */
    uint32_t off = 129;
    unsigned layers = p[off + 22];
    off += 63;
    if (!layers || layers > MAX_LAYERS) return 0;
    patch *q = &patches[index];
    for (unsigned j = 0; j < layers; j++) {
        if (n - off < 47) return 0;
        unsigned count = p[off + 6];
        if (p[off] || !count) return 0; /* layer_duplicate is "currently unused" and absent from the set */
        off += 47;
        q->first[j] = (uint16_t)wave_count; q->count[j] = (uint8_t)count;
        for (unsigned k = 0; k < count; k++) {
            if (n - off < 96) return 0;
            const uint8_t *h = p + off;
            uint32_t bytes = profile_le32(h + 8);
            off += 96;
            if (bytes > n - off || !parse_wave(h, p + off, bytes)) return 0;
            off += bytes;
        }
    }
    q->layers = (uint8_t)layers;
    return 1;
}
static int parse_bank(const uint8_t *p, uint32_t n) {
    if (n < 12 || memcmp(p, "GPAT", 4) || profile_le32(p + 4) != 1) return 0;
    uint32_t count = profile_le32(p + 8), off = 12;
    if (!count || count > 256) return 0;
    static const uint8_t *seen[256];
    static uint32_t seen_size[256], seen_slot[256];
    wave_count = 0; memset(patches, 0, sizeof(patches));
    for (uint32_t i = 0; i < count; i++) {
        if (n - off < 8) return 0;
        uint32_t index = profile_le32(p + off), size = profile_le32(p + off + 4), j = 0;
        off += 8;
        if (index >= 256 || patches[index].layers || !size || size > n - off) return 0;
        /* ULTRAMID.INI substitutes patch numbers: one patch file loads once, whatever number of
         * programs and drum notes share it. Identical records therefore share their waves. */
        while (j < i && (seen_size[j] != size || memcmp(seen[j], p + off, size))) j++;
        if (j < i) patches[index] = patches[seen_slot[j]];
        else if (!parse_pat(p + off, size, index)) return 0;
        seen[i] = p + off; seen_size[i] = size; seen_slot[i] = index;
        off += size;
    }
    return off == n;
}

/* DRAM: 1 MiB in four 256 KiB banks. A 16-bit voice cannot address across a bank and a DMA
 * cannot cross one (SDK 2.6.1.2, UltraMemAlloc), so every wave sits inside one bank, on a
 * 32-byte boundary, rounded up to 32 bytes. Resident waves stay sorted by address. */
static uint32_t dram_bytes(const wave *w) { return (w->modes & MODE_16BIT) && (flags & FLAG_16BIT) ? w->frames * 2 : w->frames; }
static int find_space(uint32_t size, uint32_t *out) {
    unsigned i = 0;
    for (uint32_t bank = 0; bank < GF1_RAM_SIZE; bank += GF1_BANK) {
        uint32_t at = bank;
        for (; i < resident_count && (uint32_t)waves[resident[i]].address < bank + GF1_BANK; i++) {
            const wave *r = &waves[resident[i]];
            if ((uint32_t)r->address - at >= size) { *out = at; return 1; }
            at = (uint32_t)r->address + r->size;
        }
        if (bank + GF1_BANK - at >= size) { *out = at; return 1; }
    }
    return 0;
}
static void evict(unsigned k) {
    waves[resident[k]].address = -1;
    for (resident_count--; k < resident_count; k++) resident[k] = resident[k + 1];
}
static void upload(wave *w, uint32_t at) {
    uint8_t *d = ram + at;
    unsigned flip = w->modes & MODE_UNSIGNED ? 0x80u : 0; /* GF1 DRAM holds signed data (SDK DMA control bit 7) */
    if (!(w->modes & MODE_16BIT)) for (uint32_t i = 0; i < w->frames; i++) d[i] = (uint8_t)(w->data[i] ^ flip);
    else if (flags & FLAG_16BIT) for (uint32_t i = 0; i < w->frames; i++) { d[2 * i] = w->data[2 * i]; d[2 * i + 1] = (uint8_t)(w->data[2 * i + 1] ^ flip); }
    else for (uint32_t i = 0; i < w->frames; i++) d[i] = (uint8_t)(w->data[2 * i + 1] ^ flip);
    memset(d + dram_bytes(w), 0, w->size - dram_bytes(w));
}
/* Make a wave resident, evicting least recently used waves that no voice plays. */
static int load(wave *w) {
    w->used = ++serial;
    if (w->address >= 0) return 1;
    uint32_t size = (dram_bytes(w) + 31u) & ~31u, at = 0;
    while (!find_space(size, &at)) {
        int victim = -1;
        for (unsigned i = 0; i < resident_count; i++) {
            const wave *r = &waves[resident[i]];
            if (!r->refs && (victim < 0 || serial - r->used > serial - waves[resident[victim]].used)) victim = (int)i;
        }
        if (victim < 0) return 0; /* UltraMID: "No more memory available on UltraSound card" */
        evict((unsigned)victim);
    }
    unsigned k = resident_count++;
    for (; k && (uint32_t)waves[resident[k - 1]].address > at; k--) resident[k] = resident[k - 1];
    resident[k] = (uint16_t)(w - waves);
    w->address = (int32_t)at; w->size = size;
    upload(w, at);
    return 1;
}
static int preload(void) {
    for (unsigned i = 0; i < wave_count; i++) { if (!load(&waves[i])) return 0; waves[i].refs = 1; } /* pinned */
    return 1;
}

static void defaults(channel *c) { *c = (channel){.volume = 100, .expression = 127, .pan = 64, .rpn_lsb = 127, .rpn_msb = 127, .bend_range = 2, .bend = 8192}; }
static void free_voice(voice *v) { if (v->active) { v->w->refs--; v->active = 0; } }
static void reset(void) {
    for (unsigned i = 0; i < GUS_VOICES; i++) free_voice(&voices[i]);
    for (unsigned i = 0; i < 16; i++) defaults(&channels[i]);
    if (!(flags & FLAG_PRELOAD)) { for (unsigned i = 0; i < wave_count; i++) waves[i].address = -1; resident_count = 0; }
    serial = 0; clock = 0;
}

/* Keyboard scaling: scale_note is the pivot, 1024 one semitone per key (SDK Appendix F). */
static float pitch_mhz(const wave *w, unsigned key, float cents) {
    float steps = (w->scale_note - 69) + ((int)key - w->scale_note) * (w->scale_factor / 1024.f);
    return 440000.f * vintage_exp2((steps + cents / 100.f) / 12.f);
}
/* The SDK: the wave whose range holds the frequency; of overlapping waves the later one. */
static wave *select_wave(const patch *p, unsigned layer, unsigned key) {
    wave *best = NULL;
    uint32_t distance = UINT32_MAX;
    for (unsigned i = 0; i < p->count[layer]; i++) {
        wave *w = &waves[p->first[layer] + i];
        float hz = pitch_mhz(w, key, 0);
        uint32_t f = hz < 4.0e9f ? (uint32_t)hz : UINT32_MAX; /* scale_note is any int16 in a damaged file */
        uint32_t d = f < w->low ? w->low - f : f > w->high ? f - w->high : 0;
        if (d <= distance) { best = w; distance = d; }
    }
    return best;
}
static int lfo(uint32_t phase) { int t = (int)(phase >> 16); return t < 32768 ? 2 * t - 32768 : 98303 - 2 * t; } /* triangle, +-32767 */
static uint32_t lfo_step(uint8_t r) { return (uint32_t)((0.05f + r * (5.95f / 255.f)) * LFO_PERIOD / rate * 4294967296.f); } /* 0: 0.05 Hz, 255: 6 Hz */
static void refresh_pitch(voice *v) {
    const channel *c = &channels[v->ch];
    const wave *w = v->w;
    float cents = ((int)c->bend - 8192) / 8192.f * c->bend_range * 100.f;
    if (w->vibrato[2]) {
        float sweep = !w->vibrato[0] || v->ticks >= v->sweep_ticks ? 1.f : (float)v->ticks / v->sweep_ticks;
        cents += w->vibrato[2] * (600.f / 255.f) * sweep * lfo(v->vib_phase) / 32768.f; /* 255: one octave */
    }
    /* SDK: fc = ((speed << 9) + divisor / 2) / divisor << 1, speed = sample rate * pitch / root. */
    float fc = w->rate * (pitch_mhz(w, v->key, cents) / w->root) * 512.f / rate + 0.5f;
    v->chip.freq = (uint16_t)((fc >= 32767.f ? 32767u : fc < 1.f ? 1u : (unsigned)fc) << 1);
}
static void refresh_pan(voice *v) {
    int cc = channels[v->ch].pan, offset = ((cc - 64) * 8 + (cc >= 64 ? 32 : -32)) / 64;
    int pan = v->w->balance + offset;
    v->chip.pan = (uint8_t)(pan < 0 ? 0 : pan > 15 ? 15 : pan);
}
static int32_t voice_attenuation(const voice *v) {
    const channel *c = &channels[v->ch];
    return attenuation[v->vel] + attenuation[c->volume] + attenuation[c->expression];
}
/* Ramp toward an 8-bit GF1 volume ("the offset values are sent directly to the GF1 hardware").
 * Returns 0 when the volume is already there. */
static int ramp(voice *v, unsigned offset, uint8_t ramp_rate) {
    int32_t level = ((int32_t)offset << 4) - voice_attenuation(v);
    v->level = level < 0 ? 0 : level;
    unsigned target = (unsigned)v->level >> 4, current = (v->chip.vol32 >> 13) & 255u;
    v->chip.ramp_rate = ramp_rate;
    if (target == current) { v->chip.ramp_control = GF1_STOPPED; v->ramping = 0; return 0; }
    if (target > current) { v->chip.ramp_start = (uint8_t)current; v->chip.ramp_end = (uint8_t)target; v->chip.ramp_control = 0; }
    else { v->chip.ramp_start = (uint8_t)target; v->chip.ramp_end = (uint8_t)current; v->chip.ramp_control = GF1_DECREASE; }
    v->ramping = 1;
    return 1;
}
/* Envelope complete: with the envelope bit, "the sample release occurs after the last
 * envelope point": looping stops and the voice plays to the end of the wave. */
static void loop_off(voice *v) {
    v->chip.control &= (uint16_t)~(GF1_LOOP | GF1_BIDIR);
    v->chip.start = v->base << 9; v->chip.end = (v->base + v->w->frames - 1) << 9;
}
static void advance(voice *v) {
    for (;;) {
        if (v->stage == 2 && (v->w->modes & MODE_SUSTAIN) && !v->released) { v->hold = 1; return; } /* sustain point */
        if (v->stage >= 5) { v->stage = 6; loop_off(v); return; }
        v->stage++;
        if (ramp(v, v->w->offsets[v->stage], v->w->rates[v->stage])) return;
    }
}
static void release(voice *v) {
    if (v->released) return;
    v->released = 1;
    unsigned modes = v->w->modes;
    if (!(modes & MODE_ENVELOPE) || (modes & MODE_FAST_RELEASE)) { v->hold = 0; v->ramping = 0; v->chip.ramp_control = GF1_STOPPED; v->stage = 6; loop_off(v); return; }
    if (!(modes & MODE_SUSTAIN) || v->stage > 2) return; /* only sustain stops enveloping; note off continues it */
    v->hold = 0; v->stage = 3;
    if (!ramp(v, v->w->offsets[3], v->w->rates[3])) advance(v);
}
static voice *allocate(void) {
    voice *best = &voices[0];
    for (unsigned i = 0; i < voice_count; i++) {
        voice *v = &voices[i];
        if (!v->active) return v;
        int a = v->stage > 2, b = best->stage > 2;
        if (a > b || (a == b && serial - v->age > serial - best->age)) best = v;
    }
    free_voice(best);
    return best;
}
static void start(unsigned ch, unsigned key, unsigned vel, wave *w) {
    voice *v = allocate();
    if (!load(w)) return;
    int wide = (w->modes & MODE_16BIT) && (flags & FLAG_16BIT);
    uint32_t base = wide ? gf1_address16((uint32_t)w->address) : (uint32_t)w->address;
    *v = (voice){.w = w, .active = 1, .ch = (uint8_t)ch, .key = (uint8_t)key, .vel = (uint8_t)vel, .held = 1, .age = ++serial, .base = base};
    w->refs++;
    v->chip.control = wide ? GF1_16BIT : 0;
    v->chip.start = base << 9; v->chip.end = (base + w->frames - 1) << 9; v->chip.pos = v->chip.start;
    if (w->modes & MODE_LOOP) {
        v->chip.control |= GF1_LOOP | (w->modes & MODE_BIDIR ? GF1_BIDIR : 0);
        v->chip.start = (base << 9) + w->loop_start; v->chip.end = (base << 9) + w->loop_end;
    }
    /* "play patch backwards. start at end address, loop backwards, and then end at beginning address" */
    if (w->modes & MODE_REVERSE) { v->chip.control |= GF1_DECREASE; v->chip.pos = (base + w->frames - 1) << 9; }
    v->trem_step = lfo_step(w->tremolo[1]); v->vib_step = lfo_step(w->vibrato[1]);
    v->trem_phase = v->vib_phase = 1u << 30; /* triangle starts at 0, rising */
    v->sweep_ticks = (uint32_t)(w->vibrato[0] / 45.f * rate / LFO_PERIOD); /* "vibrato_sweep / 45 seconds" */
    refresh_pitch(v); refresh_pan(v);
    if (!(w->modes & MODE_ENVELOPE)) { /* no envelope: full level at once, sampled release at note off */
        int32_t level = (255 << 4) - voice_attenuation(v);
        v->level = level < 0 ? 0 : level; v->chip.vol32 = (uint32_t)v->level << 9;
        v->chip.ramp_control = GF1_STOPPED; v->stage = 2; v->hold = 1;
        return;
    }
    if (!ramp(v, w->offsets[0], w->rates[0])) advance(v);
}
static void note_on(unsigned ch, unsigned key, unsigned vel) {
    const patch *p = &patches[ch == 9 ? 128 + key : channels[ch].program];
    if (ch == 9 && (key == 42 || key == 44 || key == 46)) /* our choice: hi-hats choke each other */
        for (unsigned i = 0; i < voice_count; i++) if (voices[i].active && voices[i].ch == 9 && (voices[i].key == 42 || voices[i].key == 44 || voices[i].key == 46)) free_voice(&voices[i]);
    for (unsigned j = 0; j < p->layers; j++) { wave *w = select_wave(p, j, key); if (w) start(ch, key, vel, w); }
}
static void note_off(unsigned ch, unsigned key) {
    for (unsigned i = 0; i < voice_count; i++) {
        voice *v = &voices[i];
        if (v->active && v->ch == ch && v->key == key && v->held) { v->held = 0; if (!channels[ch].sustain) release(v); }
    }
}
/* Level change: restart the running segment toward the new level; at the sustain point a
 * fast ramp (rate 63) moves there. */
static void relevel(voice *v) {
    if (v->stage > 5 || !(v->w->modes & MODE_ENVELOPE)) return;
    if (v->hold) ramp(v, v->w->offsets[2], 63); else if (v->ramping) ramp(v, v->w->offsets[v->stage], v->w->rates[v->stage]);
}
static void control(unsigned ch, unsigned a, unsigned b) {
    channel *c = &channels[ch];
    switch (a) {
    case 6: if (!c->rpn_lsb && !c->rpn_msb) c->bend_range = (uint8_t)(b > 24 ? 24 : b); break;
    case 7: c->volume = (uint8_t)b; break;
    case 10: c->pan = (uint8_t)b; break;
    case 11: c->expression = (uint8_t)b; break;
    case 64: c->sustain = b >= 64; break;
    case 100: c->rpn_lsb = (uint8_t)b; break;
    case 101: c->rpn_msb = (uint8_t)b; break;
    case 121: c->expression = 127; c->sustain = 0; c->rpn_lsb = c->rpn_msb = 127; c->bend = 8192; break; /* RP-015 */
    default: break;
    }
    for (unsigned i = 0; i < voice_count; i++) {
        voice *v = &voices[i];
        if (!v->active || v->ch != ch) continue;
        if (a == 120) { free_voice(v); continue; }
        if (a == 123) v->held = 0;
        if (!v->held && !c->sustain) release(v);
        if (a == 7 || a == 11 || a == 121) relevel(v);
        if (a == 10) refresh_pan(v);
        if (a == 121) refresh_pitch(v);
    }
}
static void lfo_tick(voice *v) {
    const wave *w = v->w;
    v->ticks++;
    if (w->vibrato[2]) { v->vib_phase += v->vib_step; refresh_pitch(v); }
    /* "Tremolo starts automatically when the note sustains"; 255 is a 16 dB modulation. */
    if (w->tremolo[2] && v->hold && !v->ramping) {
        v->trem_phase += v->trem_step;
        int32_t level = v->level + (int32_t)w->tremolo[2] * 340 / 255 * lfo(v->trem_phase) / 32768;
        v->chip.vol32 = (uint32_t)(level < 0 ? 0 : level > 4095 ? 4095 : level) << 9;
    }
}

PROFILE_EXPORT uint32_t profile_abi(void) { return PROFILE_ABI; }
PROFILE_EXPORT uint32_t profile_model(void) { return 6; }
PROFILE_EXPORT void profile_close(void) { reset(); ready = 0; free(asset); asset = NULL; asset_size = 0; }
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (ready || !n || n > PROFILE_MAX_ASSET) return NULL;
    free(asset); asset = malloc(n); asset_size = asset ? n : 0;
    return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    profile_record r[64];
    if (ready || n != asset_size || !profile_parse(asset, n, 6, r) || !r[32].size) return 0;
    for (unsigned i = 0; i < 64; i++) if (r[i].size && i != 32 && i != 33) return 0;
    voice_count = 32; flags = 0;
    if (r[33].size) {
        if (r[33].size > 2 || r[33].data[0] < 14 || r[33].data[0] > 32) return 0;
        voice_count = r[33].data[0];
        if (r[33].size == 2) flags = r[33].data[1];
        if (flags > 3 || flags == (FLAG_16BIT | FLAG_PRELOAD)) return 0; /* "Can't use -16 and -c parameters simultaneously" */
    }
    rate = 617400u / voice_count; /* SDK rate table: 44100 Hz at 14 voices ... 19293 Hz at 32 */
    if (!parse_bank(r[32].data, r[32].size)) return 0;
    resident_count = 0;
    for (unsigned i = 0; i < wave_count; i++) waves[i].address = -1;
    reset();
    if ((flags & FLAG_PRELOAD) && !preload()) return 0;
    ready = 1;
    return 1;
}
PROFILE_EXPORT uint32_t profile_rate(void) { return ready ? rate : 0; }
PROFILE_EXPORT int32_t profile_voices(void) { int n = 0; for (unsigned i = 0; i < voice_count; i++) n += voices[i].active != 0; return n; }
PROFILE_EXPORT uint8_t *profile_sysex_buffer(void) { return sysex; }
/* GM, GM2, GS and XG resets restore the power-on state; no other SysEx changes this driver. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n) {
    if (!ready || !profile_sysex_valid(sysex, n)) return 0;
    if (profile_sysex_is_reset(sysex, n)) reset();
    return 1;
}
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!ready) return 0;
    if (s == 255) { reset(); return 1; }
    if (s < 128 || s > 239 || a > 127 || b > 127) return 0;
    unsigned ch = s & 15;
    switch (s & 240) {
    case 0x80: note_off(ch, a); break;
    case 0x90: if (b) note_on(ch, a, b); else note_off(ch, a); break;
    case 0xb0: control(ch, a, b); break;
    case 0xc0: channels[ch].program = (uint8_t)a; break;
    case 0xe0: channels[ch].bend = (uint16_t)(a | b << 7); for (unsigned i = 0; i < voice_count; i++) if (voices[i].active && voices[i].ch == ch) refresh_pitch(&voices[i]); break;
    default: break;
    }
    return 1;
}
PROFILE_EXPORT float *profile_render(uint32_t n) {
    if (!ready || n > PROFILE_BLOCK) return NULL;
    for (unsigned j = 0; j < n; j++) {
        int tick = (clock++ % LFO_PERIOD) == 0;
        int32_t l = 0, r = 0;
        for (unsigned i = 0; i < voice_count; i++) {
            voice *v = &voices[i];
            if (!v->active) continue;
            if (tick) lfo_tick(v);
            gf1_mix_voice(&v->chip, ram, &l, &r);
            if (v->chip.control & GF1_STOPPED) { free_voice(v); continue; }
            if (v->ramping && (v->chip.ramp_control & GF1_STOPPED)) { v->ramping = 0; if (v->hold) continue; advance(v); }
        }
        pcm[j] = clampf(l / 32768.f, -1, 1);
        pcm[n + j] = clampf(r / 32768.f, -1, 1);
    }
    return pcm;
}
