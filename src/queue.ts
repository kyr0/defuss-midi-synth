import { integer, OP_COUNT, OPERAND_MAX, type PackedEvent } from './types.ts';

/**
 * Bounded stable min-heap. Typed storage avoids object churn in the audio callback.
 * Timestamp ties use insertion order, so patch changes precede notes when submitted that way.
 */
export class EventQueue {
  private readonly frames: Float64Array;
  private readonly order: Float64Array;
  private readonly ops: Int32Array;
  private serial = 0;
  size = 0;
  constructor(readonly capacity = 8192) {
    integer(capacity, 1, 1048576, 'queue capacity');
    this.frames = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.ops = new Int32Array(capacity * 4);
  }
  get nextFrame(): number { return this.size ? this.frames[0] : Infinity; }
  clear(): void { this.size = 0; this.serial = 0; }
  /** Preflight the entire batch so rejection never leaves half a score scheduled. */
  pushBatch(events: readonly PackedEvent[]): void {
    if (events.length > this.capacity - this.size) throw new RangeError('Event queue full');
    if (this.serial + events.length > Number.MAX_SAFE_INTEGER) throw new RangeError('Event sequence exhausted');
    for (const event of events) {
      if (!Array.isArray(event) || event.length !== 5) throw new TypeError('Invalid packed event');
      integer(event[0], 0, Number.MAX_SAFE_INTEGER, 'frame');
      integer(event[1], 0, OP_COUNT - 1, 'operation');
      for (let j = 2; j < 5; j++) integer(event[j], 0, OPERAND_MAX, 'operand');
    }
    for (const e of events) {
      let i = this.size++;
      this.frames[i] = e[0]; this.order[i] = this.serial++;
      for (let j = 0; j < 4; j++) this.ops[i * 4 + j] = e[j + 1];
      while (i > 0) {
        const p = (i - 1) >>> 1;
        if (!this.before(i, p)) break;
        this.swap(i, p); i = p;
      }
    }
  }
  /** Write into caller-owned scratch, never allocate while popping. */
  pop(target: Int32Array): void {
    if (!this.size) throw new RangeError('Empty event queue');
    for (let j = 0; j < 4; j++) target[j] = this.ops[j];
    this.size--;
    if (!this.size) return;
    this.frames[0] = this.frames[this.size]; this.order[0] = this.order[this.size];
    for (let j = 0; j < 4; j++) this.ops[j] = this.ops[this.size * 4 + j];
    let i = 0;
    while (i * 2 + 1 < this.size) {
      let c = i * 2 + 1;
      if (c + 1 < this.size && this.before(c + 1, c)) c++;
      if (!this.before(c, i)) break;
      this.swap(c, i); i = c;
    }
  }
  private before(a: number, b: number): boolean {
    return this.frames[a] < this.frames[b] || (this.frames[a] === this.frames[b] && this.order[a] < this.order[b]);
  }
  private swap(a: number, b: number): void {
    let t = this.frames[a]; this.frames[a] = this.frames[b]; this.frames[b] = t;
    t = this.order[a]; this.order[a] = this.order[b]; this.order[b] = t;
    for (let j = 0; j < 4; j++) { t = this.ops[a * 4 + j]; this.ops[a * 4 + j] = this.ops[b * 4 + j]; this.ops[b * 4 + j] = t; }
  }
}
