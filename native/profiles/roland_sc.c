/* SPDX-License-Identifier: MIT
 * Native ABI 2 bridge to the Roland SC-55 (MODEL_ID 7) and SC-55mkII (MODEL_ID 8) boards of SoundCarcass (scemu,
 * superctr/sound-carcass, BSD-3-Clause), which run the original control program on an H8/532 interpreter and the GP
 * sound chip at its own clock.
 *
 * Why the boards and not scemu.c: scemu.c's model table links every board of the library, and the XV, SH-2 and DSP
 * cores need SLJIT code generators that have no wasm32 backend. The boards behind the table need none of that, so this
 * file takes scemu.c's place for one board: the ops table, scemu_boot's loop and scemu_render's per-frame output.
 *
 * DSPK roles (profile_pack.h) to scemu_roms_t, in the order the board takes them:
 *   1    -> boot_rom     the H8/532's 32 KiB internal mask ROM (SC-55 IC30, SC-55mkII IC21)
 *   2    -> program_rom  the control ROM (SC-55 1.21 IC23, 256 KiB; SC-55mkII 1.01 IC30, 512 KiB)
 *   16.. -> wave_chip    the wave ROMs as dumped, in board order (SC-55 GSS A IC28, B IC27, C IC26; mkII IC15, IC16)
 *   3    -> wave_rom     or instead the same set descrambled into one file (3 MiB)
 * Every image must have the size and CRC32 of the dump SoundCarcass's ROM finder (src/host/roms.c) names; the
 * library itself checks sizes only. No file, GUI, thread or SDL code is linked: the board runs on these records. */
#include "profile_pack.h"
#include "scemu/scemu_internal.h"
#if MODEL_ID == 7
#define BOARD_OPS sc55_board_ops
typedef sc55_t board_t;
#elif MODEL_ID == 8
#define BOARD_OPS sc55mk2_board_ops
typedef sc55mk2_t board_t;
#else
#error Select SC-55 (7) or SC-55mkII (8)
#endif

typedef struct { uint32_t role, size, crc; } image_t;
#if MODEL_ID == 7
static const image_t CPU = {1, 0x8000, 0x4ed0d171}, PROGRAM = {2, 0x40000, 0x2dc58549}, JOINED = {3, 0x300000, 0x067aa3e4};
static const image_t CHIPS[] = {{16, 0x100000, 0x1ac774d3}, {17, 0x100000, 0x8dcc592a}, {18, 0x100000, 0xe21ebc04}};
#else
static const image_t CPU = {1, 0x8000, 0x9b66631f}, PROGRAM = {2, 0x80000, 0xfcee1e8e}, JOINED = {3, 0x300000, 0x91b58f99};
static const image_t CHIPS[] = {{16, 0x200000, 0x1519d3b3}, {17, 0x100000, 0x0f826c7f}};
#endif
#define CHIP_COUNT (sizeof CHIPS / sizeof CHIPS[0])
/* scemu.c's BOOT_SECONDS: how long a boot may run before the firmware is taken not to settle */
#define BOOT_SECONDS 120u
#define VOICE_SLOTS 28 /* the GP's DPCM voices; slots 28..31 are its effect lines */

static board_t board;
static const scemu_board_ops_t *const ops = &BOARD_OPS;
static scemu_config_t config;
static int ready;
static uint8_t *asset;
static uint32_t asset_size;
static uint8_t sysex[PROFILE_SYSEX_MAX];
static float pcm[PROFILE_BLOCK * 2];
static uint32_t boot_frames;
static uint8_t running; /* the status byte MIDI IN last received, 0 after SysEx */
/* why the last profile_init failed (profile_init_error) */
enum { INIT_OK, INIT_PACK, INIT_ROLE, INIT_SIZE, INIT_HASH, INIT_BOARD, INIT_BOOT };
static uint32_t init_error;

/* core/jit.c's one function the Sound Canvas boards call. jit.c itself drives SLJIT and is not built; without
 * SCEMU_H8500_JIT the boards never attach a translator, so the record only holds the config. */
void jit_alloc_init(jit_alloc_t *a, const scemu_config_t *c) { a->config = c; }

