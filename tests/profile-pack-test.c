/* SPDX-License-Identifier: MIT */
#include <assert.h>
#include "../native/profiles/profile_pack.h"
static void put(uint8_t *p,uint32_t n){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(n>>(8*i));}
int main(void){
    uint8_t b[128]={0}; profile_record r[64];
    memcpy(b,"DSPK",4);put(b+4,1);put(b+8,9);put(b+12,2);
    put(b+16,1);put(b+20,1);b[24]=42;put(b+25,2);put(b+29,1);b[33]=17;
    assert(profile_parse(b,34,9,r));assert(r[1].size==1&&r[1].data[0]==42&&r[2].data[0]==17);
    for(unsigned n=0;n<34;n++)assert(!profile_parse(b,n,9,r));
    assert(!profile_parse(b,35,9,r)); assert(!profile_parse(b,34,7,r));
    put(b+25,1);assert(!profile_parse(b,34,9,r));put(b+25,2);
    put(b+29,0xffffffff);assert(!profile_parse(b,34,9,r));put(b+29,1);
    put(b+25,64);assert(!profile_parse(b,34,9,r));put(b+25,2);
    put(b+29,0);assert(!profile_parse(b,34,9,r));
    /* deterministic malformed-buffer stress test under ASan/UBSan */
    uint32_t x=1;
    for(unsigned k=0;k<50000;k++){
        for(unsigned i=16;i<sizeof(b);i++){x^=x<<13;x^=x>>17;x^=x<<5;b[i]=(uint8_t)x;}
        (void)profile_parse(b,16+x%113,9,r);
    }
    return 0;
}
