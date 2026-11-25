/* SPDX-License-Identifier: MIT
 * GF1 MIDI driver with original GF1PATCH110 sample files and a GUSEMU32-based
 * register mixer. Not UltraMID instruction emulation: allocation, mapping,
 * envelopes and controller translation are our driver, with GF1 RAM constraints. */
#include "profile_pack.h"
#include "gf1_mixer.h"
#define GUS_VOICES 32u
#define MAX_PATCH_SAMPLES 4096u
#define GUS_PACK_HEADER 12u
#define CACHE_SLOTS 256u
static uint8_t *asset;static uint32_t asset_size,rate,voice_count,ready,serial;
static uint8_t ram[GF1_RAM_SIZE];static float pcm[PROFILE_BLOCK*2];
typedef struct {const uint8_t *header,*data;uint32_t len,ls,le,low,high,root;uint16_t rate;uint8_t mode;} sample;
typedef struct {uint16_t first,count;} patch;
static sample samples[MAX_PATCH_SAMPLES];static patch patches[256];static unsigned sample_count;
typedef struct {uint32_t address,size,age;const sample *s;uint8_t refs;} cached;
static cached cache[CACHE_SLOTS];
typedef struct{uint8_t program,volume,expression,pan,sustain,rpn_msb,rpn_lsb,bend_range;uint16_t bend;} channel;
static channel channels[16];
typedef struct {gf1_voice chip;const sample *s;uint32_t age;uint8_t active,ch,key,vel,held,releasing,stage,slot;uint32_t last_level;} voice;
static voice voices[GUS_VOICES];
static int parse_pat(const uint8_t *p,uint32_t n,unsigned index){
    if(n<129||memcmp(p,"GF1PATCH110",11)||!p[82])return 0;
    uint32_t off=129;unsigned first=sample_count;
    for(unsigned i=0;i<p[82];i++){
        if(n-off<63)return 0;unsigned layers=p[off+22];off+=63;if(!layers)return 0;
        for(unsigned j=0;j<layers;j++){
            if(n-off<47)return 0;unsigned count=p[off+6];off+=47;if(!count)return 0;
            for(unsigned k=0;k<count;k++){
                if(n-off<96||sample_count>=MAX_PATCH_SAMPLES)return 0;
                const uint8_t *h=p+off;off+=96;uint32_t len=profile_le32(h+8),ls=profile_le32(h+12),le=profile_le32(h+16);
                unsigned wide=h[55]&1;
                if(len<(wide?4u:2u)||len>n-off||len>262140u||(wide&&((len|ls|le)&1))||!rd16(h+20)||!profile_le32(h+30))return 0;
                if((h[55]&4)&&(ls>=le||le>len||le-ls<(wide?4u:2u)))return 0;
                samples[sample_count++]=(sample){h,p+off,len,ls,le,profile_le32(h+22),profile_le32(h+26),profile_le32(h+30),rd16(h+20),h[55]};off+=len;
            }
        }
    }
    patches[index]=(patch){first,sample_count-first};return sample_count>first;
}
static int parse_bank(const uint8_t *p,uint32_t n){
    if(n<GUS_PACK_HEADER||memcmp(p,"GPAT",4)||profile_le32(p+4)!=1)return 0;
    unsigned count=profile_le32(p+8),off=12;if(!count||count>256)return 0;
    sample_count=0;memset(patches,0,sizeof(patches));
    for(unsigned i=0;i<count;i++){
        if(n-off<8)return 0;unsigned index=profile_le32(p+off),size=profile_le32(p+off+4);off+=8;
        if(index>=256||patches[index].count||!size||size>n-off||!parse_pat(p+off,size,index))return 0;off+=size;
    }return off==n;
}
static void kill(voice *v){if(v->active){if(cache[v->slot].refs)cache[v->slot].refs--;v->active=0;v->chip.control=GF1_STOP;}}
static void defaults(channel *c){*c=(channel){.volume=100,.expression=127,.pan=64,.rpn_lsb=127,.rpn_msb=127,.bend_range=2,.bend=8192};}
static void reset(void){for(unsigned i=0;i<GUS_VOICES;i++)kill(&voices[i]);memset(cache,0,sizeof(cache));memset(ram,0,sizeof(ram));for(unsigned i=0;i<16;i++)defaults(&channels[i]);serial=0;}
/* Fit each sample into one 256 KiB bank (GF1 16-bit address wiring). Reuse
 * resident samples; evict only unreferenced ones, never move sounding samples. */
