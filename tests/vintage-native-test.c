/* Compile separately against pci128.c or gus.c; execute with a synthetic DSPK fixture. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <assert.h>
void *profile_buffer(uint32_t);uint32_t profile_init(uint32_t);void profile_close(void);uint32_t profile_message(uint32_t,uint32_t,uint32_t);float *profile_render(uint32_t);int32_t profile_voices(void);
static uint32_t rng=0x12eaa39;static uint32_t next(void){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;}
int main(int argc,char **argv){assert(argc==2);FILE *f=fopen(argv[1],"rb");assert(f);assert(fseek(f,0,SEEK_END)==0);long n=ftell(f);assert(n>0&&n<10000000);rewind(f);unsigned char *asset=malloc(n);assert(asset&&fread(asset,1,n,f)==(size_t)n);fclose(f);
 for(unsigned i=0;i<2000;i++){
  uint32_t len=(i%7==0&&i)?(next()%(uint32_t)n)+1:n;unsigned char *b=profile_buffer(len);assert(b);memcpy(b,asset,len);
  if(i)for(unsigned j=0;j<1+(i%8);j++)b[next()%len]^=(uint8_t)next();
  if(profile_init(len)==1){for(unsigned j=0;j<16;j++){uint32_t ch=next()%16;assert(profile_message(0x90|ch,next()%128,127)==1);float *out=profile_render(128);assert(out);for(unsigned k=0;k<256;k++)assert(isfinite(out[k])&&fabsf(out[k])<=1);assert(profile_message(0xb0|ch,120,0));}assert(profile_voices()>=0);}else assert(i>0);
  profile_close();
 }
 free(asset);puts("2000 fixture/mutation cases passed");return 0;
}
