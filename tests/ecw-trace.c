/* Native harness around the real native/profiles/pci128.c, driven by scripts/profile-ecw-test.mjs.
 * It includes the core's source to see its parsed tables and voices; only waveform reads are wrapped to record
 * their indices. Modes (all take a DSPK pack of one original ECW waveset):
 *   map    PACK          core's table view, bank/drum maps, and the voices every reachable note starts
 *   bounds PACK          plays each reachable sample header solo, also with +24 semitones of bend; checks reads
 *   render PACK EVENTS   renders "frame status a b" events (frame order) and writes float32 planar PCM to stdout */
#include <stdio.h>
#include "../native/profiles/vintage_math.h"
static const uint8_t *trace_wave;static uint32_t trace_lo,trace_hi;static unsigned long long trace_reads,trace_bad;static int trace_on;
static inline int16_t traced_rds16(const uint8_t *p){
    if(trace_on&&trace_wave&&p>=trace_wave){uint32_t i=(uint32_t)((p-trace_wave)/2);trace_reads++;if(i<trace_lo||i>=trace_hi)trace_bad++;}
    return rds16(p);
}
#define rds16 traced_rds16
#include "../native/profiles/pci128.c"
#undef rds16
static uint8_t *load(const char *path,uint32_t *n){
    FILE *f=fopen(path,"rb");if(!f){perror(path);exit(2);}fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);
    uint8_t *b=profile_buffer((uint32_t)size);if(!b||fread(b,1,(size_t)size,f)!=(size_t)size){fprintf(stderr,"read failed\n");exit(2);}fclose(f);
    if(!profile_init((uint32_t)size)){fprintf(stderr,"profile_init rejected %s\n",path);exit(3);}*n=(uint32_t)size;return b;
}
static long idx(table t,const uint8_t *p){return p?(long)((p-t.p)/t.stride):-1;}
/* One representative bank (or drum kit) per patch map (drum note map); -1 when no MIDI bank reaches the map. */
static int representative(const uint8_t *map,unsigned m){for(unsigned b=0;b<128;b++)if(rd16(map+2*b)==m)return (int)b;return -1;}
static void print_voices(void){
    for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(!v->active)continue;const uint8_t *s=v->sample;
        printf(" [%ld,%ld,%u,%u,%d,%u,%u,%u,%u,%.4f,%.6f,%.6f,%u,%u]",idx(patches,v->patch),idx(samples,s),s[0],s[1],rds16(s+2),
            profile_le32(s+4),profile_le32(s+8),profile_le32(s+12),v->loop,v->base_semi,v->pan,v->amp,v->delay,v->group);}
}
static void map_mode(void){
    printf("{\"tables\":{\"bank\":[%ld,%u],\"drum\":[%ld,%u],\"programs\":[%ld,%u],\"drums\":[%ld,%u],\"instruments\":[%ld,%u],\"patches\":[%ld,%u],\"a1\":[%ld,%u],\"a3\":[%ld,%u],\"samples\":[%ld,%u],\"wave\":[%ld,%u]}",
        (long)(bank.p-asset-24),bank.n,(long)(drum.p-asset-24),drum.n,(long)(programs.p-asset-24),programs.n,(long)(drums.p-asset-24),drums.n,
        (long)(instruments.p-asset-24),instruments.n,(long)(patches.p-asset-24),patches.n,(long)(a1.p-asset-24),a1.n,(long)(a3.p-asset-24),a3.n,
        (long)(samples.p-asset-24),samples.n,(long)(waves-asset-24),wave_n);
    printf(",\"bank_map\":[");for(unsigned b=0;b<128;b++)printf("%s%u",b?",":"",rd16(bank.p+2*b));
    printf("],\"drum_kit_map\":[");for(unsigned b=0;b<128;b++)printf("%s%u",b?",":"",rd16(drum.p+2*b));printf("]}\n");
    for(int percussion=0;percussion<2;percussion++){
        unsigned maps=percussion?drums.n:programs.n,ch=percussion?9:0;
        for(unsigned m=0;m<maps;m++){int b=representative(percussion?drum.p:bank.p,m);if(b<0){printf("%c %u unreachable\n",percussion?'D':'M',m);continue;}
            for(unsigned p=0;p<(percussion?1u:128u);p++)for(unsigned k=0;k<128;k++){
                profile_message(0xff,0,0);
                if(percussion)profile_message(0xc0|ch,(unsigned)b,0);else{profile_message(0xb0|ch,0,(unsigned)b);profile_message(0xc0|ch,p,0);}
                profile_message(0x90|ch,k,100);printf("%c %u %u %u %u",percussion?'D':'M',m,(unsigned)b,p,k);print_voices();printf("\n");
            }
        }
    }
}
/* Solo voice: keep only the voice playing sample header s; returns it or NULL. */
static voice *solo(const uint8_t *s){voice *keep=NULL;for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];if(v->active&&v->sample==s&&!keep){keep=v;v->delay=0;}else v->active=0;}return keep;}
static void trigger(int percussion,unsigned b,unsigned p,unsigned k,unsigned bend){unsigned ch=percussion?9:0;profile_message(0xff,0,0);
    if(percussion)profile_message(0xc0|ch,b,0);else{profile_message(0xb0|ch,0,b);profile_message(0xc0|ch,p,0);}
    if(bend){profile_message(0xb0|ch,101,0);profile_message(0xb0|ch,100,0);profile_message(0xb0|ch,6,24);profile_message(0xe0|ch,127,127);}
    profile_message(0x90|ch,k,127);}
