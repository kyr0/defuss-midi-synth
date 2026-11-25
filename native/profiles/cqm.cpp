/* SPDX-License-Identifier: GPL-3.0-or-later
 * Build with cqm_adlmidi.cpp instead of the Yamaha adapter. */
#include "profile_pack.h"
#include "../fm.cpp"
static uint8_t *asset;
static uint32_t asset_size;
extern "C" {
PROFILE_EXPORT uint32_t profile_abi() { return 1; }
PROFILE_EXPORT uint32_t profile_model() { return 2; }
PROFILE_EXPORT void profile_close() { if(player) adl_close(player); player=nullptr; free(asset); asset=nullptr; asset_size=0; free(fm_bank_data); fm_bank_data=nullptr; }
PROFILE_EXPORT void *profile_buffer(uint32_t n) { if(player||!n||n>PROFILE_MAX_ASSET) return nullptr; free(asset); asset=(uint8_t*)malloc(n); asset_size=asset?n:0; return asset; }
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    if(player||n!=asset_size) return 0;
    profile_record r[64]={};
    if(n) {
        if(!profile_parse(asset,n,2,r)||!r[32].size) return 0;
        for(unsigned i=1;i<64;i++) if(i!=32&&r[i].size) return 0;
    }
    if(!fm_init(49716,1,0)) return 0;
    if(n&&!fm_load_bank(r[32].data,r[32].size)) {profile_close(); return 0;}
    return 1;
}
PROFILE_EXPORT uint32_t profile_rate() { return 49716; }
PROFILE_EXPORT uint32_t profile_message(uint32_t s,uint32_t a,uint32_t b) { if(!player||(s!=255&&(s<128||s>239||a>127||b>127))) return 0; fm_message(s,a,b); return 1; }
PROFILE_EXPORT float *profile_render(uint32_t n) { return player&&n<=PROFILE_BLOCK?fm_render(n):nullptr; }
PROFILE_EXPORT int32_t profile_voices() { return fm_voices(); }
}
