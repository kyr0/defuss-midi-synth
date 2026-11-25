/* SPDX-License-Identifier: MIT
 * Native ECW synthesizer for the sb-pci128 profile: parses an original ECLW waveset and plays its 16-bit samples.
 * Layout follows Engelmann's ECW specification 1.5 (2009-01-29); field decoding is cross-checked against ecw2sfz r3
 * MIDI/ECW.pm. scripts/profile-ecw-test.mjs checks the decisions below against EAPCI2M/4M/8M.ECW.
 * Taken from the wavesets' own data, where the spec and ecw2sfz disagree with it:
 *   - sample header bytes 2..3 are one signed little-endian tuning word in 1/256 semitone (fine = low byte);
 *   - with it, key + word/256 + layer coarse + layer fine/256 + PITCH_OFFSET semitones is the playback ratio at
 *     22,050 Hz that puts the melodic programs on MIDI note frequencies (A4 = 440 Hz), within 3 cents per bank;
 *   - the instrument sub-header delay (bytes 6..7) is a big-endian word in milliseconds.
 * Not public, so reconstructed and not driver parity: the 22,050 Hz output rate, envelope time curve, gain, velocity
 * and pan curves, vibrato and pitch-envelope depth, voice stealing, the key of fixed-pitch and quarter-tone patches
 * (60). 64 voices: the Windows driver's EAPCI95.INF names it "SB AudioPCI 64V Internal Synth". Ignored because their
 * meaning is unknown: the loop shift of sample flags >= 129, the wavetable envelope, patch byte 13 ("changes tuning
 * slightly"; as 1/256 semitone it detunes the banks' programs). */
#include "profile_pack.h"
#include "vintage_math.h"
#define RATE 22050u
#define TICK 256u
#define VOICES 64u
#define INVALID 0xffffu
#define ECW_HEADER 0x78cu
#define PITCH_OFFSET 5.19f
static uint8_t *asset;static uint32_t asset_size;static int ready;
typedef struct{const uint8_t *p;uint32_t n,stride;} table;
static table bank,drum,programs,drums,instruments,patches,a1,a3,samples;
static const uint8_t *waves;static uint32_t wave_n;
typedef struct{uint8_t program,bank,volume,expression,pan,mod,sustain,rpn_msb,rpn_lsb,bend_semi,bend_cent;uint16_t bend;} channel;
static channel channels[16];
typedef struct{float level,from,target;uint32_t left,total;uint8_t stage;const uint8_t *p;} envelope;
typedef struct{
    uint8_t active,ch,note,velocity,group,held,released,loop;uint32_t age,delay,elapsed,tick;
    const uint8_t *patch,*sample;uint64_t pos,step,start,end,loop_start;float base_semi,amp,pan,lfo_phase;
    envelope vol,pitch;float gl,gr;
} voice;
static voice voices[VOICES];static uint32_t sequence;static float pcm[PROFILE_BLOCK*2];
static const uint8_t *entry(table t,uint32_t i){return i<t.n?t.p+i*t.stride:NULL;}
static int parse_table(table *t,const uint8_t *p,uint32_t n,uint32_t h,uint32_t stride){
    uint32_t off=profile_le32(p+h),size=profile_le32(p+h+4),count=profile_le32(p+h+8);
    if(!count||off<ECW_HEADER||off>n||size>n-off||(uint64_t)count*stride!=size)return 0;
    *t=(table){p+off,count,stride};return 1;
}
static int parse_ecw(const uint8_t *p,uint32_t n){
    if(n<ECW_HEADER||memcmp(p,"ECLW",4))return 0;
    if(!parse_table(&bank,p,n,0x704,256)||bank.n!=1||!parse_table(&drum,p,n,0x710,256)||drum.n!=1||
       !parse_table(&programs,p,n,0x71c,256)||!parse_table(&drums,p,n,0x728,256)||
       !parse_table(&instruments,p,n,0x734,23)||!parse_table(&patches,p,n,0x740,76)||
       !parse_table(&a1,p,n,0x750,2)||!parse_table(&a3,p,n,0x768,2)||!parse_table(&samples,p,n,0x774,16))return 0;
    uint32_t off=profile_le32(p+0x784);wave_n=profile_le32(p+0x788);
    if(off<ECW_HEADER||off>n||wave_n>n-off||wave_n<2)return 0;
    waves=p+off;return 1;
}
static void defaults(channel *c){*c=(channel){.volume=100,.expression=127,.pan=64,.rpn_msb=127,.rpn_lsb=127,.bend=8192,.bend_semi=2};}
static void reset(void){memset(voices,0,sizeof(voices));for(unsigned c=0;c<16;c++)defaults(&channels[c]);sequence=0;}
/* Spec: type 255 routes by "note <= split" through up to 7 regions; type 2 holds two sub-headers. Bounded: rejects
 * out-of-range indices, chains longer than 16 hops and unknown types. */
