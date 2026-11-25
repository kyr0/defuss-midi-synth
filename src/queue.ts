import { integer, isSysEx, OP, OP_COUNT, OPERAND_MAX, type PackedEvent } from './types.ts';

/** The most SysEx bytes the queue holds at once. */
export const MAX_QUEUED_SYSEX_BYTES = 16 * 1024 * 1024;

/**
 * Bounded stable min-heap. Typed storage avoids object churn in the audio callback.
 * Timestamp ties use insertion order, so patch changes precede notes when submitted that way.
 * A sysex event's message lives in one byte store (payload), its offset and length in the event's operands. Events
 * leave in frame order, not in the order they came, so a batch that finds no room at the store's end first moves the
 * live messages to its front, and grows the store (to at most MAX_QUEUED_SYSEX_BYTES) only when they do not leave
 * room. Both happen while a batch is added, never while events are taken, and a store that empties starts again at
 * its front, so steady scheduling reuses it without allocating. VERIFIED: tests/core.test.ts stores payloads out of
 * order, compacts, grows and reuses the one buffer, and rejects an overflowing batch whole.
 */
export class EventQueue {
  private readonly frames: Float64Array;
  private readonly order: Float64Array;
  private readonly ops: Int32Array;
  private serial = 0;
  size = 0;
  /** The bytes of the queued SysEx messages; sysex events index it (offset, length) until they are taken. */
  payload = new Uint8Array(0);
  private payloadEnd = 0;
  private payloadLive = 0;
  constructor(readonly capacity = 8192) {
    integer(capacity, 1, 1048576, 'queue capacity');
    this.frames = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.ops = new Int32Array(capacity * 4);
  }
  get nextFrame(): number { return this.size ? this.frames[0] : Infinity; }
  /** The SysEx bytes that queued events hold. */
  get sysexBytes(): number { return this.payloadLive; }
  clear(): void { this.size = 0; this.serial = 0; this.payloadEnd = 0; this.payloadLive = 0; }
  /** Preflight the entire batch so rejection never leaves half a score scheduled. A sysex event ([frame, OP.sysex,
   *  index, 0, 0]) takes its message, F0 through F7, from payloads[index]. */
  pushBatch(events: readonly PackedEvent[], payloads: readonly Uint8Array[] = []): void {
    if (events.length > this.capacity - this.size) throw new RangeError('Event queue full');
    if (this.serial + events.length > Number.MAX_SAFE_INTEGER) throw new RangeError('Event sequence exhausted');
    if (!Array.isArray(payloads)) throw new TypeError('Invalid SysEx payloads');
    let bytes = 0;
    for (const event of events) {
      if (!Array.isArray(event) || event.length !== 5) throw new TypeError('Invalid packed event');
      integer(event[0], 0, Number.MAX_SAFE_INTEGER, 'frame');
      integer(event[1], 0, OP_COUNT - 1, 'operation');
      if (event[1] === OP.sysex) {
        const data = payloads[integer(event[2], 0, payloads.length - 1, 'SysEx payload index')];
        if (!(data instanceof Uint8Array) || !isSysEx(data)) throw new RangeError('Invalid SysEx payload');
        integer(event[3], 0, 0, 'operand'); integer(event[4], 0, 0, 'operand');
        bytes += data.length;
      } else for (let j = 2; j < 5; j++) integer(event[j], 0, OPERAND_MAX, 'operand');
    }
    if (bytes > MAX_QUEUED_SYSEX_BYTES - this.payloadLive) throw new RangeError('SysEx queue full');
    if (bytes > this.payload.length - this.payloadEnd) this.reserve(bytes);
    for (const e of events) {
      let i = this.size++;
      this.frames[i] = e[0]; this.order[i] = this.serial++;
      if (e[1] === OP.sysex) {
        const data = payloads[e[2]]!;
        this.payload.set(data, this.payloadEnd);
        this.ops[i * 4] = OP.sysex; this.ops[i * 4 + 1] = this.payloadEnd; this.ops[i * 4 + 2] = data.length; this.ops[i * 4 + 3] = 0;
        this.payloadEnd += data.length; this.payloadLive += data.length;
      } else for (let j = 0; j < 4; j++) this.ops[i * 4 + j] = e[j + 1];
      while (i > 0) {
        const p = (i - 1) >>> 1;
        if (!this.before(i, p)) break;
        this.swap(i, p); i = p;
      }
    }
  }
  /** Moves the live SysEx messages to the front of a store with room for bytes more after them: the current store when
   *  it is large enough, else one twice as large or as large as needed. */
  private reserve(bytes: number): void {
    const need = this.payloadLive + bytes;
    const target = need <= this.payload.length ? this.payload : new Uint8Array(Math.min(MAX_QUEUED_SYSEX_BYTES, Math.max(need, this.payload.length * 2, 65536)));
    const held: number[] = [];
    for (let i = 0; i < this.size; i++) if (this.ops[i * 4] === OP.sysex) held.push(i);
    held.sort((a, b) => this.ops[a * 4 + 1]! - this.ops[b * 4 + 1]!);
    let at = 0;
    for (const i of held) {
      const from = this.ops[i * 4 + 1]!, length = this.ops[i * 4 + 2]!;
      // Ascending offsets move each message to or below its place, so copyWithin never overwrites one not yet moved.
      if (target === this.payload) target.copyWithin(at, from, from + length);
      else target.set(this.payload.subarray(from, from + length), at);
      this.ops[i * 4 + 1] = at; at += length;
    }
    this.payload = target; this.payloadEnd = at;
  }
  /** Write into caller-owned scratch, never allocate while popping. A sysex event's message stays in payload at the
   *  offset and length of target[1] and target[2] until the next pushBatch or clear. */
  pop(target: Int32Array): void {
    if (!this.size) throw new RangeError('Empty event queue');
    for (let j = 0; j < 4; j++) target[j] = this.ops[j];
    if (this.ops[0] === OP.sysex && (this.payloadLive -= this.ops[2]) === 0) this.payloadEnd = 0;
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
