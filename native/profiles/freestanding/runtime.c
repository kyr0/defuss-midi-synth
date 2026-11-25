/* Minimal freestanding runtime for the ECW and GF1 modules only. Both modules
 * allocate exactly one persistent asset buffer. Each instance has isolated
 * linear memory. No imported environment, WASI, or runtime glue. */
#include <stdint.h>
#include <stddef.h>
extern unsigned char __heap_base;
static size_t allocated;
void *malloc(size_t size){
    uintptr_t base=((uintptr_t)&__heap_base+15u)&~(uintptr_t)15u;
    if(!size||allocated||size>128u*1024u*1024u)return NULL;
    size_t end=base+size, pages=(end+65535u)/65536u,current=__builtin_wasm_memory_size(0);
    if(pages>current&&__builtin_wasm_memory_grow(0,pages-current)==(size_t)-1)return NULL;
    allocated=size;return (void *)base;
}
void free(void *ptr){if(ptr)allocated=0;}
void *memcpy(void *dst,const void *src,size_t n){unsigned char *d=dst;const unsigned char *s=src;for(size_t i=0;i<n;i++)d[i]=s[i];return dst;}
void *memset(void *dst,int c,size_t n){unsigned char *d=dst;for(size_t i=0;i<n;i++)d[i]=(unsigned char)c;return dst;}
int memcmp(const void *a,const void *b,size_t n){const unsigned char *x=a,*y=b;for(size_t i=0;i<n;i++)if(x[i]!=y[i])return (int)x[i]-y[i];return 0;}
