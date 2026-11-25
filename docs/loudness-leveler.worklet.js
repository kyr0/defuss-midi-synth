// Compare stereo K-weighted energy with the target before listening volume is applied.
// A common gain keeps the stereo image intact. The peak guard also links both channels.
const TARGET_LUFS = -16, MAX_GAIN_DB = 12;
const GATE_POWER = 10 ** ((-48 + .691) / 10);

class LoudnessLeveler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = Math.round(sampleRate * .1);
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * .08));
    this.peakRelease = 1 - Math.exp(-1 / (sampleRate * .12));
    this.reset();
    this.port.onmessage = () => this.reset();
  }
  reset() {
    this.energy = this.frames = this.mean = 0;
    this.targetGain = this.gain = this.guard = 1;
  }
  process([raw, weighted], [out]) {
    if (!raw.length || !weighted.length) {
      if (this.frames || this.mean) this.reset();
      return true;
    }
    for (let i = 0; i < out[0].length; i++) {
      let energy = 0, peak = 0;
      for (let ch = 0; ch < weighted.length; ch++) energy += weighted[ch][i] ** 2;
      for (let ch = 0; ch < raw.length; ch++) peak = Math.max(peak, Math.abs(raw[ch][i]));
      this.energy += energy;
      if (++this.frames === this.block) {
        const power = this.energy / this.block;
        // Hold through silence and quiet releases. Smooth active power over about one second.
        if (power > GATE_POWER) {
          this.mean = this.mean ? .9 * this.mean + .1 * power : power;
          const lufs = -.691 + 10 * Math.log10(this.mean);
          const db = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_LUFS - lufs));
          this.targetGain = 10 ** (db / 20);
        }
        this.frames = this.energy = 0;
      }
      this.gain += (this.targetGain - this.gain) * this.smoothing;
      this.guard = Math.min(this.guard + (1 - this.guard) * this.peakRelease, .94 / Math.max(.000001, peak * this.gain));
      for (let ch = 0; ch < out.length; ch++) out[ch][i] = raw[ch % raw.length][i] * this.gain * this.guard;
    }
    return true;
  }
}
registerProcessor('loudness-leveler', LoudnessLeveler);
