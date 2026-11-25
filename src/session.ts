import { type Engine } from './engine.ts';
import { EventQueue } from './queue.ts';
import { integer, OP, type PackedEvent, type RenderStats } from './types.ts';

/** TinySoundFont updates envelopes, filters and LFOs once per block of up to 64 frames from the start of each render
 *  call (TSF_RENDER_EFFECTSAMPLEBLOCK). Splitting every render at multiples of 64 output frames keeps the PCM the
 *  same for any caller block size that is a multiple of 64, the AudioWorklet's 128 included. VERIFIED:
 *  tests/profiles.test.ts schedules SysEx and notes at odd frames and gets the same PCM at every block size. */
export const RENDER_GRID = 64;

/** Same timestamp scheduler drives AudioWorklet and deterministic offline tests. */
export class RenderSession {
  readonly queue: EventQueue;
  private readonly scratch = new Int32Array(4);
  frame = 0;
  lateEvents = 0;
  constructor(readonly engine: Engine, capacity = 8192) { this.queue = new EventQueue(capacity); }
  /** Adds a batch atomically; sysex events take their messages from payloads (packEvent). */
  schedule(events: readonly PackedEvent[], payloads?: readonly Uint8Array[]): void { this.queue.pushBatch(events, payloads); }
  clear(): void { this.queue.clear(); }
  stats(): RenderStats { return { frame: this.frame, queuedEvents: this.queue.size, lateEvents: this.lateEvents }; }
  process(left: Float32Array, right: Float32Array, startFrame = this.frame): void {
    integer(startFrame, this.frame, Number.MAX_SAFE_INTEGER - left.length, 'start frame');
    if (left.length !== right.length) throw new RangeError('Stereo buffers must have equal length');
    this.frame = startFrame;
    let offset = 0;
    while (offset < left.length) {
      while (this.queue.nextFrame <= this.frame) {
        if (this.queue.nextFrame < this.frame) this.lateEvents++;
        this.queue.pop(this.scratch);
        if (this.scratch[0] === OP.sysex) this.engine.sysex(this.queue.payload, this.scratch[1]!, this.scratch[2]!);
        else this.engine.dispatch(this.scratch[0]!, this.scratch[1]!, this.scratch[2]!, this.scratch[3]!);
      }
      const frames = Math.min(left.length - offset, this.engine.maxFrames, this.queue.nextFrame - this.frame, RENDER_GRID - this.frame % RENDER_GRID);
      this.engine.render(left, right, offset, frames);
      offset += frames; this.frame += frames;
    }
  }
}
