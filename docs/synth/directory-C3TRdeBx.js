const CODE_LIST = [
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "BUSY",
  "CLOSED",
  "READ_ONLY",
  "PERMISSION_DENIED",
  "QUOTA_EXCEEDED",
  "UNEXPECTED_EOF",
  "UNSUPPORTED",
  "ABORTED",
  "QUEUE_FULL",
  "IO_ERROR"
];
const CODES = new Set(CODE_LIST);
class StorageError extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}
function storageError(error, operation) {
  if (error instanceof StorageError) return error;
  const e = error;
  if (e?.name === "StorageError" && typeof e.code === "string" && CODES.has(e.code)) {
    return new StorageError(e.code, `defuss-storage: ${operation} failed (${e.code})`, { cause: error });
  }
  const tag = typeof e?.code === "string" ? e.code : e?.name;
  const code = tag === "ENOENT" || tag === "NotFoundError" ? "NOT_FOUND" : tag === "EEXIST" ? "ALREADY_EXISTS" : tag === "EACCES" || tag === "EPERM" || tag === "NotAllowedError" || tag === "SecurityError" ? "PERMISSION_DENIED" : tag === "ENOSPC" || tag === "EDQUOT" || tag === "QuotaExceededError" ? "QUOTA_EXCEEDED" : tag === "EBUSY" || tag === "NoModificationAllowedError" ? "BUSY" : (
    // VERIFIED: (foreign-dir case in Chromium, Firefox, WebKit) OPFS reports a
    // directory where a file was expected as TypeMismatchError; the native
    // adapter reports the same condition as UNSUPPORTED.
    tag === "TypeMismatchError" ? "UNSUPPORTED" : tag === "AbortError" ? "ABORTED" : "IO_ERROR"
  );
  return new StorageError(code, `defuss-storage: ${operation} failed (${code})`, { cause: error });
}
const DEFAULT_MAX_READ_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_PENDING_WRITE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_PENDING_OPERATIONS = 2048;
function integer(value, label, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new RangeError(`defuss-storage: ${label} must be a ${positive ? "positive" : "nonnegative"} safe integer`);
  }
  return value;
}
function range(offset, length) {
  integer(offset, "offset");
  integer(length, "length");
  integer(offset + length, "range end");
}
function bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError("defuss-storage: expected Uint8Array");
  if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
    throw new TypeError("defuss-storage: shared byte buffers are unsupported");
  }
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
function transferOption(data, options) {
  if (options.transfer === void 0) return false;
  if (typeof options.transfer !== "boolean") throw new TypeError("defuss-storage: transfer must be boolean");
  if (options.transfer && (data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength)) {
    throw new TypeError("defuss-storage: transfer requires a Uint8Array covering its whole ArrayBuffer");
  }
  return options.transfer;
}
function validateName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name) || name.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(name)) {
    throw new TypeError("defuss-storage: expected a portable lowercase flat name (1\u2013128 characters)");
  }
}
function openOptions(options) {
  for (const key of ["create", "exclusive", "readOnly", "shared"]) {
    if (options[key] !== void 0 && typeof options[key] !== "boolean") throw new TypeError(`defuss-storage: ${key} must be boolean`);
  }
  const readOnly = options.readOnly ?? false;
  const result = {
    create: options.create ?? false,
    exclusive: options.exclusive ?? false,
    readOnly,
    shared: options.shared ?? readOnly,
    writeBuffer: integer(options.writeBuffer ?? 0, "writeBuffer")
  };
  if (result.exclusive && !result.create) throw new TypeError("defuss-storage: exclusive requires create:true");
  if (result.readOnly && result.create) throw new TypeError("defuss-storage: readOnly cannot create files");
  if (result.readOnly && result.writeBuffer) throw new TypeError("defuss-storage: writeBuffer requires a writable handle");
  if (result.shared && result.writeBuffer) throw new TypeError("defuss-storage: writeBuffer requires an owning handle");
  return result;
}
function checkAbort(signal) {
  if (signal?.aborted) throw new StorageError("ABORTED", "defuss-storage: operation aborted", { cause: signal.reason });
}
function handleLimits(options) {
  const explicit = (value, label) => value === void 0 ? void 0 : integer(value, label, true);
  const write = explicit(options.maxWriteBytes, "maxWriteBytes");
  const pending = explicit(options.maxPendingWriteBytes, "maxPendingWriteBytes");
  const limits = {
    maxReadBytes: integer(options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, "maxReadBytes", true),
    maxWriteBytes: write ?? Math.min(DEFAULT_MAX_WRITE_BYTES, pending ?? DEFAULT_MAX_WRITE_BYTES),
    maxPendingWriteBytes: pending ?? Math.max(DEFAULT_MAX_PENDING_WRITE_BYTES, write ?? 0),
    maxPendingOperations: integer(options.maxPendingOperations ?? DEFAULT_MAX_PENDING_OPERATIONS, "maxPendingOperations", true)
  };
  if (limits.maxWriteBytes > limits.maxPendingWriteBytes) throw new RangeError("defuss-storage: maxWriteBytes exceeds maxPendingWriteBytes");
  return Object.freeze(limits);
}
const ADMISSION = /* @__PURE__ */ Symbol.for("defuss-storage.v0.admission");
const READ_AHEAD_AFTER_MS = 5e-3;
const READ_AHEAD_SAMPLE_EVERY = 8;
const STREAM_BLOCK_BYTES = 65536;
const BATCH_BYTES = 65536;
function take(data) {
  const buffer = data.buffer;
  const length = data.length;
  const moved = typeof buffer.transfer === "function" ? buffer.transfer() : structuredClone(buffer, { transfer: [buffer] });
  return new Uint8Array(moved, 0, length);
}
function settle(outcome) {
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}
class ManagedFile {
  constructor(name, readOnly, limits, backend, mode = {}) {
    this.name = name;
    this.readOnly = readOnly;
    this.limits = limits;
    this.backend = backend;
    this.maxReadBytes = limits.maxReadBytes;
    this.capacity = mode.writeBuffer ?? 0;
    this.overlapReads = (mode.overlapReads ?? false) && !this.capacity;
    this.synchronous = mode.synchronous ?? false;
    this.sharedWriter = mode.sharedWriter ?? false;
  }
  name;
  readOnly;
  limits;
  backend;
  maxReadBytes;
  /** Settles after the last accepted task; never rejects, so one failure does not poison later tasks. */
  tail = Promise.resolve();
  /** Set by the first close() call; its presence is what makes the handle unavailable. */
  closing;
  /** Queued plus running operations. */
  operations = 0;
  /** Bytes of write/append copies held by queued or running operations. */
  writeBytes = 0;
  /** Size after this handle's last completed operation; undefined until queried, or after an uncertain mutation. */
  knownSize;
  /**
   * Overlapping mode only: bytes of reads now running, reads waiting for that
   * budget, the unsettled operations accepted since the last mutation, and the
   * number of unsettled mutations. `tail` then settles after the last mutation.
   */
  readBytes = 0;
  waiting = [];
  unsettled = /* @__PURE__ */ new Set();
  barriers = 0;
  /** Appends queued behind the tail whose batch has not started; later appends join it. Every other queued operation ends it. */
  group;
  /** Mutations queued so far; a stream read-ahead queued before the latest one is stale. */
  mutations = 0;
  /** Let reads run concurrently; only for backends that tolerate concurrent reads, and never with a write buffer (a read drains it). */
  overlapReads;
  /** Backend calls never return promises, so an idle handle can write at call time. */
  synchronous;
  /** Other handles write the same file: no size tracking, no append. */
  sharedWriter;
  /**
   * Write bytes reserved by the operation that ran at call time in this turn of
   * the event loop (undefined: none). {@link calm} releases the reservation at
   * the next microtask.
   */
  held;
  calm = () => {
    const bytes2 = this.held;
    this.held = void 0;
    this.release(bytes2);
  };
  /** Small appends last came in bursts, so the next one queues for the rest to join it; a batch of one clears it. */
  bursty = false;
  /** The most recently queued flush whose task has not started. */
  lastFlush;
  /** Write-buffer capacity in bytes (0: off), the buffer once allocated, and its filled prefix. `knownSize` excludes buffered bytes. */
  capacity;
  buffer;
  buffered = 0;
  get [ADMISSION]() {
    return { operations: this.operations, writeBytes: this.writeBytes, readBytes: this.readBytes };
  }
  /** Throws CLOSED once close() was called; work accepted earlier still drains. */
  ensureOpen() {
    if (this.closing) throw new StorageError("CLOSED", `defuss-storage: ${this.name} is closed`);
  }
  /**
   * Reserves one operation slot plus `bytes` of write budget; {@link release}
   * gives them back. Rejects instead of waiting when saturated, so there is
   * never an unbounded queue of callers waiting for capacity.
   */
  admit(bytes2) {
    this.ensureOpen();
    if (this.operations >= this.limits.maxPendingOperations || this.writeBytes + bytes2 > this.limits.maxPendingWriteBytes) {
      throw new StorageError("QUEUE_FULL", `defuss-storage: ${this.name} has too much pending work; await earlier operations`);
    }
    this.operations++;
    this.writeBytes += bytes2;
  }
  /**
   * Gives back one reservation of `writeBytes` and, on an overlapping handle,
   * `readBytes` of read budget. Called exactly once per admitted operation:
   * when its task settles, or when its input copy fails before it is queued.
   * Why counts instead of a release closure per call: VERIFIED: (interleaved
   * probe, memory adapter) counts saved 9–13 ns per read on Bun 1.4.3 and
   * 4–8 ns on Node.js 26.
   */
  release(writeBytes, readBytes = 0, barrier = false) {
    if (barrier) this.barriers--;
    else if (this.overlapReads) this.endRead(readBytes);
    this.operations--;
    this.writeBytes -= writeBytes;
  }
  /**
   * Runs `task` under an existing reservation and releases it when the task
   * settles, whatever the outcome. Serial handles append it to the queue.
   * Overlapping handles start a non-mutation once the last mutation has settled
   * and `readBytes` fit the read budget, and a mutation once everything accepted
   * before it has settled.
   * A failed `mutation` forgets the tracked size: partial progress leaves it uncertain.
   *
   * One `then(onFulfilled, onRejected)` does release, size invalidation and error
   * normalization, so an operation creates as many promises as in 0.1.0.
   * `writeBytes` is the input reserved by {@link admit}.
   * VERIFIED: (per-operation probe, memory adapter, 5 runs × 100k) a 4 KiB append
   * costs 0.83–0.91 µs against 0.90–0.99 µs in 0.1.0.
   */
  enqueue(operation, writeBytes, task, readBytes = 0, mutation = false) {
    if (mutation) this.mutations++;
    const shared = this.overlapReads && !mutation;
    const barrier = this.overlapReads && mutation;
    let started;
    if (shared) started = (this.barriers ? this.tail.then(() => this.startRead(readBytes)) : this.startRead(readBytes)).then(task);
    else if (this.unsettled.size) {
      started = Promise.all([this.tail, ...this.unsettled]).then(task);
      this.unsettled = /* @__PURE__ */ new Set();
    } else started = this.tail.then(task);
    if (barrier) this.barriers++;
    const result = started.then((value) => {
      this.release(writeBytes, readBytes, barrier);
      return value;
    }, (error) => {
      this.release(writeBytes, readBytes, barrier);
      if (mutation) this.knownSize = void 0;
      throw storageError(error, operation);
    });
    const settled = result.then(() => void 0, () => void 0);
    if (shared) {
      const run = this.unsettled;
      run.add(settled);
      void settled.then(() => run.delete(settled));
    } else this.tail = settled;
    return result;
  }
  /** Admits and queues an operation that carries no write input; `readBytes` is its read length. */
  run(operation, task, readBytes = 0, mutation = false) {
    this.admit(0);
    this.group = void 0;
    return this.enqueue(operation, 0, task, readBytes, mutation);
  }
  /**
   * Takes `bytes` of read budget now if it fits and nobody waits, else waits in
   * call order. An idle handle always admits the next read; each read is at most
   * maxReadBytes, so every waiter eventually starts. Waiters are bounded by
   * maxPendingOperations, because each holds an admitted operation slot.
   */
  startRead(bytes2) {
    if (this.waiting.length === 0 && (this.readBytes === 0 || this.readBytes + bytes2 <= this.limits.maxReadBytes)) {
      this.readBytes += bytes2;
      return Promise.resolve();
    }
    return new Promise((start) => this.waiting.push({ bytes: bytes2, start }));
  }
  /** Returns `bytes` of read budget and starts waiting reads, in call order, while they fit. */
  endRead(bytes2) {
    this.readBytes -= bytes2;
    for (let next = this.waiting[0]; next; next = this.waiting[0]) {
      if (this.readBytes !== 0 && this.readBytes + next.bytes > this.limits.maxReadBytes) break;
      this.waiting.shift();
      this.readBytes += next.bytes;
      next.start();
    }
  }
  /** Settles once every operation accepted so far has settled. */
  drained() {
    return this.overlapReads ? Promise.all([this.tail, ...this.unsettled]) : this.tail;
  }
  /**
   * Admits a write/append input and takes its call-time copy, or its buffer when
   * `transfer` is set. The reservation precedes both, so a rejected call never
   * allocates and never detaches the caller's buffer, and a failing copy
   * (allocation failure) gives its reservation back.
   */
  admitCopy(data, transfer) {
    const length = data.length;
    this.admit(length);
    try {
      return transfer ? take(data) : new Uint8Array(data);
    } catch (error) {
      this.release(length);
      throw error;
    }
  }
  /** Throws RangeError for a single input above maxWriteBytes, mirroring the maxReadBytes contract. */
  writeLength(length) {
    if (length > this.limits.maxWriteBytes) throw new RangeError("defuss-storage: maxWriteBytes exceeded");
  }
  /** Throws READ_ONLY for mutations on a read-only handle. */
  writable() {
    if (this.readOnly) throw new StorageError("READ_ONLY", `defuss-storage: ${this.name} is read-only`);
  }
  /** Validates a read window, including the per-call allocation bound. */
  readRange(offset, length) {
    range(offset, length);
    if (length > this.maxReadBytes) throw new RangeError("defuss-storage: maxReadBytes exceeded");
  }
  /**
   * The backend's size as a validated safe integer. Every size the queue acts on
   * goes through here, so a broken custom backend fails with IO_ERROR instead of
   * being mistaken for EOF (a negative or NaN size would otherwise read as empty).
   */
  async currentSize() {
    this.knownSize ??= integer(await this.backend.size(), "file size");
    return this.knownSize;
  }
  /**
   * Reads into the first `length` bytes of `target` until full or EOF (0) and
   * returns the bytes read.
   *
   * `length` is the window admitted at call time. A borrowed readInto target
   * can be detached or resized (resizable ArrayBuffer) while the call waits in
   * the queue or between partial reads; checking its length before every
   * backend read turns that into an error instead of a silent zero-byte success
   * or a read past the admitted (maxReadBytes-checked) length. Each backend read
   * gets a fixed-length window, never a length-tracking view. VERIFIED: (readInto
   * borrowed-target test) detached, grown and shrunk targets reject IO_ERROR,
   * also when resized between two partial reads.
   *
   * A synchronous backend completes the loop here instead of crossing an
   * internal async promise on every chunk. A promise hands the rest of the loop
   * to {@link finishFill}; later calls may be synchronous again. VERIFIED:
   * (21 alternating rounds, memory adapter) this saved 31–59 ns per 4 KiB
   * read on Node.js 26 and Bun 1.4.3 against the always-async loop.
   */
  fill(offset, target, length, options) {
    let used = 0;
    while (used < length) {
      checkAbort(options.signal);
      if (target.length !== length) throw new TypeError("defuss-storage: borrowed readInto target was detached or resized");
      const count = this.backend.read(offset + used, target.subarray(used, length));
      if (typeof count !== "number") return this.finishFill(offset, target, length, options, used, count);
      if (!Number.isSafeInteger(count) || count < 0 || count > length - used) throw new Error("invalid backend read count");
      if (!count) break;
      used += count;
    }
    return used;
  }
  /** Async continuation of {@link fill}, entered only when a backend returns a promise. */
  async finishFill(offset, target, length, options, used, pending) {
    let count = await pending;
    for (; ; ) {
      if (!Number.isSafeInteger(count) || count < 0 || count > length - used) throw new Error("invalid backend read count");
      if (!count) return used;
      used += count;
      if (used === length) return used;
      checkAbort(options.signal);
      if (target.length !== length) throw new TypeError("defuss-storage: borrowed readInto target was detached or resized");
      count = await this.backend.read(offset + used, target.subarray(used, length));
    }
  }
  /**
   * Writes all of `data`, retrying short writes; zero progress throws instead of
   * spinning forever. Completes synchronously while the backend does, like
   * {@link fill}; a promise hands the rest to {@link finishPut}.
   */
  put(offset, data, options) {
    for (let used = 0; used < data.length; ) {
      checkAbort(options.signal);
      const count = this.backend.write(offset + used, data.subarray(used));
      if (typeof count !== "number") return this.finishPut(offset, data, options, used, count);
      if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - used) throw new Error("invalid backend write count");
      used += count;
    }
  }
  /** Async continuation of {@link put}, entered only when a backend returns a promise. */
  async finishPut(offset, data, options, used, pending) {
    for (let count = await pending; ; count = await this.backend.write(offset + used, data.subarray(used))) {
      if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - used) throw new Error("invalid backend write count");
      used += count;
      if (used === data.length) return;
      checkAbort(options.signal);
    }
  }
  /**
   * Call-time path of write (`offset` given) and append on a synchronous backend:
   * the handle is idle and nothing is buffered, so the operation runs now, from
   * the caller's bytes. It is reserved like a queued operation, and the
   * reservation is held until the event loop turns: the calls after it in a
   * burst queue and are admitted exactly as if it were still pending. Failures
   * are normalized as in the queue.
   */
  direct(operation, offset, data, options, transfer) {
    this.admit(data.length);
    this.held = data.length;
    queueMicrotask(this.calm);
    this.mutations++;
    try {
      const size = offset === void 0 ? this.knownSize ??= integer(this.backend.size(), "file size") : this.knownSize;
      const at = offset ?? size;
      range(at, data.length);
      const input = transfer ? take(data) : data;
      if (this.put(at, input, options)) throw new Error("synchronous backend returned a promise");
      if (size !== void 0 && input.length) this.knownSize = Math.max(size, at + input.length);
      return { offset: at, byteLength: input.length };
    } catch (error) {
      this.knownSize = void 0;
      throw storageError(error, operation);
    }
  }
  /**
   * Writes the buffered appends at EOF. Runs inside a queued task, so no append
   * fills the buffer meanwhile. A failure discards them, since any prefix may
   * have landed, and makes the handle query its size again.
   */
  async drain() {
    const length = this.buffered;
    this.buffered = 0;
    try {
      const at = this.knownSize ?? await this.currentSize();
      await this.put(at, this.buffer.subarray(0, length), {});
      this.knownSize = at + length;
    } catch (error) {
      this.knownSize = void 0;
      throw storageError(error, "write buffered appends");
    }
  }
  async size() {
    return this.run("size", async () => {
      if (this.sharedWriter) this.knownSize = void 0;
      return (this.knownSize ?? await this.currentSize()) + this.buffered;
    });
  }
  /** Allocates at most min(length, bytes before EOF), so reading past EOF never allocates `length`. */
  async read(offset, length, options = {}) {
    this.readRange(offset, length);
    return this.run("read", async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      if (this.sharedWriter) this.knownSize = void 0;
      const available = Math.max(0, (this.knownSize ?? await this.currentSize()) - offset);
      const result = new Uint8Array(Math.min(length, available));
      const count = await this.fill(offset, result, result.length, options);
      if (count === result.length) return result;
      this.knownSize = void 0;
      return result.slice(0, count);
    }, length);
  }
  /**
   * Zero-allocation read for callers that reuse buffers. `target` is borrowed
   * until the promise settles; the caller must keep it attached and unresized,
   * otherwise the read rejects (see {@link ManagedFile.fill}).
   */
  async readInto(offset, target, options = {}) {
    bytes(target);
    this.readRange(offset, target.length);
    const length = target.length;
    return this.run("readInto", () => {
      checkAbort(options.signal);
      return this.buffered ? this.drain().then(() => this.fill(offset, target, length, options)) : this.fill(offset, target, length, options);
    }, length);
  }
  async readExactly(offset, length, options = {}) {
    this.readRange(offset, length);
    return this.run("readExactly", () => {
      checkAbort(options.signal);
      const result = new Uint8Array(length);
      const exact = (count) => {
        if (count !== length) throw new StorageError("UNEXPECTED_EOF", `defuss-storage: expected ${length} bytes at ${offset}, read ${count}`);
        return result;
      };
      const reading = this.buffered ? this.drain().then(() => this.fill(offset, result, length, options)) : this.fill(offset, result, length, options);
      return typeof reading === "number" ? exact(reading) : reading.then(exact);
    }, length);
  }
  /**
   * Copies `data` at call time, or writes it at call time (see the class
   * comment), so the caller may reuse its buffer immediately.
   * No rollback: an abort or I/O failure between partial writes leaves the bytes written so far.
   */
  async write(offset, data, options = {}) {
    bytes(data);
    range(offset, data.length);
    this.writeLength(data.length);
    const transfer = transferOption(data, options);
    this.writable();
    this.ensureOpen();
    checkAbort(options.signal);
    if (this.synchronous && !this.operations && !this.buffered) {
      this.direct("write", offset, data, options, transfer);
      return;
    }
    const owned = this.admitCopy(data, transfer);
    this.group = void 0;
    return this.enqueue("write", owned.length, async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      await this.put(offset, owned, options);
      if (this.knownSize !== void 0 && owned.length) this.knownSize = Math.max(this.knownSize, offset + owned.length);
    }, 0, true);
  }
  /**
   * EOF is chosen inside the queued task, so concurrent appends get disjoint,
   * invocation-ordered offsets. The append joins the batch still waiting at the
   * queue's tail, if any; whichever pending member's task runs first writes the
   * batch (see {@link ManagedFile.lead}), and the others report what it recorded.
   */
  async append(data, options = {}) {
    bytes(data);
    this.writeLength(data.length);
    const transfer = transferOption(data, options);
    this.writable();
    this.ensureOpen();
    checkAbort(options.signal);
    if (this.sharedWriter) throw new StorageError("UNSUPPORTED", `defuss-storage: ${this.name} has other writers; write at explicit offsets`);
    if (this.capacity && data.length <= this.capacity) {
      if (this.operations === 0 && this.knownSize !== void 0 && this.buffered + data.length <= this.capacity) {
        const offset = this.knownSize + this.buffered;
        range(offset, data.length);
        (this.buffer ??= new Uint8Array(this.capacity)).set(data, this.buffered);
        this.buffered += data.length;
        this.mutations++;
        if (transfer) take(data);
        return { offset, byteLength: data.length };
      }
      const owned2 = this.admitCopy(data, transfer);
      this.group = void 0;
      return this.enqueue("append", owned2.length, () => this.bufferAppend(owned2, options), 0, true);
    }
    if (this.synchronous && !this.buffered) {
      const shareable = this.backend.writev !== void 0 && data.length < BATCH_BYTES;
      if (!this.operations) {
        if (!shareable || !this.bursty) return this.direct("append", void 0, data, options, transfer);
      } else if (shareable && this.held !== void 0) this.bursty = true;
    }
    const owned = this.admitCopy(data, transfer);
    const entry = { data: owned, options, offset: 0 };
    const group = this.group ?? [];
    group.push(entry);
    const result = this.enqueue("append", owned.length, () => entry.outcome ? settle(entry.outcome) : this.lead(group, entry), 0, true);
    if (this.backend.writev) this.group = group;
    return result;
  }
  /**
   * Writes `first` and every later pending member of its batch back to back at
   * EOF, then returns `first`'s outcome. Members whose signal fired before the
   * batch started write nothing, as a queued append would.
   *
   * Outcomes stay per append: a member completes once all its bytes are
   * confirmed; a failing call (or size query) fails every member it carried,
   * since any of their bytes may have landed; a member cancelled between partial
   * writes fails alone, and the members after it, which no call has carried
   * yet, stay pending, so the next one's own task writes them as a new batch.
   * VERIFIED: (append batching tests) short, failing and cancelled batches.
   * VERIFIED: (probe, Node 26 and Bun 1.4) FileHandle.writev writes 5,000
   * buffers in one call, beyond IOV_MAX (1,024), so batches need no cap besides
   * admission.
   */
  /** Places a queued append that fits the write buffer, writing the buffer first if it is full. */
  async bufferAppend(data, options) {
    checkAbort(options.signal);
    if (this.buffered + data.length > this.capacity) await this.drain();
    const offset = (this.knownSize ?? await this.currentSize()) + this.buffered;
    range(offset, data.length);
    (this.buffer ??= new Uint8Array(this.capacity)).set(data, this.buffered);
    this.buffered += data.length;
    return { offset, byteLength: data.length };
  }
  async lead(group, first) {
    if (this.group === group) this.group = void 0;
    if (this.buffered) await this.drain();
    if (group.length === 1) {
      this.bursty = false;
      checkAbort(first.options.signal);
      const offset = this.knownSize ?? await this.currentSize();
      range(offset, first.data.length);
      await this.put(offset, first.data, first.options);
      this.knownSize = offset + first.data.length;
      return { offset, byteLength: first.data.length };
    }
    const members = [];
    for (let i = group.indexOf(first); i < group.length; i++) {
      const member = group[i];
      if (member.outcome) continue;
      try {
        checkAbort(member.options.signal);
        members.push(member);
      } catch (error) {
        member.outcome = { error };
      }
    }
    if (!members.length) return settle(first.outcome);
    let next = 0;
    try {
      const start = this.knownSize ?? await this.currentSize();
      let end = start;
      for (const member of members) {
        range(end, member.data.length);
        member.offset = end;
        end += member.data.length;
      }
      for (let done = start; ; ) {
        for (let m = members[next]; m && m.offset + m.data.length <= done; m = members[++next]) m.outcome = { result: { offset: m.offset, byteLength: m.data.length } };
        if (next === members.length) break;
        const current = members[next];
        try {
          checkAbort(current.options.signal);
        } catch (error) {
          current.outcome = { error };
          break;
        }
        const chunks = members.slice(next).map((m) => m.data.subarray(Math.max(0, done - m.offset)));
        const count = await (chunks.length > 1 && this.backend.writev ? this.backend.writev(done, chunks) : this.backend.write(done, chunks[0]));
        if (!Number.isSafeInteger(count) || count <= 0 || count > end - done) throw new Error("invalid backend write count");
        done += count;
      }
      this.knownSize = next === members.length ? end : void 0;
    } catch (error) {
      for (; next < members.length; next++) members[next].outcome = { error };
      this.knownSize = void 0;
    }
    return settle(first.outcome);
  }
  async truncate(size, options = {}) {
    integer(size, "size");
    this.writable();
    return this.run("truncate", async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      await this.backend.truncate(size);
      this.knownSize = size;
    }, 0, true);
  }
  /**
   * Allowed on read-only handles: flushing persists nothing new but is harmless.
   * When its turn comes while a later flush is queued, it leaves the backend
   * call to that flush and adopts its outcome (see the class comment).
   */
  async flush() {
    const entry = { carries: false };
    const queued = this.run("flush", async () => {
      const later = this.lastFlush;
      if (later === entry) this.lastFlush = void 0;
      else if (later && !entry.carries) {
        later.carries = true;
        return later;
      }
      if (this.buffered) await this.drain();
      await this.backend.flush();
      return void 0;
    });
    this.lastFlush = entry;
    return entry.done = queued.then((later) => later?.done);
  }
  /**
   * Marks the handle closed immediately, waits for accepted tasks, then closes
   * the backend (which releases ownership). Never subject to admission, so a
   * saturated handle can always be closed. Every call returns the same promise,
   * so concurrent closers observe one outcome and the backend closes once.
   *
   * A failed close is final, not retried: the resource state is uncertain, so
   * the built-in adapters keep the name owned (quarantined) until the owning
   * realm or worker ends. This differs from ordinary I/O errors, after which
   * the queue stays usable. Buffered appends are written first; if that fails
   * the backend still closes (releasing ownership) and close rejects with the
   * buffer-write error.
   */
  close() {
    this.closing ??= this.drained().then(async () => {
      let lost;
      if (this.buffered) await this.drain().catch((error) => {
        lost = error;
      });
      this.buffer = void 0;
      try {
        await this.backend.close();
      } catch (error) {
        throw storageError(error, "close");
      }
      if (lost !== void 0) throw lost;
    });
    return this.closing;
  }
  /**
   * Yields owned chunks of `[start, end)`, reading one block ahead of a slow consumer.
   *
   * A block is one queued read: a chunk of {@link STREAM_BLOCK_BYTES} or more,
   * or as many smaller chunks as fit that size and maxReadBytes, read into a
   * scratch buffer the stream reuses; each of those is then copied out into a
   * buffer of its own. VERIFIED: (interleaved probe, Node 26, memory adapter,
   * 4 KiB chunks) a new buffer per block made the stream 0.73 times as fast as
   * a read per chunk, since the copy-out costs what the read did. When the consumer spent at
   * least {@link READ_AHEAD_AFTER_MS} per block (measured on the first chunk,
   * then every {@link READ_AHEAD_SAMPLE_EVERY}th), the read of the next block is
   * queued just before the current one is yielded, so it runs while the consumer
   * works. A faster consumer gains nothing from the overlap and would pay for it
   * (see the constant), so its blocks are read at their pull. A paused consumer
   * therefore holds at most the block in use and one read ahead, and a queue slot
   * only until that read settles; a saturated handle skips the read-ahead rather
   * than take the last slot from other callers.
   *
   * The end offset is fixed on the first pull (later appends are excluded) but
   * bytes are not snapshotted: overwrites become visible, and a shrink below the
   * unread range rejects UNEXPECTED_EOF at the first chunk that lost bytes. Bytes
   * read before their pull (the rest of a block, a block read ahead) are used
   * only if no mutation was queued since and the handle is still open, which is
   * when a read at pull time would return the same bytes; otherwise the chunk is
   * read again at its pull. A read-ahead's error, if any, surfaces only at that
   * pull. As an async generator, validation runs on the first `next()`, not when
   * `stream()` is called.
   * VERIFIED: (contract cases "a mutation queued after a read-ahead" and "streams
   * fix their end") a write and a truncation queued between two pulls are seen
   * by the next chunk, within a block and across a read-ahead.
   */
  async *stream(options = {}) {
    const start = integer(options.start ?? 0, "start");
    const chunkSize = integer(options.chunkSize ?? Math.min(65536, this.maxReadBytes), "chunkSize", true);
    if (chunkSize > this.maxReadBytes) throw new RangeError("defuss-storage: chunkSize exceeds maxReadBytes");
    if (options.end !== void 0) {
      integer(options.end, "end");
      if (options.end < start) throw new RangeError("defuss-storage: end precedes start");
    }
    checkAbort(options.signal);
    const end = Math.min(options.end ?? Number.MAX_SAFE_INTEGER, await this.size());
    const perBlock = Math.max(1, Math.floor(Math.min(STREAM_BLOCK_BYTES, this.maxReadBytes) / chunkSize));
    const blockBytes = perBlock * chunkSize;
    let scratch;
    const load = (offset) => {
      const length = Math.min(blockBytes, end - offset);
      if (perBlock === 1) return { bytes: this.readExactly(offset, length, options), into: void 0, mutations: this.mutations };
      const into = scratch ?? new Uint8Array(Math.min(blockBytes, end - start));
      scratch = void 0;
      return { bytes: this.readInto(offset, into.subarray(0, length), options).then((count) => into.subarray(0, count)), into, mutations: this.mutations };
    };
    let ahead;
    let busy = 0;
    let pulls = 0;
    for (let offset = start; offset < end; ) {
      checkAbort(options.signal);
      const current = ahead?.mutations === this.mutations && !this.closing ? ahead : load(offset);
      ahead = void 0;
      const block = await current.bytes;
      const length = Math.min(blockBytes, end - offset);
      if (busy * perBlock >= READ_AHEAD_AFTER_MS && offset + length < end && this.operations < this.limits.maxPendingOperations) {
        ahead = load(offset + length);
        ahead.bytes.catch(() => void 0);
      }
      for (let used = 0; used < length; ) {
        if (used) {
          checkAbort(options.signal);
          if (current.mutations !== this.mutations || this.closing) {
            ahead = void 0;
            break;
          }
        }
        const size = Math.min(chunkSize, length - used);
        if (block.length < used + size) throw new StorageError("UNEXPECTED_EOF", `defuss-storage: expected ${size} bytes at ${offset}, read ${block.length - used}`);
        const chunk = current.into ? block.slice(used, used + size) : block;
        used += size;
        offset += size;
        const timed = pulls++ % READ_AHEAD_SAMPLE_EVERY === 0;
        const yielded = timed ? performance.now() : 0;
        yield chunk;
        if (timed) busy = performance.now() - yielded;
      }
      scratch = current.into ?? scratch;
    }
  }
}

