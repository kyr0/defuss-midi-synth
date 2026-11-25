// Four successive 100 ms blocks form each momentary loudness and RMS reading.
class LevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockFrames = Math.round(sampleRate / 10);
    this.raw = new Float64Array(4);
    this.weighted = new Float64Array(4);
    this.slot = 0;
    this.filled = 0;
    this.frames = 0;
  }
  process([raw, weighted]) {
    if (!raw.length || weighted.length !== raw.length) return true;
    const frames = raw[0].length;
    for (let start = 0; start < frames;) {
      const count = Math.min(frames - start, this.blockFrames - this.frames);
      for (let ch = 0; ch < raw.length; ch++) {
        const samples = raw[ch], filtered = weighted[ch];
        let energy = 0, weightedEnergy = 0;
        for (let i = start; i < start + count; i++) {
          energy += samples[i] * samples[i];
          weightedEnergy += filtered[i] * filtered[i];
        }
        this.raw[this.slot] += energy;
        this.weighted[this.slot] += weightedEnergy;
      }
      start += count;
      this.frames += count;
      if (this.frames === this.blockFrames) {
        this.filled = Math.min(this.filled + 1, 4);
        if (this.filled === 4) {
          const window = 4 * this.blockFrames;
          const power = this.raw.reduce((sum, value) => sum + value);
          const kPower = this.weighted.reduce((sum, value) => sum + value);
          this.port.postMessage({
            rms: 10 * Math.log10(power / (window * raw.length)),
            lufs: -0.691 + 10 * Math.log10(kPower / window),
            channels: raw.length,
          });
        }
        this.slot = (this.slot + 1) % 4;
        this.raw[this.slot] = this.weighted[this.slot] = 0;
        this.frames = 0;
      }
    }
    return true;
  }
}
registerProcessor('player-level-meter', LevelMeter);
