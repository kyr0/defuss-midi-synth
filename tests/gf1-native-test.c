/* Native harness for native/profiles/gus.c, driven by scripts/profile-gf1-test.mjs.
 *   gf1-native-test render PACK EVENTS OUT   render an event script, write float32 blocks
 *   gf1-native-test fuzz CASES SEED PAT...   init and play mutations of the given PAT files
 * EVENTS: records of u32 LE frames to render first (in 128-frame blocks), then u8 status, a, b, pad.
 * Build with -ffp-contract=off so float arithmetic matches WASM, which has no fused multiply-add. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
void *profile_buffer(uint32_t); uint32_t profile_init(uint32_t); void profile_close(void); uint32_t profile_rate(void);
uint32_t profile_message(uint32_t, uint32_t, uint32_t); float *profile_render(uint32_t); int32_t profile_voices(void);
uint8_t *profile_sysex_buffer(void); uint32_t profile_sysex(uint32_t);
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #x); exit(1); } } while (0)

static uint8_t *slurp(const char *path, long *n) {
    FILE *f = fopen(path, "rb"); CHECK(f);
    CHECK(fseek(f, 0, SEEK_END) == 0); *n = ftell(f); CHECK(*n > 0); rewind(f);
    uint8_t *b = malloc((size_t)*n); CHECK(b && fread(b, 1, (size_t)*n, f) == (size_t)*n); fclose(f);
    return b;
}
static int load(const uint8_t *pack, size_t n) {
    uint8_t *b = profile_buffer((uint32_t)n); if (!b) return 0;
    memcpy(b, pack, n); return profile_init((uint32_t)n) == 1;
}
static void put32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }
static uint32_t rng;
static uint32_t next(void) { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }

static int render_script(const char *pack_path, const char *events_path, const char *out_path) {
    long n, m; uint8_t *pack = slurp(pack_path, &n), *ev = slurp(events_path, &m);
    CHECK(m % 8 == 0); CHECK(load(pack, (size_t)n));
    FILE *out = fopen(out_path, "wb"); CHECK(out);
    for (long i = 0; i < m; i += 8) {
        uint32_t frames = (uint32_t)ev[i] | (uint32_t)ev[i + 1] << 8 | (uint32_t)ev[i + 2] << 16 | (uint32_t)ev[i + 3] << 24;
        for (uint32_t at = 0; at < frames; at += 128) {
            uint32_t k = frames - at < 128 ? frames - at : 128; float *pcm = profile_render(k); CHECK(pcm);
            CHECK(fwrite(pcm, sizeof(float), 2 * k, out) == 2 * k);
        }
        if (ev[i + 4] == 0xf0) { /* GS reset as the SysEx case */
            static const uint8_t gs[] = {0xf0,0x41,0x10,0x42,0x12,0x40,0x00,0x7f,0x00,0x41,0xf7};
            memcpy(profile_sysex_buffer(), gs, sizeof gs); CHECK(profile_sysex(sizeof gs) == 1);
        } else if (ev[i + 4]) CHECK(profile_message(ev[i + 4], ev[i + 5], ev[i + 6]) == 1);
    }
    fclose(out); profile_close(); free(pack); free(ev);
    return 0;
}

