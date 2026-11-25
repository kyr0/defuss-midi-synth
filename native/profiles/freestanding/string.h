#ifndef DEFUSS_WASM_STRING_H
#define DEFUSS_WASM_STRING_H
#include <stddef.h>
void *memset(void *,int,size_t);
void *memcpy(void *,const void *,size_t);
int memcmp(const void *,const void *,size_t);
#endif