static const uint8_t *resolve(uint32_t idx,unsigned note){
    for(unsigned depth=0;depth<16;depth++){
        const uint8_t *r=entry(instruments,idx);if(!r)return NULL;if(r[0]==2&&r[1]<4)return r;if(r[0]!=255)return NULL;
        unsigned i=0;for(;i<7;i++){const uint8_t *s=r+2+3*i;if(note<=s[2]){idx=rd16(s);break;}}if(i==7)return NULL;
    }return NULL;
}
/* Melodic: bank map -> MIDI patch map -> instrument. Channel 10: program = drum kit -> drum note map -> instrument. */
static unsigned mapped(channel *c,unsigned ch,unsigned key){
    int percussion=ch==9;table maps=percussion?drums:programs;const uint8_t *m=(percussion?drum:bank).p;
    const uint8_t *p=entry(maps,rd16(m+2*(percussion?c->program:c->bank)));if(!p)return INVALID;
    return rd16(p+2*(percussion?key:c->program));
}
static uint32_t env_ticks(uint8_t v){ /* reconstruction: log time curve on the 86.13 Hz control clock */
    return v==0?1u:1u+(uint32_t)vintage_exp2((float)(v&127)/12.f);
}
static void env_segment(envelope *e,float target,uint32_t ticks){e->from=e->level;e->target=target;e->left=e->total=ticks?ticks:1;}
static float env_level(uint8_t v){return (v&127)/127.f;}
/* Spec envelope bytes: 0 release destination, 1 delay, 2 initial level, 3/4 attack time/level, 5/6 decay,
 * 7/8 sustain time/level, 9 release time. Stages: 4 delay, 0 attack, 1 decay, 2 sustain, 3 release. */
