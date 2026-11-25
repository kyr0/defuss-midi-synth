import { MidiSynth } from './synth/index.js';
import { coreReader, pciSoundFontLabel } from './sound-cards.js';
import { createPlayer } from './player.js';
import { createFx, fxSettings } from './fx.js';
import { meterOutput } from './audio-meter.js';
import { createProgress } from './progress.js';
import { renderWav, save } from './render.js';
const $ = id => document.getElementById(id);
let synth, starting, analyser, waveform, fontSource, customFont = false, customBank, player;
let cardGain = 1, fx, master;
function updateFx() {
  $('fx-auto-level').disabled = !$('fx-compressor').checked;
  fx?.update(fxSettings());
}
$('fx').addEventListener('input', updateFx);
$('fx').addEventListener('envelope-change', updateFx);
function applyOutputGain() {
  if (!master) return;
  if (synth) synth.output.gain.setTargetAtTime(cardGain, master.context.currentTime, 0.01);
  master.gain.setTargetAtTime(Number($('gain').value) / 100, master.context.currentTime, 0.01);
}
const soundFontName = () => customFont ? 'Your SoundFont file' : pciSoundFontLabel;
const progress = createProgress($('load-progress'));
function storageWarning(reason) { $('card-status').textContent = `Browser cache unavailable: ${reason}`; }
const readWasm = coreReader(progress, storageWarning);
// Pressed keys by pointer or key code; lit notes by source (a pointer, a key code, a Web MIDI channel); the scope's end.
const active = new Map(), lit = new Map();
let scopeUntil = 0;
// The recording (see record below): its messages, its clock, the notes and pedals it holds.
const GAP = 2, holding = new Set();
let take = [], takeStart = 0, takeLast = 0;
const bankName = bank => bank === 0 ? 'General MIDI' : bank === 128 ? 'Drum kits' : 'Variations';
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
// Drum kits sound on channel 10 (index 9), every melodic preset on channel 1.
const selected = () => { const bank = Number($('bank').value), program = Number($('program').value); return { bank, program, channel: bank >= 128 ? 9 : synth?.info.kind === 'roland-mt32' ? 1 : 0 }; };
function message(text) { $('message').textContent = text; }
function run(fn) { return async () => { try { await fn(); } catch (error) { message(error.message); } }; }
function listBanks(info, bank = 0, program = 0) {
  const banks = [...new Set(info.presets.map(p => p.bank))];
  $('bank').replaceChildren(...banks.map(b => new Option(`${b} · ${bankName(b)} (${info.presets.filter(p => p.bank === b).length})`, b)));
  $('bank').value = String(banks.includes(bank) ? bank : banks[0]);
  listPrograms(info, program);
}
function listPrograms(info, program = 0) {
  const bank = Number($('bank').value), presets = info.presets.filter(p => p.bank === bank);
  $('program').replaceChildren(...presets.map(p => new Option(`${String(p.program + 1).padStart(3, '0')} · ${p.name}`, p.program)));
  $('program').value = String(presets.some(p => p.program === program) ? program : presets[0].program);
}
/** The engines that play libADLMIDI's banks and WOPL files. */
const FM_KINDS = ['fm', 'sb16-opl3', 'sb16-cqm'];
function showEngine(info) {
  $('engine-label').textContent = FM_KINDS.includes(info.kind)
    ? `LIBADLMIDI / NUKED ${info.kind === 'sb16-cqm' ? 'CQM' : 'OPL3'} · ${info.fm.bank < 0 ? 'WOPL FILE' : `BANK ${info.fm.bank}`}`
    : info.kind === 'soundfont' ? `TINYSOUNDFONT / ${customFont ? 'YOUR SOUNDFONT' : pciSoundFontLabel}` : info.engine.toUpperCase();
}
async function applyPreset() {
  releaseKeys();
  const { bank, program, channel } = selected();
  await synth.selectPreset(channel, bank, program);
  if (take.length) record({ event: { type: 'preset', channel, bank, program } });
  $('patch-name').textContent = synth.info.presets.find(p => p.bank === bank && p.program === program).name;
  $('bank-label').textContent = `Bank ${bank} · ${bankName(bank)} · channel ${channel + 1}`;
}
/** What a WAV download plays on: the engine shown, album's FM bank (the piano's bank without an album) or the user's
 *  WOPL file, the SoundFont, and the selected card's pack and core. */
