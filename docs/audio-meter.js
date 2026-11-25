// BS.1770 K-weighting. The shelf and RLB high-pass use the sample-rate-independent
// parameters from libebur128: https://github.com/jiixyj/libebur128/blob/master/ebur128/ebur128.c
function filterStage(context, hz, q, highGain, middleGain) {
  const k = Math.tan(Math.PI * hz / context.sampleRate);
  const damping = k / q, square = k * k, norm = 1 + damping + square;
  const feedback = [1, 2 * (square - 1) / norm, (1 - damping + square) / norm];
  const feedforward = highGain === undefined ? [1, -2, 1] : [
    (highGain + middleGain * damping + square) / norm,
    2 * (square - highGain) / norm,
    (highGain - middleGain * damping + square) / norm,
  ];
  return context.createIIRFilter(feedforward, feedback);
}

export function kWeighted(source) {
  const context = source.context;
  const highGain = 10 ** (3.999843853973347 / 20);
  const shelf = filterStage(context, 1681.974450955533, 0.7071752369554196, highGain, highGain ** 0.4996667741545416);
  const highpass = filterStage(context, 38.13547087602444, 0.5003270373238773);
  return source.connect(shelf).connect(highpass);
}

export async function meterOutput(source, onLevels) {
  const context = source.context;
  await context.audioWorklet.addModule(new URL('./level-meter.worklet.js', import.meta.url));
  const meter = new AudioWorkletNode(context, 'player-level-meter', { numberOfInputs: 2, numberOfOutputs: 0 });
  meter.port.onmessage = ({ data }) => onLevels(data);
  source.connect(meter, 0, 0);
  kWeighted(source).connect(meter, 0, 1);
}
