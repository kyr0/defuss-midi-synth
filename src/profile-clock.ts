/** Native-clock streaming resampler. Causal linear interpolation, one native-sample delay.
 * Integer phase makes output independent of render partitioning. Does not render across MIDI boundaries.
 * Not an analog reconstruction filter; high-ratio downsampling is not band-limited.
 */
export class NativeClock {
  private phase = 0;
  private pl = 0; private pr = 0;
  private cl = 0; private cr = 0;
  private readonly l = new Float32Array(128);
  private readonly r = new Float32Array(128);
  constructor(readonly nativeRate: number, readonly outputRate: number) {
    if (!Number.isSafeInteger(nativeRate) || nativeRate < 8000 || nativeRate > 192000 ||
        !Number.isSafeInteger(outputRate) || outputRate < 8000 || outputRate > 192000) throw new RangeError('Invalid PCM clock');
  }
  render(left: Float32Array, right: Float32Array, offset: number, frames: number,
    pull: (l: Float32Array, r: Float32Array, n: number) => void): void {
    if (!Number.isInteger(frames) || frames < 0 || frames > 128 || !Number.isInteger(offset) || offset < 0 || offset + frames > Math.min(left.length, right.length)) throw new RangeError('Invalid render range');
    let remaining = Math.floor((this.phase + frames * this.nativeRate) / this.outputRate);
    let at = 0, count = 0;
    for (let i = 0; i < frames; i++) {
      this.phase += this.nativeRate;
      while (this.phase >= this.outputRate) {
        this.phase -= this.outputRate;
        if (at === count) {
          count = Math.min(128, remaining);
          pull(this.l, this.r, count);
          remaining -= count; at = 0;
        }
        this.pl = this.cl; this.pr = this.cr;
        this.cl = this.l[at]!; this.cr = this.r[at++]!;
      }
      const f = this.phase / this.outputRate;
      left[offset + i] = this.pl + (this.cl - this.pl) * f;
      right[offset + i] = this.pr + (this.cr - this.pr) * f;
    }
  }
  reset(): void { this.phase = 0; this.pl = this.pr = this.cl = this.cr = 0; }
}
