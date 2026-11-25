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