static int fit(uint32_t size,uint32_t *out){for(unsigned b=0;b<4;b++){uint32_t p=b*262144u,lim=p+262144u;while(size<=lim-p){uint32_t end=p;for(unsigned i=0;i<CACHE_SLOTS;i++){cached *c=&cache[i];if(c->s&&p<c->address+c->size&&c->address<p+size&&c->address+c->size>end)end=c->address+c->size;}if(end==p){*out=p;return 1;}p=end;}}return 0;}
static int load_sample(const sample *s){
    for(unsigned i=0;i<CACHE_SLOTS;i++)if(cache[i].s==s){cache[i].refs++;cache[i].age=++serial;return (int)i;}
    uint32_t size=(s->len+7u)&~3u,address=0;int slot=-1;
    for(;;){slot=-1;int oldest=-1;for(unsigned i=0;i<CACHE_SLOTS;i++){if(!cache[i].s){slot=(int)i;break;}}
        if(slot>=0&&fit(size,&address))break;
        for(unsigned i=0;i<CACHE_SLOTS;i++)if(cache[i].s&&!cache[i].refs&&(oldest<0||(uint32_t)(serial-cache[i].age)>(uint32_t)(serial-cache[oldest].age)))oldest=(int)i;
        if(oldest<0)return -1;cache[oldest]=(cached){0};
    }
    memcpy(ram+address,s->data,s->len);if(s->mode&2){if(s->mode&1){for(unsigned i=1;i<s->len;i+=2)ram[address+i]^=128;}else for(unsigned i=0;i<s->len;i++)ram[address+i]^=128;}
    memset(ram+address+s->len,0,size-s->len);cache[slot]=(cached){address,size,++serial,s,1};return slot;
}
static uint32_t address_units(uint32_t a,int wide){return wide?(a&0xc0000u)|((a&0x3ffffu)>>1):a;}
static const sample *select_sample(unsigned index,unsigned key){patch p=patches[index];if(!p.count)return NULL;uint32_t hz=(uint32_t)(440000.f*vintage_exp2(((int)key-69)/12.f));const sample *best=NULL;uint32_t dist=UINT32_MAX;
    for(unsigned i=0;i<p.count;i++){const sample *s=&samples[p.first+i];uint32_t d=hz<s->low?s->low-hz:hz>s->high?hz-s->high:0;if(!best||d<dist){best=s;dist=d;}if(!d)break;}return best;}
static void refresh(voice *v){channel *c=&channels[v->ch];const sample *s=v->s;float bend=((int)c->bend-8192)/8192.f*c->bend_range;
    // Original drum samples use their own rate; melodic samples use root frequency.
    float ratio=v->ch==9?1.f:440000.f*vintage_exp2(((int)v->key-69+bend)/12.f)/s->root;
    float inc=s->rate*ratio*1024.f/rate;v->chip.freq=(uint16_t)clampf(inc,2,65535);
    int pan=(int)s->header[36]+(int)c->pan*15/127-7;v->chip.pan=(uint16_t)((pan<0?0:pan>15?15:pan)<<8);
}
/* GF1 volume register is exponent+mantissa. Convert linear MIDI gain to
 * nearest 12-bit register, using the same law as the mixer. */
static uint16_t volume_reg(float a){if(a<=0)return 0;float x=clampf(a,0,1)*32704.f*512.f;unsigned e=0;while(x>=512&&e<15){x*=0.5f;e++;}unsigned m=x>256?(unsigned)(x-256):0;if(m>255)m=255;return (uint16_t)((e*256+m)<<4);
}
static uint16_t target_volume(voice *v,unsigned offset){channel *c=&channels[v->ch];float g=(v->vel/127.f)*(c->volume/127.f)*(c->expression/127.f)*(offset/255.f)*0.5f;return volume_reg(g);}
static void envelope(voice *v,unsigned stage){v->stage=stage;const uint8_t *h=v->s->header;unsigned off=(v->s->mode&64)?h[43+stage]:(stage<3?255:0);uint32_t target=target_volume(v,off);if(stage>=5)target=0;
    uint16_t val=(uint16_t)(v->chip.vol32/32);unsigned quant=(target>>8)<<8;v->chip.ramp_start=(uint16_t)(quant<val?quant:val&0xff00);v->chip.ramp_end=(uint16_t)(quant>val?quant:val&0xff00);
    v->chip.ramp_rate=(uint16_t)(((v->s->mode&64)?h[37+stage]:63u)<<8);if(!(v->chip.ramp_rate&0x3f00))v->chip.ramp_rate|=0x100;
    v->chip.ramp_control=target<val?GF1_REVERSE:0;v->last_level=target;
    if((target>>8)==(val>>8)){v->chip.vol32=target*32;v->chip.ramp_control|=GF1_STOP;}
}
static void release(voice *v){if(v->releasing)return;v->releasing=1;envelope(v,3);}
static voice *allocate(void){voice *old=&voices[0];for(unsigned i=0;i<voice_count;i++){voice *v=&voices[i];if(!v->active)return v;if(v->releasing>old->releasing||(v->releasing==old->releasing&&(uint32_t)(serial-v->age)>(uint32_t)(serial-old->age)))old=v;}kill(old);return old;}
static void note_on(unsigned ch,unsigned key,unsigned vel){unsigned index=ch==9?128+key:channels[ch].program;const sample *s=select_sample(index,key);if(!s)return;
    if(ch==9&&(key==42||key==44||key==46))for(unsigned i=0;i<voice_count;i++)if(voices[i].active&&voices[i].ch==9&&(voices[i].key==42||voices[i].key==44||voices[i].key==46))kill(&voices[i]);
    voice *v=allocate();int slot=load_sample(s);if(slot<0)return;uint32_t a=cache[slot].address;int wide=s->mode&1;
    uint32_t start=address_units(a,wide)*512,end=address_units(a+s->len,wide)*512;
    // End address uses same bank encoding even at the bank boundary; padded allocation prevents crossing.
    *v=(voice){.s=s,.active=1,.ch=ch,.key=key,.vel=vel,.held=1,.slot=slot,.age=++serial};v->chip.control=wide?GF1_16BIT:0;
    v->chip.start=start;v->chip.pos=start;v->chip.end=end;if(s->mode&4){v->chip.control|=GF1_LOOP;if(s->mode&8)v->chip.control|=GF1_BIDIR;v->chip.start=address_units(a+s->ls,wide)*512;v->chip.end=address_units(a+s->le,wide)*512;}
    if(s->mode&16){v->chip.control|=GF1_REVERSE;v->chip.pos=v->chip.end-512;}
    refresh(v);envelope(v,0);
}
static void off(unsigned ch,unsigned key){for(unsigned i=0;i<voice_count;i++){voice *v=&voices[i];if(v->active&&v->ch==ch&&v->key==key){v->held=0;if(!channels[ch].sustain&&(ch!=9||(v->s->mode&4)))release(v);}}}
static void cc(unsigned ch,unsigned a,unsigned b){channel *c=&channels[ch];switch(a){case 7:c->volume=b;break;case 10:c->pan=b;break;case 11:c->expression=b;break;case 64:c->sustain=b>=64;break;case 100:c->rpn_lsb=b;break;case 101:c->rpn_msb=b;break;case 6:if(!c->rpn_lsb&&!c->rpn_msb)c->bend_range=b>24?24:b;break;case 121:{unsigned p=c->program,vol=c->volume;defaults(c);c->program=p;c->volume=vol;break;}default:break;}
    for(unsigned i=0;i<voice_count;i++){voice *v=&voices[i];if(!v->active||v->ch!=ch)continue;if(a==120){kill(v);continue;}if(a==123)v->held=0;if(!v->held&&!c->sustain)release(v);refresh(v);if(a==7||a==11)envelope(v,v->stage);}}