static uint32_t crc32(const uint8_t *p, uint32_t n) {
    static uint32_t table[256];
    if (!table[1]) for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) c = c & 1 ? 0xedb88320u ^ (c >> 1) : c >> 1;
        table[i] = c;
    }
    uint32_t c = 0xffffffffu;
    while (n--) c = table[(c ^ *p++) & 0xff] ^ (c >> 8);
    return c ^ 0xffffffffu;
}

PROFILE_EXPORT uint32_t profile_abi(void) { return PROFILE_ABI; }
PROFILE_EXPORT uint32_t profile_model(void) { return MODEL_ID; }
PROFILE_EXPORT void profile_close(void) {
    if (ready) ops->release(&board);
    ready = 0; free(asset); asset = NULL; asset_size = 0;
}
PROFILE_EXPORT void *profile_buffer(uint32_t n) {
    if (ready || !n || n > PROFILE_MAX_ASSET) return NULL;
    free(asset); asset = malloc(n); asset_size = asset ? n : 0; return asset;
}
/* Validates the pack, makes the board, and runs the firmware from power-on until it has settled (the analog mute
 * released and the sound chip left alone, as scemu_boot waits for), so the first rendered frame already takes MIDI. */
PROFILE_EXPORT uint32_t profile_init(uint32_t n) {
    profile_record r[64];
    if (ready) return 0;
    init_error = INIT_PACK;
    if (!n || n != asset_size || !profile_parse(asset, n, MODEL_ID, r)) return 0;
    /* the roles first, then every size, then every CRC32: a failure names the first kind of fault */
    init_error = INIT_ROLE;
    int chips = 0;
    for (uint32_t i = 0; i < 64; i++) {
        if (!r[i].size) continue;
        if (i >= 16 && i < 16 + CHIP_COUNT) chips = 1;
        else if (i != 1 && i != 2 && i != 3) return 0;
    }
    if (chips && r[3].size) return 0;
    const image_t *want[2 + CHIP_COUNT] = {&CPU, &PROGRAM, &JOINED};
    const uint32_t count = r[3].size ? 3 : 2 + CHIP_COUNT;
    if (!r[3].size) for (uint32_t i = 0; i < CHIP_COUNT; i++) want[2 + i] = &CHIPS[i];
    init_error = INIT_SIZE;
    for (uint32_t i = 0; i < count; i++) if (r[want[i]->role].size != want[i]->size) return 0;
    init_error = INIT_HASH;
    for (uint32_t i = 0; i < count; i++) if (crc32(r[want[i]->role].data, want[i]->size) != want[i]->crc) return 0;
    scemu_roms_t roms = {0};
    roms.boot_rom = r[1].data; roms.boot_rom_size = r[1].size;
    roms.program_rom = r[2].data; roms.program_rom_size = r[2].size;
    if (r[3].size) { roms.wave_rom = r[3].data; roms.wave_rom_size = r[3].size; }
    else {
        for (uint32_t i = 0; i < CHIP_COUNT; i++) { roms.wave_chip[i] = r[16 + i].data; roms.wave_chip_size[i] = r[16 + i].size; }
        roms.wave_chip_count = (int)CHIP_COUNT;
    }
    config = (scemu_config_t){0};
    config.sh2_interpreter = true;
    init_error = INIT_BOARD;
    if (ops->validate_roms(&roms)) return 0;
    if (!ops->init(&board, &roms, &config)) { ops->release(&board); return 0; }
    init_error = INIT_BOOT;
    ops->reset(&board);
    const uint64_t limit = (uint64_t)BOOT_SECONDS * ops->sample_rate(&board);
    do ops->run_frame(&board); while (!ops->idle(&board) && ops->frame(&board) < limit);
    if (!ops->idle(&board) || ops->output_count(&board) != 1) { ops->release(&board); return 0; }
    boot_frames = (uint32_t)ops->frame(&board);
    /* the board keeps its own copies of every image (the ROM copies in init, wave_set_take's wave space) */
    free(asset); asset = NULL; asset_size = 0;
    ready = 1; running = 0; init_error = INIT_OK;
    return 1;
}
/* The DAC word rate the board runs at, two pairs per GP frame: SC-55 20 MHz / 625 * 2 = 64000 Hz, SC-55mkII
 * 24 MHz / 725 * 2 = 66206.9 Hz (the board's 66206). */