const exact = (data) => {
  const { buffer } = data;
  return buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === buffer.byteLength ? buffer : data.slice().buffer;
};
function fileBackend(file, release) {
  let snapshot;
  const current = () => snapshot ??= file.getFile();
  const commit = async (edit) => {
    snapshot = void 0;
    const stream = await file.createWritable({ keepExistingData: true });
    let written;
    try {
      written = await edit(stream);
    } catch (error) {
      await stream.abort(error).catch(() => {
      });
      throw error;
    }
    await stream.close();
    return written;
  };
  const slice = async (offset, length) => new Uint8Array(await (await current()).slice(offset, offset + length).arrayBuffer());
  return {
    size: async () => (await current()).size,
    read: async (offset, target) => {
      let bytes;
      try {
        bytes = await slice(offset, target.length);
      } catch {
        snapshot = void 0;
        bytes = await slice(offset, target.length);
      }
      target.set(bytes);
      return bytes.length;
    },
    write: (offset, data) => commit(async (stream) => {
      await stream.write({ type: "write", position: offset, data: exact(data) });
      return data.length;
    }),
    writev: (offset, chunks) => commit(async (stream) => {
      let at = offset;
      for (const chunk of chunks) {
        await stream.write({ type: "write", position: at, data: exact(chunk) });
        at += chunk.length;
      }
      return at - offset;
    }),
    truncate: async (size) => {
      await commit(async (stream) => {
        await stream.truncate(size);
        return 0;
      });
    },
    // Nothing to flush: each write was committed when its stream closed.
    flush: () => {
    },
    close: release
  };
}
async function acquire(locks, name, mode = "exclusive") {
  let unlock;
  let resolve;
  let reject;
  const held = new Promise((r) => {
    unlock = r;
  });
  const acquired = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const request = locks.request(name, { ifAvailable: true, mode }, async (lock) => {
    if (!lock) {
      reject(new StorageError("BUSY", "defuss-storage: file already has an owner"));
      return;
    }
    resolve();
    await held;
  });
  void request.catch(reject);
  await acquired;
  return async () => {
    unlock();
    await request;
  };
}

