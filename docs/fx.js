import { kWeighted } from './audio-meter.js';

// The same stereo effects chain processes the instrument and downloaded WAVs.
export function fxSettings() {
  const value = id => document.getElementById('fx-' + id).valueAsNumber;
  const eq = document.getElementById('fx-eq');
  const { bands } = globalThis.df$.shadcn.envelope.params(eq) ?? JSON.parse(eq.querySelector('.envelope-source').textContent);
  return {
    bands, compressor: document.getElementById('fx-compressor').checked,
    autoLevel: document.getElementById('fx-auto-level').checked,
    threshold: value('threshold'), ratio: value('ratio'), attack: value('attack'), release: value('release'),
    mix: value('mix'), decay: value('decay'),
  };
}

export function hasEffects(settings) {
  return settings && (settings.compressor || settings.mix > 0 || settings.bands.some(band => band.gain !== 0));
}

// A repeatable stereo noise impulse, decaying by 60 dB over the selected time.
function roomImpulse(context, seconds) {
  const frames = Math.ceil(seconds * context.sampleRate);
  const impulse = context.createBuffer(2, frames, context.sampleRate);
  const falloff = Math.exp(Math.log(.001) / frames);
  let seed = 12345;
  for (let ch = 0; ch < 2; ch++) {
    const samples = impulse.getChannelData(ch);
    let amplitude = 1;
    for (let i = 0; i < frames; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 2147483648 - 1) * amplitude;
      amplitude *= falloff;
    }
  }
  return impulse;
}

export async function createFx(context, initial) {
  await context.audioWorklet.addModule(new URL('./loudness-leveler.worklet.js', import.meta.url));
  const input = context.createGain(), output = context.createGain();
  const filters = initial.bands.map(band => {
    const node = context.createBiquadFilter();
    node.type = band.type;
    return node;
  });
  const postEq = filters.reduce((prev, filter) => prev.connect(filter), input);
  const comp = context.createDynamicsCompressor(), bus = context.createGain();
  const dry = context.createGain(), wet = context.createGain(), reverb = context.createConvolver();
  const mix = context.createGain();
  bus.connect(dry).connect(mix);
  reverb.connect(wet).connect(mix);
  const leveler = new AudioWorkletNode(context, 'loudness-leveler', {
    numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2],
  });
  const weighted = kWeighted(mix);
  let leveling;
  let previous;
  function set(param, value) {
    if (previous) param.setTargetAtTime(value, context.currentTime, .01);
    else param.value = value;
  }
  function update(settings) {
    settings.bands.forEach((band, i) => {
      set(filters[i].frequency, Math.min(band.frequency, context.sampleRate / 2));
      set(filters[i].Q, band.Q ?? 1);
      set(filters[i].gain, band.gain);
    });
    for (const key of ['threshold', 'ratio', 'attack', 'release']) set(comp[key], settings[key]);
    comp.knee.value = 6;
    if (previous?.compressor !== settings.compressor) {
      postEq.disconnect();
      comp.disconnect();
      if (settings.compressor) postEq.connect(comp).connect(bus);
      else postEq.connect(bus);
    }
    if (settings.mix > 0 && (!previous?.mix || previous.decay !== settings.decay)) {
      reverb.buffer = roomImpulse(context, settings.decay);
      if (!previous?.mix) bus.connect(reverb);
    } else if (settings.mix === 0 && previous?.mix) {
      bus.disconnect(reverb);
      reverb.buffer = null;
    }
    set(dry.gain, 1 - settings.mix);
    set(wet.gain, settings.mix);
    const enabled = Boolean(settings.compressor && settings.autoLevel);
    if (enabled !== leveling) {
      if (leveling !== undefined) mix.disconnect(leveling ? leveler : output);
      if (enabled) {
        if (leveling === false) leveler.port.postMessage('reset');
        mix.connect(leveler, 0, 0);
        weighted.connect(leveler, 0, 1);
        leveler.connect(output);
      } else {
        if (leveling) {
          weighted.disconnect(leveler);
          leveler.disconnect(output);
        }
        mix.connect(output);
      }
      leveling = enabled;
    }
    previous = settings;
  }
  update(initial);
  return { input, output, update };
}
