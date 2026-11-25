/* SPDX-License-Identifier: MIT
 * Adapter for AWE32Emu at its pinned revision. Upstream code is fetched locally,
 * not relicensed or redistributed. No host filesystem: patched loaders read
 * three named slices of the DSPK buffer. */
#include "profile_pack.h"
#include "Synth.h"
#include <algorithm>
#include <memory>
#include <string>
#include <vector>
#ifndef MODEL_ID
#error MODEL_ID required
#endif
static std::unique_ptr<Synth> synth;
static uint8_t *asset;
static uint32_t asset_size;
static profile_record records[64];
static int16_t raw[PROFILE_BLOCK*2];
static float pcm[PROFILE_BLOCK*2];
/* Patched upstream path loaders call this only with our fixed logical names. */
std::vector<uint8_t> defuss_awe_read(const std::string& name) {
    unsigned role=name=="rom"?3:name=="gm"?32:name=="user"?34:0;
    const auto &r=records[role];
    return r.size?std::vector<uint8_t>(r.data,r.data+r.size):std::vector<uint8_t>();
}
extern "C" size_t defuss_awe_rom_copy(void *dest,size_t limit) {
    const auto &r=records[3]; size_t n=std::min<size_t>(r.size,limit);
    if(n) memcpy(dest,r.data,n); return n;
}
extern "C" {
PROFILE_EXPORT uint32_t profile_abi(){return 1;}
PROFILE_EXPORT uint32_t profile_model(){return MODEL_ID;}
PROFILE_EXPORT void profile_close(){synth.reset(); memset(records,0,sizeof(records));free(asset);asset=nullptr;asset_size=0;}
PROFILE_EXPORT void *profile_buffer(uint32_t n){if(synth||!n||n>PROFILE_MAX_ASSET)return nullptr;free(asset);asset=(uint8_t*)malloc(n);asset_size=asset?n:0;return asset;}
PROFILE_EXPORT uint32_t profile_init(uint32_t n){
    if(synth||n!=asset_size||!profile_parse(asset,n,MODEL_ID,records))return 0;
    if((records[3].size!=1048576&&records[3].size!=1048574)||!records[32].size)return 0;
    for(unsigned i=0;i<64;i++)if(records[i].size&&i!=3&&i!=32&&i!=33&&i!=34)return 0;
    // config: driver 0=Win95,1=DOS,2=SDK; primary bank ROM-only flag; LE32 RAM KiB.
    unsigned driver=0,rombank=0,ram=MODEL_ID==3?512:4096;
    if(records[33].size){if(records[33].size!=6)return 0;const auto *c=records[33].data;driver=c[0];rombank=c[1];ram=profile_le32(c+2);}
    if(driver>2||rombank>1||ram<512||ram>28672||ram%512)return 0;
    std::string err;
    auto s=std::make_unique<Synth>(44100);
    if(!s->LoadWaveRom("rom",err))return 0;
    s->Core().SetChipRamKb(ram);
    if(!s->Core().UseBox86Chip("rom",err))return 0;
    s->Core().SetDriver(driver==1?Awe32::Driver::Dos:driver==2?Awe32::Driver::Sdk:Awe32::Driver::Win95);
    if(!s->LoadBank("gm",err,rombank!=0))return 0;
    if(records[34].size&&!s->LoadBank("user",err,false))return 0;
    if(!s->Core().ChipRam()||s->Core().DramSize()>s->Core().ChipRamWords())return 0;
    memcpy(s->Core().ChipRam(),s->Core().DramData(),s->Core().DramSize()*sizeof(int16_t));
    s->Core().PowerOnInit();synth=std::move(s);return 1;
}
PROFILE_EXPORT uint32_t profile_rate(){return synth?44100:0;}
PROFILE_EXPORT int32_t profile_voices(){if(!synth)return 0;int n=0;for(int i=0;i<32;i++)n+=synth->Core().IsVoiceActive(i);return n;}
PROFILE_EXPORT uint32_t profile_message(uint32_t s,uint32_t a,uint32_t b){
    if(!synth)return 0;
    if(s==255){for(uint8_t ch=0;ch<16;ch++){synth->ControlChange(ch,64,0);synth->ControlChange(ch,120,0);synth->ControlChange(ch,121,0);synth->ControlChange(ch,0,0);synth->ControlChange(ch,32,0);synth->ProgramChange(ch,0);synth->PitchBend(ch,0);}return 1;}
    if(s<128||s>239||a>127||b>127)return 0;uint8_t ch=s&15;
    switch(s&240){case 0x80:synth->NoteOff(ch,a);break;case 0x90:if(b)synth->NoteOn(ch,a,b);else synth->NoteOff(ch,a);break;case 0xb0:synth->ControlChange(ch,a,b);break;case 0xc0:synth->ProgramChange(ch,a);break;case 0xd0:synth->ChannelPressure(ch,a);break;case 0xe0:synth->PitchBend(ch,(int)(a|(b<<7))-8192);break;default:break;}return 1;
}
PROFILE_EXPORT float *profile_render(uint32_t n){if(!synth||n>PROFILE_BLOCK)return nullptr;if(n)synth->RenderBlock(raw,n);for(unsigned i=0;i<n;i++){pcm[i]=raw[2*i]/32768.f;pcm[n+i]=raw[2*i+1]/32768.f;}return pcm;}
}
