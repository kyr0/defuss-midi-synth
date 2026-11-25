/* SPDX-License-Identifier: MIT */
#ifndef DEFUSS_PROFILE_PACK_H
#define DEFUSS_PROFILE_PACK_H
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#define PROFILE_EXPORT __attribute__((used, visibility("default")))
#define PROFILE_BLOCK 128u
#define PROFILE_MAX_ASSET (128u * 1024u * 1024u)
/* ABI 2 (this file's contract; every core exports all of these):
 *   profile_abi() -> PROFILE_ABI; profile_model() -> the profile id of src/profiles.ts;
 *   profile_buffer(n) -> n writable bytes for the DSPK asset; profile_init(n) -> 1, or 0 for invalid or missing assets;
 *   profile_rate() -> the native sample rate in Hz; profile_voices() -> sounding voices, or -1 when the core hides them;
 *   profile_message(status, a, b) -> 1: channel messages 0x80..0xEF, and 0xFF for a reset to the power-on state;
 *   profile_sysex_buffer() -> PROFILE_SYSEX_MAX writable bytes; profile_sysex(n) -> 1 when its first n bytes are one
 *     message F0 .. F7 (data bytes below 0x80) that the core applied or deliberately ignored, 0 when malformed;
 *   profile_render(n), n <= PROFILE_BLOCK -> planar float32 left[n] then right[n] at the native rate;
 *   profile_close() frees the instance. Messages and SysEx take effect at the next rendered frame.
 * The module is a reactor (no start function); imports are limited to src/profile-voices.ts instantiateProfile's. */
#define PROFILE_ABI 2u
#define PROFILE_SYSEX_MAX 65536u
static inline int profile_sysex_valid(const uint8_t *p, uint32_t n) {
    if (!p || n < 2 || n > PROFILE_SYSEX_MAX || p[0] != 0xf0 || p[n - 1] != 0xf7) return 0;
    for (uint32_t i = 1; i + 1 < n; i++) if (p[i] & 0x80) return 0;
    return 1;
}
/* GM System On, GM2 System On, GS Reset and XG System On: each returns a General MIDI synthesizer to power-on state. */
static inline int profile_sysex_is_reset(const uint8_t *p, uint32_t n) {
    static const uint8_t gm[] = {0xf0,0x7e,0x7f,0x09,0x01,0xf7}, gm2[] = {0xf0,0x7e,0x7f,0x09,0x03,0xf7};
    static const uint8_t gs[] = {0xf0,0x41,0x10,0x42,0x12,0x40,0x00,0x7f,0x00,0x41,0xf7}, xg[] = {0xf0,0x43,0x10,0x4c,0x00,0x00,0x7e,0x00,0xf7};
    if (n == sizeof gm && (!memcmp(p, gm, n) || !memcmp(p, gm2, n))) return 1;
    if (n == sizeof gs && p[1] == 0x41 && p[3] == 0x42 && !memcmp(p + 4, gs + 4, n - 4)) return 1; /* any device id */
    return n == sizeof xg && p[1] == 0x43 && (p[2] & 0xf0) == 0x10 && !memcmp(p + 3, xg + 3, n - 3);
}
/* DSPK v1: 4-byte magic, u32 LE version, u32 LE model, u32 LE record count,
 * followed by (u32 role, u32 byte count, payload). No duplicate/empty roles or trailing bytes.
 * 1=boot/control ROM, 2=program/PCM ROM, 3=descrambled wave ROM, 16..23=raw wave chips.
 * 32=bank, 33=optional driver data (reserved). No embedded paths or compression. */
typedef struct { const uint8_t *data; uint32_t size; } profile_record;
static inline uint32_t profile_le32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static inline int profile_parse(const uint8_t *p, uint32_t n, uint32_t model, profile_record records[64]) {
    if (!p || n < 16 || n > PROFILE_MAX_ASSET || memcmp(p,"DSPK",4) || profile_le32(p+4)!=1 || profile_le32(p+8)!=model) return 0;
    uint32_t count=profile_le32(p+12), offset=16;
    if (!count || count>63) return 0;
    memset(records,0,64*sizeof(*records));
    for (uint32_t i=0;i<count;i++) {
        if (n-offset<8) return 0;
        uint32_t role=profile_le32(p+offset), size=profile_le32(p+offset+4); offset+=8;
        if (!role || role>=64 || !size || size>n-offset || records[role].data) return 0;
        records[role].data=p+offset; records[role].size=size; offset+=size;
    }
    return offset==n;
}
#endif