function sound(album) {
  const info = synth.info, own = FM_KINDS.includes(info.kind) && info.fm.bank < 0, pack = player?.packs[info.kind];
  return { engine: info.kind, fmBank: own ? 0 : album?.fm?.bank ?? Math.max(0, info.fm?.bank ?? 0), bank: own ? customBank : undefined, soundfont: fontSource, readWasm, cardGain, fx: fxSettings(),
    profileSources: pack ? { [info.kind]: pack } : undefined };
}
let outputReady;
function startOutput() {
  outputReady ??= (async () => {
    const context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await context.resume();
      fx = await createFx(context, fxSettings());
      fx.update(fxSettings());
      master = context.createGain();
      fx.output.connect(master).connect(context.destination);
      applyOutputGain();
      analyser = context.createAnalyser(); analyser.fftSize = 1024; waveform = new Float32Array(1024); master.connect(analyser);
      $('stats-rate').textContent = `${context.sampleRate / 1000} kHz (${context.sampleRate.toLocaleString()} samples/s)`;
      meterOutput(master, ({ rms, lufs }) => {
        $('stats-rms').textContent = meterValue(rms);
        $('stats-lufs').textContent = meterValue(lufs);
      }).catch(error => message(`Level meter unavailable: ${error.message}`));
      context.addEventListener('statechange', () => {
        if (context.state !== 'running') $('stats-rms').textContent = $('stats-lufs').textContent = '—';
      });
      return fx.input;
    } catch (error) {
      await context.close(); outputReady = undefined; master = undefined; fx = undefined; throw error;
    }
  })();
  return outputReady;
}
/** Starts audio once, from a click: the power button or any player control. Resolves with the synthesizer. */
function startAudio(initial) {
  starting ??= (async () => {
    $('power').disabled = true; message('Starting the synthesizer…');
    try {
      const { context } = await startOutput();
      const options = await initial();
      synth = await MidiSynth.create({ context, baseUrl: new URL('./synth/', import.meta.url), gain: 0,
        ...options, connect: false, readWasm, timeoutMs: 120000, onProgress: progress });
      synth.output.connect(fx.input);
      applyOutputGain();
      listBanks(synth.info); showEngine(synth.info); $('controls').disabled = false; $('led').classList.add('on');
      $('rate').textContent = `${context.sampleRate.toLocaleString()} Hz · STEREO`; $('power').textContent = 'Audio enabled';
      await applyPreset(); message(`Ready: ${synth.info.engine}.`); draw();
      player?.started(synth);
      connectMidi();
      return synth;
    } catch (error) {
      starting = undefined; synth = undefined; $('power').disabled = false;
      throw error;
    }
  })();
  return starting;
}
player = await createPlayer({
  startAudio, startOutput, readWasm,
  soundFontName,
  cardFont(bytes) { fontSource = bytes; customFont = false; },
  storageWarning,
  sound,
  progress,
  analyser: () => analyser,
  message,
  setCardGain(value) { cardGain = value; applyOutputGain(); },
  setVolume(value) { $('gain').value = String(Math.round(value * 100)); $('gain-value').value = `${$('gain').value}%`; applyOutputGain(); },
  async engineChanged(info) {
    showEngine(info);
    listBanks(info, Number($('bank').value), Number($('program').value));
    // While a song plays, the piano's channel keeps the song's program; the display names the selected one.
    if (!player.playing) await applyPreset();
    else { const { bank, program } = selected(); $('patch-name').textContent = info.presets.find(p => p.bank === bank && p.program === program).name; }
  },
});
$('power').onclick = run(player.start);
$('power').disabled = false;
$('bank').onchange = run(async () => { listPrograms(synth.info); await applyPreset(); });
$('program').onchange = run(applyPreset);
$('velocity').oninput = () => { $('velocity-value').value = $('velocity').value; };
$('gain').oninput = () => { $('gain-value').value = `${$('gain').value}%`; applyOutputGain(); player.volumeChanged(Number($('gain').value) / 100); };
function demoScore(start, channel) {
  const notes = [60,64,67,72,71,67,64,62,57,60,64,69,67,64,62,60];
  return notes.flatMap((note, i) => [
    { time: start + i * 0.25, type: 'noteOn', channel, note, velocity: Number($('velocity').value) },
    { time: start + i * 0.25 + 0.2, type: 'noteOff', channel, note },
  ]);
}
$('demo').onclick = run(async () => {
  await player.stop(); await applyPreset(); await synth.schedule(demoScore(synth.context.currentTime + 0.08, selected().channel));
  scopeUntil = performance.now() + 4500; message('Playing the demo sequence.');
});
$('stop').onclick = run(async () => { await player.stop(); releaseKeys(); scopeUntil = 0; message('Stopped.'); });
$('panic').onclick = run(async () => { releaseKeys(); releaseMidi(); scopeUntil = 0; await synth.panic(); message('All notes and scheduled events cleared.'); });