static void env_begin(envelope *e,const uint8_t *p){e->p=p;e->stage=0;e->level=env_level(p[2]);if(p[1]){e->stage=4;env_segment(e,e->level,env_ticks(p[1]));}else env_segment(e,env_level(p[4]),env_ticks(p[3]));}
static void env_release(envelope *e){e->stage=3;env_segment(e,env_level(e->p[0]),env_ticks(e->p[9]));}
static void env_update(envelope *e){if(!e->left)return;e->left--;e->level=e->target+(e->from-e->target)*(float)e->left/e->total;if(e->left)return;
    if(e->stage==4){e->stage=0;env_segment(e,env_level(e->p[4]),env_ticks(e->p[3]));}
    else if(e->stage==0){e->stage=1;env_segment(e,env_level(e->p[6]),env_ticks(e->p[5]));}
    else if(e->stage==1){e->stage=2;env_segment(e,env_level(e->p[8]),env_ticks(e->p[7]));}
}
/* An amplitude envelope that ended at level 0 (sustain or release) stays silent: its voice is freed. */
static int env_silent(const envelope *e){return (e->stage==2||e->stage==3)&&!e->left&&e->level<=0;}
static voice *allocate(void){voice *best=&voices[0];for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(!v->active)return v;if(v->released>best->released||(v->released==best->released&&(uint32_t)(sequence-v->age)>(uint32_t)(sequence-best->age)))best=v;}return best;}
static void refresh(voice *v){
    const channel *c=&channels[v->ch];float bend=((int)c->bend-8192)/8192.f*(c->bend_semi+c->bend_cent/100.f);
    float vib=(v->patch[72]+c->mod*v->patch[1]/127.f)/127.f;float ramp=v->patch[74]?clampf(v->elapsed/(float)(TICK*env_ticks(v->patch[74])),0,1):1;
    float tri=4.f*(v->lfo_phase<0.5f?v->lfo_phase:1.f-v->lfo_phase)-1.f;
    float semi=v->base_semi+bend+s8(v->patch[0])*v->pitch.level/8.f+vib*ramp*tri;
    v->step=(uint64_t)(vintage_exp2(clampf(semi/12.f,-8,8))*65536.f);if(!v->step)v->step=1;
    /* Reconstruction: five pan positions and linear velocity/volume/expression gain, not original coefficients. */
    float pan=clampf(v->pan+(c->pan-64)/64.f, -1,1);int pos=(int)((pan+1)*2+0.5f);pan=pos/4.f;
    float gain=v->amp*v->vol.level*v->velocity/127.f*c->volume/127.f*c->expression/127.f*0.25f;
    v->gl=gain*(1-pan);v->gr=gain*pan;
}
/* Patch scale (spec byte 2): 0 chromatic, 1 ignores the key, 2 quarter tones. The fixed key 60 is a reconstruction. */
static float key_term(const uint8_t *p,unsigned key){return p[2]==1?60.f:p[2]==2?60.f+((int)key-60)*0.5f:(float)key;}
static void start_layer(unsigned ch,unsigned key,unsigned vel,const uint8_t *layer){
    const uint8_t *p=entry(patches,rd16(layer));if(!p)return;
    const uint8_t *idx=entry(a1,rd16(p+11));if(!idx)return;idx=entry(a3,rd16(idx));if(!idx)return;
    /* Spec: the next sample header is used while the note is above byte 0; patch byte 16 shifts the split points. */
    unsigned k=rd16(idx);const uint8_t *s=NULL;int lookup=(int)key+s8(p[16]);if(lookup<0)lookup=0;if(lookup>127)lookup=127;
    for(unsigned i=0;i<128;i++,k++){s=entry(samples,k);if(!s||lookup<=s[0])break;s=NULL;}if(!s)return;
    uint32_t st=profile_le32(s+4),ls=profile_le32(s+8),end=profile_le32(s+12); /* 1/16 sample units (spec: bits) */
    if((st&15)||end<=st||(uint64_t)end>(uint64_t)(wave_n/2)*16)return;
    int loop=s[1]>=2&&ls>=st&&ls<end&&(end-ls)>=16; /* spec: flag >= 2 loops; ecw2sfz's "> 2" drops flag 2 */
    uint8_t group=layer[9];if(group)for(unsigned i=0;i<VOICES;i++)if(voices[i].active&&voices[i].ch==ch&&voices[i].group==group)voices[i].active=0;
    voice *v=allocate();
    *v=(voice){.active=1,.ch=ch,.note=key,.velocity=vel,.group=group,.held=1,.loop=loop,.age=++sequence,
        .delay=(uint32_t)((unsigned)layer[6]<<8|layer[7])*RATE/1000,.patch=p,.sample=s,
        .start=(uint64_t)st<<12,.pos=(uint64_t)st<<12,.end=(uint64_t)end<<12,.loop_start=(uint64_t)ls<<12};
    /* Spec: flag 0 means no tuning adjustments when the sample plays in a drum kit. */
    if(ch==9&&!s[1])v->base_semi=0;
    else v->base_semi=key_term(p,key)+rds16(s+2)/256.f+s8(layer[4])+s8(layer[5])/256.f+PITCH_OFFSET;
    v->pan=clampf(s8(layer[3])/64.f,-1,1);v->amp=vintage_exp2(s8(layer[2])/32.f);
    env_begin(&v->vol,p+57);env_begin(&v->pitch,p+27);refresh(v);
}
static void note_on(unsigned ch,unsigned k,unsigned vel){const uint8_t *r=resolve(mapped(&channels[ch],ch,k),k);if(!r)return;switch(r[1]){case 0:start_layer(ch,k,vel,r+3);break;case 1:start_layer(ch,k,vel,r+3);start_layer(ch,k,vel,r+13);break;case 2:start_layer(ch,k,vel,r+(k<=r[2]?3:13));break;case 3:start_layer(ch,k,vel,r+13);break;}}
/* Spec: envelope byte 13 set to 1 means that envelope never enters its release phase (amplitude 70, pitch 40). */
static void release(voice *v){if(v->released)return;v->released=1;if(v->patch[70]!=1){env_release(&v->vol);v->vol.target=0;}if(v->patch[40]!=1)env_release(&v->pitch);}
static void note_off(unsigned ch,unsigned k){for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(v->active&&v->ch==ch&&v->note==k&&v->held){v->held=0;if(!channels[ch].sustain)release(v);}}}
static void cc(unsigned ch,unsigned a,unsigned b){channel *c=&channels[ch];switch(a){case 0:c->bank=b;break;case 1:c->mod=b;break;case 7:c->volume=b;break;case 10:c->pan=b;break;case 11:c->expression=b;break;case 64:c->sustain=b>=64;break;case 100:c->rpn_lsb=b;break;case 101:c->rpn_msb=b;break;case 6:if(!c->rpn_lsb&&!c->rpn_msb)c->bend_semi=b>24?24:b;break;case 38:if(!c->rpn_lsb&&!c->rpn_msb)c->bend_cent=b>99?99:b;break;case 121:{unsigned program=c->program,bank_id=c->bank,volume=c->volume;defaults(c);c->program=program;c->bank=bank_id;c->volume=volume;break;}default:break;}
    for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(!v->active||v->ch!=ch)continue;if(a==120)v->active=0;else{if(a==123)v->held=0;if(!v->held&&!c->sustain)release(v);refresh(v);}}
}
PROFILE_EXPORT uint32_t profile_abi(void){return PROFILE_ABI;} PROFILE_EXPORT uint32_t profile_model(void){return 5;}
PROFILE_EXPORT void profile_close(void){ready=0;reset();free(asset);asset=NULL;asset_size=0;waves=NULL;wave_n=0;}
PROFILE_EXPORT void *profile_buffer(uint32_t n){if(ready||!n||n>PROFILE_MAX_ASSET)return NULL;free(asset);asset=malloc(n);asset_size=asset?n:0;return asset;}
PROFILE_EXPORT uint32_t profile_init(uint32_t n){profile_record r[64];if(ready||n!=asset_size||!profile_parse(asset,n,5,r)||!r[32].size)return 0;for(unsigned i=0;i<64;i++)if(i!=32&&r[i].size)return 0;if(!parse_ecw(r[32].data,r[32].size))return 0;reset();ready=1;return 1;}
PROFILE_EXPORT uint32_t profile_rate(void){return ready?RATE:0;}
PROFILE_EXPORT int32_t profile_voices(void){int n=0;for(unsigned i=0;i<VOICES;i++)n+=voices[i].active!=0;return n;}
static uint8_t sysex[PROFILE_SYSEX_MAX];
PROFILE_EXPORT uint8_t *profile_sysex_buffer(void){return sysex;}
/* The GM, GM2, GS and XG resets restore the power-on state; no other SysEx changes this synthesizer. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n){if(!ready||!profile_sysex_valid(sysex,n))return 0;if(profile_sysex_is_reset(sysex,n))reset();return 1;}
PROFILE_EXPORT uint32_t profile_message(uint32_t s,uint32_t a,uint32_t b){if(!ready)return 0;if(s==255){reset();return 1;}if(s<128||s>239||a>127||b>127)return 0;unsigned ch=s&15;switch(s&240){case 0x80:note_off(ch,a);break;case 0x90:if(b)note_on(ch,a,b);else note_off(ch,a);break;case 0xb0:cc(ch,a,b);break;case 0xc0:channels[ch].program=a;break;case 0xe0:channels[ch].bend=a|(b<<7);for(unsigned i=0;i<VOICES;i++)if(voices[i].active&&voices[i].ch==ch)refresh(&voices[i]);break;default:break;}return 1;}
static float sample_at(uint64_t p){uint64_t i=p>>16;if(i>=wave_n/2)return 0;return rds16(waves+2*i)/32768.f;}
/* A voice reads only sample indices i with start <= 16*i < end; a looping voice wraps at end to the loop start. */
PROFILE_EXPORT float *profile_render(uint32_t n){if(!ready||n>PROFILE_BLOCK)return NULL;for(unsigned j=0;j<n;j++){float l=0,r=0;for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(!v->active)continue;if(v->delay){v->delay--;continue;}if(++v->tick>=TICK){v->tick=0;env_update(&v->vol);env_update(&v->pitch);if(env_silent(&v->vol)){v->active=0;continue;}v->lfo_phase+=(v->patch[73]/127.f*10.f+0.2f)*TICK/RATE;if(v->lfo_phase>=1)v->lfo_phase-=1;refresh(v);}v->elapsed++;
        uint64_t next=(v->pos&~65535ull)+65536;if(next>=v->end)next=v->loop?v->loop_start:v->pos;
        float a=sample_at(v->pos),b=sample_at(next),s=a+(b-a)*(float)(v->pos&65535)/65536.f;l+=s*v->gl;r+=s*v->gr;
        v->pos+=v->step;if(v->pos>=v->end){if(v->loop)v->pos=v->loop_start+(v->pos-v->end)%(v->end-v->loop_start);else v->active=0;}
    }pcm[j]=clampf(l,-1,1);pcm[n+j]=clampf(r,-1,1);}return pcm;}
