/* SPDX-License-Identifier: MIT
 * Native ABI v1 bridge to SoundCarcass at the pinned source revision. */
#include "profile_pack.h"
#include "scemu/scemu.h"
#if MODEL_ID != 7 && MODEL_ID != 8
#error Select SC-55 (7) or SC-55mkII (8)
#endif
static scemu_t *machine;
static uint8_t *asset;
static uint32_t asset_size;
static float pcm[PROFILE_BLOCK*2];
static int32_t raw[PROFILE_BLOCK*2];
PROFILE_EXPORT uint32_t profile_abi(void) { return 1; }
PROFILE_EXPORT uint32_t profile_model(void) { return MODEL_ID; }
PROFILE_EXPORT void profile_close(void) {
    if (machine) scemu_destroy(machine);
    machine=NULL; free(asset); asset=NULL; asset_size=0;
}
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (machine || !n || n>PROFILE_MAX_ASSET) return NULL;
    free(asset); asset=malloc(n); asset_size=asset?n:0; return asset;
}
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    profile_record r[64];
    if (machine || n!=asset_size || !profile_parse(asset,n,MODEL_ID,r) || !r[1].size || !r[2].size) return 0;
    scemu_roms_t roms={0}; scemu_config_t config={0};
    roms.boot_rom=r[1].data; roms.boot_rom_size=r[1].size;
    roms.program_rom=r[2].data; roms.program_rom_size=r[2].size;
    for (unsigned i=0;i<64;i++) if (r[i].size && i!=1 && i!=2 && i!=3 && (i<16 || i>23)) return 0;
    if (r[3].size) {
        for (int i=16;i<24;i++) if (r[i].size) return 0;
        roms.wave_rom=r[3].data; roms.wave_rom_size=r[3].size;
    } else {
        for (int i=0;i<8;i++) {
            if (!r[16+i].size) {
                for (int j=i+1;j<8;j++) if (r[16+j].size) return 0;
                break;
            }
            roms.wave_chip[i]=r[16+i].data; roms.wave_chip_size[i]=r[16+i].size; roms.wave_chip_count++;
        }
        if (!roms.wave_chip_count) return 0;
    }
    config.sh2_interpreter=true; /* no executable-memory allocator */
    machine=scemu_create(MODEL_ID==7?"sc55":"sc55mk2", &roms, &config);
    if (!machine) return 0;
    scemu_boot(machine);
    if (!scemu_idle(machine) || scemu_output_count(machine)!=1) { profile_close(); return 0; }
    return 1;
}
PROFILE_EXPORT uint32_t profile_rate(void) { return machine?scemu_sample_rate(machine):0; }
PROFILE_EXPORT int32_t profile_voices(void) { return -1; } /* chip library does not expose active voice count */
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!machine) return 0;
    if (s==0xff) {
        /* Existing scheduler collapses GM/GS/XG reset to FF. Normalize to GM System On. */
        const uint8_t reset[]={0xf0,0x7e,0x7f,0x09,0x01,0xf7};
        return scemu_midi_write(machine,0,reset,sizeof(reset),0)?1:0;
    }
    if (s<0x80 || s>0xef || a>127 || b>127) return 0;
    const uint8_t msg[]={ (uint8_t)s,(uint8_t)a,(uint8_t)b };
    const uint32_t kind=s&0xf0;
    return scemu_midi_write(machine,0,msg,kind==0xc0||kind==0xd0?2:3,0)?1:0;
}
PROFILE_EXPORT float *profile_render(uint32_t frames) {
    if (!machine || frames>PROFILE_BLOCK) return NULL;
    if (frames) {
        int32_t *outputs[SCEMU_MAX_OUTPUTS]={raw};
        scemu_render(machine,outputs,frames);
        for (uint32_t i=0;i<frames;i++) { pcm[i]=raw[2*i]*(1.0f/8388608.0f); pcm[frames+i]=raw[2*i+1]*(1.0f/8388608.0f); }
    }
    return pcm;
}