// The keys light while a note sounds from any source: the mouse, the computer keyboard or a Web MIDI keyboard.
function light(note, source, on) {
  const sources = lit.get(note) ?? new Set();
  if (on) sources.add(source); else sources.delete(source);
  if (sources.size) lit.set(note, sources); else lit.delete(note);
  document.querySelector(`[data-note="${note}"]`)?.classList.toggle('active', sources.size > 0);
  // The scope shows the keys' sound and a short release after the last one.
  if (!on && !lit.size) scopeUntil = performance.now() + 800;
}
const black = new Set([1,3,6,8,10]); let whites = 0;
const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
for (let note = 60; note <= 84; note++) {
  const key = document.createElement('button'); key.type = 'button'; key.className = 'key'; key.dataset.note = note;
  key.setAttribute('aria-label', `${names[note % 12]}${Math.floor(note / 12) - 1}`);
  if (black.has(note % 12)) { key.classList.add('black'); key.style.left = `${whites / 15 * 100 - 2.05}%`; }
  else { whites++; key.innerHTML = `<span>${names[note % 12]}${Math.floor(note / 12) - 1}</span>`; }
  key.onpointerdown = event => { event.preventDefault(); key.setPointerCapture(event.pointerId); press(`p${event.pointerId}`, note); };
  key.onpointerup = key.onpointercancel = event => release(`p${event.pointerId}`);
  $('keyboard').append(key);
}
function press(id, note) {
  if (!synth || active.has(id)) return;
  const channel = selected().channel, velocity = Number($('velocity').value);
  active.set(id, { note, channel }); light(note, id, true);
  synth.noteOn(channel, note, velocity).catch(e => message(e.message));
  record({ bytes: [0x90 | channel, note, velocity] });
}
function release(id) {
  const key = active.get(id); if (key === undefined) return; active.delete(id);
  light(key.note, id, false); synth?.noteOff(key.channel, key.note).catch(e => message(e.message));
  record({ bytes: [0x80 | key.channel, key.note, 0] });
}
function releaseKeys() { for (const id of active.keys()) release(id); }
const keys = { a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72 };
document.addEventListener('keydown', event => { if (event.target.matches('input,select,textarea') || event.ctrlKey || event.metaKey) return; const note = keys[event.key.toLowerCase()]; if (note !== undefined) { event.preventDefault(); press(event.code, note); } });
document.addEventListener('keyup', event => release(event.code)); window.addEventListener('blur', releaseKeys);

