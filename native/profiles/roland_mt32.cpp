/* SPDX-License-Identifier: MIT
 * Native ABI v1 bridge to Munt's C interface. */
#include "profile_pack.h"
#include "c_interface/c_interface.h"
static mt32emu_context machine;
static uint8_t *asset;
static uint32_t asset_size;
static float pcm[PROFILE_BLOCK*2], raw[PROFILE_BLOCK*2];
extern "C" {
PROFILE_EXPORT uint32_t profile_abi(void) { return 1; }
PROFILE_EXPORT uint32_t profile_model(void) { return 9; }
PROFILE_EXPORT void profile_close(void) {
    if (machine) { mt32emu_close_synth(machine); mt32emu_free_context(machine); }
    machine=nullptr; free(asset); asset=nullptr; asset_size=0;
}
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (machine || !n || n>PROFILE_MAX_ASSET) return nullptr;
    free(asset); asset=(uint8_t*)malloc(n); asset_size=asset?n:0; return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    profile_record r[64];
    if (machine || n!=asset_size || !profile_parse(asset,n,9,r) || !r[1].size || !r[2].size) return 0;
    for (unsigned i=3;i<64;i++) if (r[i].size) return 0;
    mt32emu_report_handler_i handler={};
    machine=mt32emu_create_context(handler,nullptr);
    if (!machine) return 0;
    if (mt32emu_add_rom_data(machine,r[1].data,r[1].size,nullptr)<0 ||
        mt32emu_add_rom_data(machine,r[2].data,r[2].size,nullptr)<0 ||
        mt32emu_open_synth(machine)!=MT32EMU_RC_OK) { profile_close(); return 0; }
    return 1;
}
PROFILE_EXPORT uint32_t profile_rate(void) { return machine?mt32emu_get_actual_stereo_output_samplerate(machine):0; }
PROFILE_EXPORT int32_t profile_voices(void) { return -1; }
PROFILE_EXPORT uint32_t profile_message(uint32_t s,uint32_t a,uint32_t b) {
    if (!machine) return 0;
    if (s==0xff) {
        const uint8_t reset[]={0xf0,0x41,0x10,0x16,0x12,0x7f,0x00,0x00,0x00,0x01,0xf7};
        mt32emu_play_sysex_now(machine,reset,sizeof(reset)); return 1;
    }
    if (s<0x80 || s>0xef || a>127 || b>127) return 0;
    mt32emu_play_msg_now(machine,s | a<<8 | b<<16); return 1;
}
PROFILE_EXPORT float *profile_render(uint32_t n) {
    if (!machine || n>PROFILE_BLOCK) return nullptr;
    if (n) mt32emu_render_float(machine,raw,n);
    for (uint32_t i=0;i<n;i++) { pcm[i]=raw[2*i]; pcm[n+i]=raw[2*i+1]; }
    return pcm;
}
}