/* GF1PATCH110 offsets (SDK Appendix F) that steer the parser and the voice set-up. */
static const unsigned header_fields[] = {82, 129 + 22, 129 + 63, 129 + 63 + 6};
static const unsigned wave_fields[] = {7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 20, 21, 22, 26, 30, 31, 36, 37, 40, 43, 46, 49, 51, 53, 54, 55, 56, 57, 58, 59};
static int fuzz(unsigned cases, uint32_t seed, int count, char **paths) {
    long *sizes = calloc((size_t)count, sizeof(long)); uint8_t **pats = calloc((size_t)count, sizeof(*pats)); CHECK(sizes && pats);
    for (int i = 0; i < count; i++) pats[i] = slurp(paths[i], &sizes[i]);
    rng = seed ? seed : 0x2f6b1d3u;
    unsigned accepted = 0, rejected = 0, notes = 0;
    for (unsigned c = 0; c < cases; c++) {
        int which = (int)(next() % (uint32_t)count); long len = sizes[which];
        uint8_t *pat = malloc((size_t)len); CHECK(pat); memcpy(pat, pats[which], (size_t)len);
        if (c) { /* case 0 is the unmodified file */
            unsigned kind = next() % 4, edits = 1 + next() % 6;
            for (unsigned e = 0; e < edits; e++) {
                if (kind == 0) pat[next() % (uint32_t)len] ^= (uint8_t)(1u << (next() % 8));
                else if (kind == 1) pat[next() % (uint32_t)len] = (uint8_t)next();
                else if (kind == 2) { unsigned f = header_fields[next() % 4]; if ((long)f < len) pat[f] = (uint8_t)next(); }
                else { unsigned f = 129 + 63 + 47 + wave_fields[next() % (sizeof wave_fields / sizeof *wave_fields)]; if ((long)f < len) pat[f] = (uint8_t)(next() % 3 ? next() : 0xff); }
            }
            if (next() % 16 == 0) len = 1 + (long)(next() % (uint32_t)len); /* truncation */
        }
        /* GPAT with the patch on program 0, program 1 and drum note 36, inside a DSPK. */
        size_t gpat_len = 12 + 3 * (8 + (size_t)len), total = 16 + 8 + gpat_len + 8 + 2;
        uint8_t *pack = malloc(total); CHECK(pack); uint8_t *q = pack;
        memcpy(q, "DSPK", 4); put32(q + 4, 1); put32(q + 8, 6); put32(q + 12, 2); q += 16;
        put32(q, 32); put32(q + 4, (uint32_t)gpat_len); q += 8;
        memcpy(q, "GPAT", 4); put32(q + 4, 1); put32(q + 8, 3); q += 12;
        const uint32_t slots[3] = {0, 1, 164};
        for (int s = 0; s < 3; s++) { put32(q, slots[s]); put32(q + 4, (uint32_t)len); memcpy(q + 8, pat, (size_t)len); q += 8 + (size_t)len; }
        put32(q, 33); put32(q + 4, 2); q[8] = (uint8_t)(14 + next() % 19); q[9] = (uint8_t)(next() % 3); q += 10;
        if (c && next() % 32 == 0) pack[next() % (uint32_t)total] ^= (uint8_t)next(); /* container mutation */
        if (load(pack, total)) {
            accepted++;
            CHECK(profile_rate() == 617400u / pack[total - 2]);
            for (unsigned k = 0; k < 24; k++) {
                uint32_t r = next(), ch = r % 3 == 2 ? 9 : r % 2;
                switch (next() % 8) {
                case 0: case 1: case 2: CHECK(profile_message(0x90 | ch, next() % 128, 1 + next() % 127)); notes++; break;
                case 3: CHECK(profile_message(0x80 | ch, next() % 128, 0)); break;
                case 4: CHECK(profile_message(0xb0 | ch, (uint32_t[]){7, 10, 11, 64, 120, 121, 123, 6}[next() % 8], next() % 128)); break;
                case 5: CHECK(profile_message(0xe0 | ch, next() % 128, next() % 128)); break;
                case 6: CHECK(profile_message(0xc0 | ch, next() % 2, 0)); break;
                default: if (next() % 4 == 0) CHECK(profile_message(0xff, 0, 0)); break;
                }
                unsigned blocks = 1 + next() % 24;
                for (unsigned b = 0; b < blocks; b++) {
                    float *pcm = profile_render(128); CHECK(pcm);
                    for (unsigned i = 0; i < 256; i++) CHECK(isfinite(pcm[i]) && fabsf(pcm[i]) <= 1.f);
                }
                CHECK(profile_voices() >= 0 && profile_voices() <= 32);
            }
        } else rejected++;
        profile_close(); free(pack); free(pat);
    }
    printf("{\"cases\":%u,\"accepted\":%u,\"rejected\":%u,\"notes\":%u}\n", cases, accepted, rejected, notes);
    for (int i = 0; i < count; i++) free(pats[i]);
    free(pats); free(sizes);
    return 0;
}
int main(int argc, char **argv) {
    if (argc == 5 && !strcmp(argv[1], "render")) return render_script(argv[2], argv[3], argv[4]);
    if (argc >= 5 && !strcmp(argv[1], "fuzz")) return fuzz((unsigned)strtoul(argv[2], NULL, 10), (uint32_t)strtoul(argv[3], NULL, 10), argc - 4, argv + 4);
    fprintf(stderr, "usage: %s render PACK EVENTS OUT | fuzz CASES SEED PAT...\n", argv[0]);
    return 2;
}
