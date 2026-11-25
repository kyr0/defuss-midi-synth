/* SPDX-License-Identifier: MIT
 * Register mixer extracted/adapted from QEMU GUSEMU32 hw/audio/gusemu_mixer.c
 * Copyright (C) 2000-2007 Tibor "TS" Schütz.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * Changes: explicit per-voice register state, bounded RAM reads, persistent
 * ramp state, wide stereo accumulator (no signed overflow).
 * Original QEMU pin: 6bf90d4fc5027567cb704d7888f5ec792b4ed75a.
 */
#ifndef DEFUSS_GF1_MIXER_H
#define DEFUSS_GF1_MIXER_H
#include "vintage_math.h"
#define GF1_RAM_SIZE (1024u*1024u)
#define GF1_STOP 0x100u
#define GF1_STOP_REQUEST 0x200u
#define GF1_16BIT 0x400u
#define GF1_LOOP 0x800u
#define GF1_BIDIR 0x1000u
#define GF1_REVERSE 0x4000u
/* Registers correspond to wVSR* in QEMU gustate.h. */
typedef struct {uint16_t control,freq,pan,ramp_control;uint32_t start,end,pos,vol32;uint16_t ramp_start,ramp_end,ramp_rate;} gf1_voice;
static inline int32_t gf1_read(const uint8_t *ram,uint32_t pos,int wide){
    uint32_t a=pos>>9;
    if(wide){a=(a&0xc0000u)+((a&0x1ffffu)<<1);if(a+1>=GF1_RAM_SIZE)return 0;return rds16(ram+a);}
    return s8(ram[a&0xfffffu])*256;
}
static inline void gf1_mix_voice(gf1_voice *v,const uint8_t *ram,unsigned rate,unsigned count,int32_t *l,int32_t *r){
    if(v->control&GF1_STOP_REQUEST)v->control|=GF1_STOP;
    if(v->ramp_control&GF1_STOP_REQUEST)v->ramp_control|=GF1_STOP;
    if(v->control&GF1_STOP)return;
    // GUSEMU32 frequency scaling, 6.10 frequency -> 23.9 address.
    int32_t increment=(int32_t)(((uint64_t)v->freq*44100/rate*7)/count);
    if(v->control&GF1_REVERSE)increment=-increment;
    unsigned frac=v->pos&511u,pan=(v->pan>>8)&15;
    uint32_t next=v->pos+512u;
    if(next>=v->end){next=(v->control&GF1_LOOP)?((v->control&GF1_BIDIR)?v->pos:v->start):v->pos;}
    int32_t a=gf1_read(ram,v->pos,v->control&GF1_16BIT),b=gf1_read(ram,next,v->control&GF1_16BIT);
    // GUSEMU32 semi-log GF1 volume. vol32 is 32x the register (12-bit value <<4).
    unsigned exp=v->vol32>>17; if(exp>15)exp=15;
    uint32_t volume=(((v->vol32>>9)&255u)+256u)<<exp; volume/=512;
    int32_t sm=(int32_t)((((int64_t)a*volume>>16)*(512-frac))/512+(((int64_t)b*volume>>16)*frac)/512);
    *r+=(sm*(int)pan)>>4;*l+=(sm*(15-(int)pan))>>4;
    if(!(v->ramp_control&GF1_STOP)){
        unsigned inc=(32u*16u*((v->ramp_rate>>8)&63u))>>(((v->ramp_rate>>14)&3u)*3);
        inc=(unsigned)(((uint64_t)inc*44100/2/rate*14)/count);
        if(!inc && (v->ramp_rate&0x3f00)) inc=1;
        int64_t vol=(int64_t)v->vol32+((v->ramp_control&GF1_REVERSE)?-(int64_t)inc:(int64_t)inc);
        uint32_t lo=(uint32_t)(v->ramp_start&0xff00)*32,hi=(uint32_t)(v->ramp_end&0xff00)*32;
        if((v->ramp_control&GF1_REVERSE)?vol<=lo:vol>=hi){v->ramp_control|=GF1_STOP;vol=(v->ramp_control&GF1_REVERSE)?lo:hi;}
        v->vol32=(uint32_t)(vol<0?0:vol>2097120?2097120:vol);
    }
    int64_t p=(int64_t)v->pos+increment;
    if((increment<0)?p<=(int64_t)v->start:p>=(int64_t)v->end){
        if(v->control&GF1_LOOP){if(v->control&GF1_BIDIR){v->control^=GF1_REVERSE;p=increment<0?v->start:v->end-1;}else p=increment<0?v->end-1:v->start;}
        else {v->control|=GF1_STOP;p=v->pos;}
    }
    v->pos=(uint32_t)p;
}
#endif
