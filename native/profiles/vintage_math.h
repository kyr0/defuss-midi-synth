/* SPDX-License-Identifier: MIT */
#ifndef DEFUSS_VINTAGE_MATH_H
#define DEFUSS_VINTAGE_MATH_H
#include <stdint.h>
static inline float clampf(float x,float lo,float hi){return x<lo?lo:x>hi?hi:x;}
/* Bounded exp2 approximation (range-reduced degree 6 Taylor). Identical native/WASM. */
static inline float vintage_exp2(float x){
    x=clampf(x,-24,24);int n=(int)x;if(x<(float)n)n--;
    float f=x-n,z=f*0.69314718056f;
    float p=1+z*(1+z*(0.5f+z*(0.1666666667f+z*(0.0416666667f+z*(0.0083333333f+z*0.0013888889f)))));
    union {uint32_t u;float f;} v={(uint32_t)(n+127)<<23};return p*v.f;
}
static inline uint16_t rd16(const uint8_t *p){return (uint16_t)(p[0]|(uint16_t)p[1]<<8);}
static inline int16_t rds16(const uint8_t *p){uint16_t u=rd16(p);return (int16_t)(u<32768?u:(int)u-65536);}
static inline int s8(uint8_t x){return x<128?x:(int)x-256;}
#endif
