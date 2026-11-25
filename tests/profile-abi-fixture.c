/* SPDX-License-Identifier: MIT
 * Test double ONLY. Never a product synth or distributable hardware implementation.
 * clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all -Wl,--export-memory ...
 */
typedef unsigned int u32;
static unsigned char asset[32];static float pcm[256];static u32 on,closed,initialized;
u32 profile_abi(void){return 1;}u32 profile_model(void){return 9;}
void* profile_buffer(u32 bytes){return bytes<=32?asset:0;}
u32 profile_init(u32 bytes){initialized=bytes==1&&asset[0]==42;return initialized;}
u32 profile_rate(void){return 32000;}int profile_voices(void){return on?1:0;}
u32 profile_message(u32 s,u32 a,u32 b){(void)a;if(!initialized||closed)return 0;if((s&240)==144)on=b;else if((s&240)==128||s==255)on=0;return 1;}
float* profile_render(u32 n){if(closed||!initialized||n>128)return 0;for(u32 i=0;i<n;i++){pcm[i]=on?0.25f:0;pcm[n+i]=on?-0.5f:0;}return pcm;}
void profile_close(void){closed=1;}