PROFILE_EXPORT uint32_t profile_abi(void){return 1;}PROFILE_EXPORT uint32_t profile_model(void){return 6;}
PROFILE_EXPORT void profile_close(void){reset();ready=0;free(asset);asset=NULL;asset_size=0;}
PROFILE_EXPORT void *profile_buffer(uint32_t n){if(ready||!n||n>PROFILE_MAX_ASSET)return NULL;free(asset);asset=malloc(n);asset_size=asset?n:0;return asset;}
PROFILE_EXPORT uint32_t profile_init(uint32_t n){profile_record r[64];if(ready||n!=asset_size||!profile_parse(asset,n,6,r)||!r[32].size)return 0;for(unsigned i=0;i<64;i++)if(r[i].size&&i!=32&&i!=33)return 0;voice_count=32;if(r[33].size){if(r[33].size!=1||r[33].data[0]<14||r[33].data[0]>32)return 0;voice_count=r[33].data[0];}rate=44100u*14u/voice_count;if(!parse_bank(r[32].data,r[32].size))return 0;reset();ready=1;return 1;}
PROFILE_EXPORT uint32_t profile_rate(void){return ready?rate:0;}
PROFILE_EXPORT int32_t profile_voices(void){int n=0;for(unsigned i=0;i<voice_count;i++)n+=voices[i].active!=0;return n;}
PROFILE_EXPORT uint32_t profile_message(uint32_t s,uint32_t a,uint32_t b){if(!ready)return 0;if(s==255){reset();return 1;}if(s<128||s>239||a>127||b>127)return 0;unsigned ch=s&15;switch(s&240){case 0x80:off(ch,a);break;case 0x90:if(b)note_on(ch,a,b);else off(ch,a);break;case 0xb0:cc(ch,a,b);break;case 0xc0:channels[ch].program=a;break;case 0xe0:channels[ch].bend=a|(b<<7);for(unsigned i=0;i<voice_count;i++)if(voices[i].active&&voices[i].ch==ch)refresh(&voices[i]);break;default:break;}return 1;}
PROFILE_EXPORT float *profile_render(uint32_t n){if(!ready||n>PROFILE_BLOCK)return NULL;for(unsigned j=0;j<n;j++){int32_t l=0,r=0;for(unsigned i=0;i<voice_count;i++){voice *v=&voices[i];if(!v->active)continue;gf1_mix_voice(&v->chip,ram,rate,voice_count,&l,&r);if(v->chip.control&GF1_STOP){kill(v);continue;}if(v->chip.ramp_control&GF1_STOP){if(v->stage==5){kill(v);continue;}if(v->stage!=2)envelope(v,v->stage+1);}}pcm[j]=clampf(l/32768.f,-1,1);pcm[n+j]=clampf(r/32768.f,-1,1);}return pcm;}