/* Every sample header a note reaches is played solo once at its first note, unbent and bent +24 semitones, until it
 * ends or has looped twice (amplitude envelope held at full level); each waveform read must fall inside that header's [start, end). */
static void bounds_mode(void){
    static unsigned char seen[65536];unsigned long long frames=0,voices_checked=0,loops_wrapped=0,loops=0,headers=0;trace_wave=waves;
    for(int percussion=0;percussion<2;percussion++){unsigned maps=percussion?drums.n:programs.n;
        for(unsigned m=0;m<maps;m++){int b=representative(percussion?drum.p:bank.p,m);if(b<0)continue;
            for(unsigned p=0;p<(percussion?1u:128u);p++)for(unsigned k=0;k<128;k++)for(unsigned bend=0;bend<2;bend++){
                const uint8_t *todo[VOICES];unsigned nt=0;trigger(percussion,(unsigned)b,p,k,bend);
                for(unsigned i=0;i<VOICES;i++){voice *v=&voices[i];long si=idx(samples,v->sample);if(!v->active||si<0||si>65535||(seen[si]&(1u<<bend)))continue;
                    if(!seen[si])headers++;seen[si]|=(unsigned char)(1u<<bend);todo[nt++]=v->sample;}
                for(unsigned t=0;t<nt;t++){trigger(percussion,(unsigned)b,p,k,bend);voice *w=solo(todo[t]);if(!w){fprintf(stderr,"voice vanished\n");exit(1);}
                    w->vol=(envelope){.level=1,.from=1,.target=1,.left=1u<<30,.total=1u<<30,.stage=2,.p=w->vol.p}; /* hold full level: run to the end */
                    const uint8_t *s=todo[t];uint32_t st=profile_le32(s+4),end=profile_le32(s+12);
                    trace_lo=st/16;trace_hi=(end+15)/16;trace_on=1;voices_checked++;loops+=w->loop;
                    uint64_t span=(w->end-w->start)/(w->step?w->step:1)+4096,limit=w->loop?2*span:span+4096,wrapped=0;
                    if(limit>8000000)limit=8000000;
                    for(uint64_t f=0;f<limit&&w->active;f++){uint64_t before=w->pos;profile_render(1);frames++;
                        if(w->active&&(w->pos<w->start||w->pos>=w->end)){fprintf(stderr,"position outside sample %ld\n",idx(samples,s));exit(1);}
                        if(w->active&&w->pos<before)wrapped=1;}
                    if(w->active&&w->loop&&!wrapped){ /* very low pitch: jump close to the loop end, then cross it */
                        w->pos=w->end-w->start>8*w->step?w->end-8*w->step:w->start;
                        for(unsigned f=0;f<4096&&!wrapped;f++){uint64_t before=w->pos;profile_render(1);frames++;if(w->pos<w->start||w->pos>=w->end){fprintf(stderr,"position outside sample\n");exit(1);}wrapped=w->pos<before;}}
                    loops_wrapped+=wrapped;trace_on=0;
                }
            }
        }
    }
    printf("{\"sample_headers\":%llu,\"of\":%u,\"voices\":%llu,\"looped\":%llu,\"loops_wrapped\":%llu,\"frames\":%llu,\"reads\":%llu,\"out_of_sample_reads\":%llu}\n",headers,samples.n,voices_checked,loops,loops_wrapped,frames,trace_reads,trace_bad);
    if(trace_bad)exit(1);
}
/* Events apply before the frame they name; output is the planar block of each render call, in call order. */
static void render_mode(const char *path){
    FILE *f=fopen(path,"r");if(!f){perror(path);exit(2);}
    static unsigned long frame[1<<20];static unsigned ev[1<<20][3];unsigned count=0;
    while(count<(1u<<20)&&fscanf(f,"%lu %u %u %u",&frame[count],&ev[count][0],&ev[count][1],&ev[count][2])==4)count++;fclose(f);
    unsigned long total=0,end=(count?frame[count-1]:0)+PROFILE_BLOCK*64;unsigned next=0;
    while(total<end){while(next<count&&frame[next]<=total){profile_message(ev[next][0],ev[next][1],ev[next][2]);next++;}
        unsigned long n=PROFILE_BLOCK;if(next<count&&frame[next]-total<n)n=frame[next]-total;
        float *pcm=profile_render((uint32_t)n);fwrite(pcm,sizeof(float),2*n,stdout);total+=n;}
}
int main(int argc,char **argv){
    if(argc<3){fprintf(stderr,"usage: %s map|bounds|render PACK [EVENTS]\n",argv[0]);return 2;}uint32_t n;load(argv[2],&n);
    if(!strcmp(argv[1],"map"))map_mode();else if(!strcmp(argv[1],"bounds"))bounds_mode();else if(!strcmp(argv[1],"render")&&argc==4)render_mode(argv[3]);else return 2;
    profile_close();return 0;
}