// Web MIDI input: every connected keyboard plays the synthesizer on its own channels, lights the keys and records.
async function connectMidi() {
  const status = $('midi-in'), button = $('midi-permission');
  if (!navigator.requestMIDIAccess) { status.textContent = 'WEB MIDI: NOT IN THIS BROWSER'; return; }
  let permission, access;
  function attach() {
    const inputs = [...access.inputs.values()];
    for (const input of inputs) input.onmidimessage = event => midiIn(event.data);
    status.textContent = inputs.length ? `WEB MIDI: ${inputs.map(input => input.name || 'Keyboard').join(', ').toUpperCase()}` : 'WEB MIDI: NO KEYBOARD';
  }
  async function request() {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'WEB MIDI: REQUESTING ACCESS';
    try {
      access = await navigator.requestMIDIAccess();
      access.onstatechange = attach; attach();
      button.hidden = true;
    } catch {
      status.textContent = permission?.state === 'denied' ? 'WEB MIDI: BLOCKED IN SITE SETTINGS' : 'WEB MIDI: ACCESS UNAVAILABLE';
      button.hidden = false;
    } finally { button.disabled = false; }
  }
  function updatePermission() {
    if (permission?.state === 'granted') { if (!access) request(); return; }
    if (access) {
      access.onstatechange = null;
      for (const input of access.inputs.values()) input.onmidimessage = null;
      access = undefined; releaseMidi();
    }
    status.textContent = permission?.state === 'denied' ? 'WEB MIDI: BLOCKED IN SITE SETTINGS' : 'WEB MIDI: PERMISSION NEEDED';
    button.hidden = false;
  }
  button.onclick = request;
  // Some browsers implement MIDI input without supporting its Permissions API descriptor.
  try { permission = await navigator.permissions.query({ name: 'midi', sysex: false }); } catch { /* Use the button. */ }
  if (permission) permission.onchange = updatePermission;
  updatePermission();
}
/** A message from a Web MIDI input (always complete, without running status). System messages (clock, active
 *  sensing, SysEx) are left out. */
function midiIn(data) {
  if (!synth || !data.length || data[0] < 0x80 || data[0] >= 0xf0) return;
  synth.sendMidi(data).catch(e => message(e.message));
  record({ bytes: [...data] });
  const kind = data[0] & 0xf0, source = `m${data[0] & 15}`;
  if (kind === 0x90 || kind === 0x80) light(data[1], source, kind === 0x90 && data[2] > 0);
}
function releaseMidi() { for (const [note, sources] of lit) for (const source of sources) if (source.startsWith('m')) light(note, source, false); }