class DirectoryStorage {
  constructor(name, root, locks, limits) {
    this.name = name;
    this.root = root;
    this.locks = locks;
    this.limits = limits;
  }
  name;
  root;
  locks;
  limits;
  capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "origin-cooperative", snapshots: false, atomicReplace: false, sharedWriters: false });
  /**
   * Checks the handle and Web Locks. Rejects TypeError for anything but a
   * directory handle, and UNSUPPORTED without Web Locks.
   */
  static async create(directory, options = {}) {
    if (directory?.kind !== "directory" || typeof directory.getFileHandle !== "function") {
      throw new TypeError("defuss-storage: createDirectoryStorage needs a FileSystemDirectoryHandle");
    }
    const name = options.name ?? directory.name;
    if (typeof name !== "string") throw new TypeError("defuss-storage: name must be a string");
    const limits = handleLimits(options);
    const locks = globalThis.navigator?.locks;
    if (!locks?.request) throw new StorageError("UNSUPPORTED", "defuss-storage: directory storage requires Web Locks");
    return new DirectoryStorage(name, directory, locks, limits);
  }
  /** Lock for one file, shared or exclusive; the adapter name is encoded, so no folder name can make the key ambiguous. */
  lock(name, shared = false) {
    return acquire(this.locks, `defuss-storage:v0:directory:${encodeURIComponent(this.name)}:${name}`, shared ? "shared" : "exclusive");
  }
  /**
   * Opens `name` under its Web Lock (shared for a shared reader), which stays held until close. Rejects
   * UNSUPPORTED for a shared writer: every write commits a copy of the whole
   * file, so two writers' commits would replace each other's bytes. HYPOTHESIS:
   * (falsifier: both of two overlapping commits keep their bytes); rejects
   * UNSUPPORTED for a writable open where the browser lacks `createWritable`,
   * and for a directory under a valid name (TypeMismatchError).
   */
  async open(name, options = {}) {
    validateName(name);
    const opts = openOptions(options);
    if (opts.shared && !opts.readOnly) throw new StorageError("UNSUPPORTED", "defuss-storage: directory handles have no shared writers");
    const release = await this.lock(name, opts.shared);
    try {
      let file;
      try {
        file = await this.root.getFileHandle(name, { create: false });
        if (opts.exclusive) throw new StorageError("ALREADY_EXISTS", `defuss-storage: ${name} exists`);
      } catch (error) {
        if (error.name !== "NotFoundError" || !opts.create) throw error;
        file = await this.root.getFileHandle(name, { create: true });
      }
      if (!opts.readOnly && typeof file.createWritable !== "function") {
        throw new StorageError("UNSUPPORTED", "defuss-storage: this browser cannot write to directory handles");
      }
      return new ManagedFile(name, opts.readOnly, this.limits, fileBackend(file, release), { writeBuffer: opts.writeBuffer });
    } catch (error) {
      await release();
      throw storageError(error, "open");
    }
  }
  /** Files with valid names only; foreign entries (other names, directories) are skipped, never touched. */
  async list() {
    const names = [];
    try {
      for await (const [name, handle] of this.root.entries()) {
        if (handle.kind !== "file") continue;
        try {
          validateName(name);
          names.push(name);
        } catch {
        }
      }
      return names.sort();
    } catch (error) {
      throw storageError(error, "list");
    }
  }
  /** Removes `name` under its Web Lock, so removing an open file rejects BUSY. */
  async remove(name) {
    validateName(name);
    const release = await this.lock(name);
    try {
      await this.root.getFileHandle(name, { create: false });
      await this.root.removeEntry(name);
      return true;
    } catch (error) {
      if (error.name === "NotFoundError") return false;
      throw storageError(error, "remove");
    } finally {
      await release();
    }
  }
}
const createDirectoryStorage = (directory, options = {}) => DirectoryStorage.create(directory, options);

export { DirectoryStorage, createDirectoryStorage };