PROFILE_EXPORT uint32_t profile_rate(void) { return ready ? ops->sample_rate(&board) : 0; }
/* Diagnostics beside ABI 2: the frames the boot took, and why the last profile_init failed: 0 none, 1 not a DSPK pack
 * of this model, 2 a role this model has no image for, or a wave set both as chips and descrambled, 3 an image missing
 * or of the wrong size, 4 an image of the right size but another CRC32, 5 the board could not be made (memory), 6 the firmware
 * did not settle within BOOT_SECONDS. */
PROFILE_EXPORT uint32_t profile_boot_frames(void) { return ready ? boot_frames : 0; }
PROFILE_EXPORT uint32_t profile_init_error(void) { return init_error; }
/* The GP's keyed voice slots: the firmware keys a slot on for a note and off once it has finished with it. */
PROFILE_EXPORT int32_t profile_voices(void) {
    if (!ready) return -1;
    const int slots = (board.gp.slot_config & 31) + 1;
    const uint32_t used = board.gp.key_mask & (slots >= VOICE_SLOTS ? (1u << VOICE_SLOTS) - 1 : (1u << slots) - 1);
    return __builtin_popcount(used);
}
/* Bytes go to MIDI IN at the wire's 31250 baud, as a cable delivers them, starting with the next rendered frame; a
 * channel message repeating the last status is sent with running status, as MIDI senders do, which saves the wire a
 * third of a note stream. Each byte is stamped frame 0 (due at once, in order): the queue compares 32-bit frame stamps,
 * which a stamp taken from the running frame count would wrap after 2^32 frames (18.6 hours at 64 kHz). */
static uint32_t midi(const uint8_t *p, uint32_t n) {
    midi_queue_t *q = ops->midi(&board);
    if (n > midi_queue_room(q, 0)) return 0;
    for (uint32_t i = 0; i < n; i++) midi_queue_push(q, 0, p[i], 0);
    return 1;
}
PROFILE_EXPORT uint32_t profile_message(uint32_t s, uint32_t a, uint32_t b) {
    if (!ready) return 0;
    if (s == 0xff) { /* power-on state of the sound engine: GS Reset, which the firmware takes from MIDI IN */
        static const uint8_t gs[] = {0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7};
        if (!midi(gs, sizeof gs)) return 0;
        running = 0; return 1;
    }
    if (s < 0x80 || s > 0xef || a > 127 || b > 127) return 0;
    const uint8_t msg[] = {(uint8_t)s, (uint8_t)a, (uint8_t)b};
    const uint32_t kind = s & 0xf0, size = kind == 0xc0 || kind == 0xd0 ? 2 : 3, skip = s == running;
    if (!midi(msg + skip, size - skip)) return 0;
    running = (uint8_t)s; return 1;
}
PROFILE_EXPORT uint8_t *profile_sysex_buffer(void) { return sysex; }
/* Any well-formed message goes to the firmware as it is: GS and GM System On it applies, the rest (XG, GM2, other
 * makers' IDs) it ignores as the unit does. 0 for a malformed message or one the input queue cannot hold now. */
PROFILE_EXPORT uint32_t profile_sysex(uint32_t n) {
    if (!ready || !profile_sysex_valid(sysex, n) || !midi(sysex, n)) return 0;
    running = 0; return 1;
}
PROFILE_EXPORT float *profile_render(uint32_t frames) {
    if (!ready || frames > PROFILE_BLOCK) return NULL;
    for (uint32_t i = 0; i < frames; i++) {
        ops->run_frame(&board);
        /* the DAC's 24-bit word, full scale 1 << 23 */
        pcm[i] = (float)ops->output(&board, 0, 0) * (1.0f / 8388608.0f);
        pcm[frames + i] = (float)ops->output(&board, 0, 1) * (1.0f / 8388608.0f);
    }
    return pcm;
}