// The recording: what the keys and Web MIDI keyboards played, as MIDI messages at seconds from its start, the piano's
// preset first. A pause of more than GAP seconds with no note or pedal held shrinks to GAP.
function record(entry) {
  const now = performance.now() / 1000;
  if (!take.length) {
    const { bank, program, channel } = selected();
    takeStart = takeLast = now;
    take.push({ time: 0, event: { type: 'preset', channel, bank, program } });
  } else if (!holding.size && now - takeLast > GAP) takeStart += now - takeLast - GAP;
  takeLast = now;
  take.push({ time: now - takeStart, ...entry });
  const b = entry.bytes;
  if (b) {
    const kind = b[0] & 0xf0, channel = b[0] & 15;
    if (kind === 0x90 && b[2] > 0) holding.add(`${channel}:${b[1]}`);
    else if (kind === 0x80 || kind === 0x90) holding.delete(`${channel}:${b[1]}`);
    else if (kind === 0xb0 && b[1] === 64) { if (b[2] >= 64) holding.add(`pedal${channel}`); else holding.delete(`pedal${channel}`); }
  }
  showTake();
}
function showTake() {
  const notes = take.filter(e => e.bytes && (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0).length;
  $('take-info').textContent = notes ? `Recorded: ${notes} note${notes === 1 ? '' : 's'}, ${clock(take.at(-1).time)}.` : 'Nothing recorded yet.';
  $('take-download').disabled = !notes; $('take-clear').disabled = !take.length;
}
$('take-clear').onclick = () => { take = []; holding.clear(); showTake(); message('The recording starts over with the next note.'); };
$('take-download').onclick = run(async () => {
  const entries = take.slice(), seconds = entries.at(-1).time + 3;
  $('take-download').disabled = true;
  try {
    // The messages go into the renderer's queue at once, in the order they were played.
    const wav = await renderWav('your-recording', sound(null), offline => {
      // A preset the rendering SoundFont lacks (one chosen on the other engine) is left out; the channel keeps its last.
      const has = event => offline.info.presets.some(p => p.bank === event.bank && p.program === event.program);
      for (const entry of entries) {
        if (entry.event) { if (has(entry.event)) offline.schedule([{ time: entry.time, ...entry.event }]); }
        else offline.sendMidi(entry.bytes, entry.time);
      }
      return seconds;
    }, progress, entries.length + 64);
    save(wav, `defuss-midi-synth-recording-${Date.now()}.wav`);
    message(`WAV downloaded: ${clock(seconds)}, 48 kHz, stereo, 16-bit.`);
  } finally { showTake(); }
});

$('file').onchange = run(async () => {
  const file = $('file').files[0]; if (!file) return;
  // A .br file is a Brotli-compressed one; the library unpacks it.
  $('file').value = '';
  const name = file.name.toLowerCase().replace(/\.br$/, ''), reading = file.arrayBuffer();
  let startedWithFont = false;
  let audio;
  if (name.endsWith('.sf2')) {
    audio = startAudio(async () => {
      startedWithFont = true;
      return { engine: 'soundfont', soundfont: await reading };
    });
  } else if (name.endsWith('.wopl')) {
    audio = startAudio(() => ({ engine: 'sb16-opl3' }));
  } else {
    return player.playFile(file.name, reading);
  }
  const [data] = await Promise.all([reading, audio]);
  if (name.endsWith('.sf2')) {
    message('Loading SoundFont…');
    const info = startedWithFont ? synth.info : await synth.useSoundFont(data); fontSource = data; customFont = true;
    listBanks(info); showEngine(info); player.engineShown(synth); await applyPreset(); message(`SoundFont loaded: ${info.presets.length} presets.`);
  } else if (name.endsWith('.wopl')) {
    message('Loading FM bank…');
    if (!FM_KINDS.includes(synth.info.kind)) await synth.useEngine('sb16-opl3');
    const info = await synth.loadFmBank(data); customBank = data;
    listBanks(info, Number($('bank').value), Number($('program').value)); showEngine(info); player.engineShown(synth);
    message('FM bank loaded from your WOPL file.');
  }
});
$('file').disabled = false;
function meterValue(db) {
  if (db === -Infinity) return '−∞';
  return db < -120 ? '< −120' : db.toFixed(1);
}
setInterval(async () => {
  if (!master) return;
  try {
    const { voices, queuedEvents, lateEvents } = synth ? await synth.status() : { voices: 0, queuedEvents: 0, lateEvents: 0 };
    $('queue').textContent = `${queuedEvents} EVENTS · ${voices} VOICES · ${lateEvents} LATE`;
    $('stats-activity').textContent = `${voices} voices`;
    const { baseLatency, outputLatency } = master.context;
    const hasBase = Number.isFinite(baseLatency), hasOutput = Number.isFinite(outputLatency);
    if (hasBase || hasOutput) {
      const ms = 1000 * ((hasBase ? baseLatency : 0) + (hasOutput ? outputLatency : 0));
      $('stats-delay').textContent = `Delay ≈ ${ms.toFixed(1)} ms`;
    } else $('stats-delay').textContent = 'Delay unavailable';
  }
  catch (error) { message(error.message); }
}, 500);
/** The scope: the waveform while keys sound (and the demo plays), a flat line while only the player plays. */
function draw() {
  if (!analyser) return;
  const canvas = $('scope'), ctx = canvas.getContext('2d'), keysSound = lit.size > 0 || performance.now() < scopeUntil;
  canvas.dataset.live = String(keysSound);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#0b3d1a'; ctx.beginPath(); ctx.moveTo(0,60); ctx.lineTo(520,60); ctx.stroke();
  if (keysSound) {
    analyser.getFloatTimeDomainData(waveform);
    ctx.strokeStyle = '#26ff6a'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < waveform.length; i++) { const x = i / (waveform.length - 1) * 520, y = 60 - waveform[i] * 180; if (!i) ctx.moveTo(x,y); else ctx.lineTo(x,y); }
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}
