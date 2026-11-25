/* Compile separately against pci128.c or gus.c; execute with a DSPK pack (synthetic fixture or real asset).
 * Usage: vintage-native-test PACK [CASES=2000] [WINDOW=0] [MIDI=0]. The defaults reproduce the original 2000 cases.
 *   WINDOW > 0 puts 7 of 8 mutations into the first WINDOW bytes (where a waveset's tables are);
 *   MIDI = 1 adds program/bank changes, bends, sustain, longer renders and note-offs to each accepted case. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <assert.h>
void *profile_buffer(uint32_t);uint32_t profile_init(uint32_t);void profile_close(void);uint32_t profile_message(uint32_t,uint32_t,uint32_t);float *profile_render(uint32_t);int32_t profile_voices(void);
static uint32_t rng=0x12eaa39;static uint32_t next(void){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;}
static void block(void){float *out=profile_render(128);assert(out);for(unsigned k=0;k<256;k++)assert(isfinite(out[k])&&fabsf(out[k])<=1);}
int main(int argc,char **argv){assert(argc>=2&&argc<=5);FILE *f=fopen(argv[1],"rb");assert(f);assert(fseek(f,0,SEEK_END)==0);long n=ftell(f);assert(n>0&&n<130000000);rewind(f);unsigned char *asset=malloc(n);assert(asset&&fread(asset,1,n,f)==(size_t)n);fclose(f);
 unsigned cases=argc>2?(unsigned)strtoul(argv[2],NULL,10):2000,window=argc>3?(unsigned)strtoul(argv[3],NULL,10):0,midi=argc>4&&atoi(argv[4]),accepted=0;
 for(unsigned i=0;i<cases;i++){
  uint32_t len=(i%7==0&&i)?(next()%(uint32_t)n)+1:n;unsigned char *b=profile_buffer(len);assert(b);memcpy(b,asset,len);
  if(i)for(unsigned j=0;j<1+(i%8);j++){uint32_t span=window&&window<len&&next()%8?window:len;b[next()%span]^=(uint8_t)next();}
  if(profile_init(len)==1){accepted++;for(unsigned j=0;j<16;j++){uint32_t ch=next()%16;
     if(midi){assert(profile_message(0xb0|ch,0,next()%128));assert(profile_message(0xc0|ch,next()%128,0));assert(profile_message(0xe0|ch,next()%128,next()%128));assert(profile_message(0xb0|ch,64,next()%128));}
     assert(profile_message(0x90|ch,next()%128,127)==1);block();
     if(midi){for(unsigned k=next()%64;k;k--)block();assert(profile_message(0x80|ch,next()%128,0));}
     assert(profile_message(0xb0|ch,120,0));}assert(profile_voices()>=0);}else assert(i>0);
  profile_close();
 }
 free(asset);printf("%u fixture/mutation cases passed (%u accepted by profile_init)\n",cases,accepted);return 0;
}
