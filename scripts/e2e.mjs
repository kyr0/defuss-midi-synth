import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { midiFixture, musFixture, rmiFixture, soundfont } from '../tests/fixtures.ts';
import assert from 'node:assert/strict';
import { compress, init as brotli } from 'defuss-brotli/compressor';
await brotli();
const server = await serve('docs');
// SwiftShader gives headless Chromium WebGL2, so the player's shader renders instead of its poster.
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const hub = []; page.on('request', request => { if (request.url().startsWith('https://huggingface.co/')) hub.push(request.url()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.url()}: HTTP ${response.status()}`); });
const url = `http://127.0.0.1:${server.address().port}`;
const text = id => page.locator(id).textContent();
const position = () => page.locator('#seek').inputValue().then(Number);
const title = value => page.waitForFunction(value => document.querySelector('#track-title').textContent === value, value, { timeout: 20000 });
const sounding = () => page.waitForFunction(() => Number(document.querySelector('#page-rain').dataset.level) > 0.01, null, { timeout: 10000 });
const pressed = (selector, value) => page.waitForFunction(([selector, value]) => document.querySelector(selector).getAttribute('aria-pressed') === value, [selector, value]);
const album = id => page.click(`label.album:has(input[value="${id}"])`);
const setRange = (id, value, event) => page.locator(id).evaluate((el, [value, event]) => { el.value = value; el.dispatchEvent(new Event(event)); }, [value, event]);
await mkdir('output', { recursive: true });
// A Web MIDI keyboard: CI has no MIDI device, so the page gets a MIDIAccess with one input whose messages the test
// sends (window.__midi). The page's handling of the messages is the real one.
await page.addInitScript(() => {
  let handler = null;
  const input = { id: 'test', name: 'Test Keys', type: 'input', state: 'connected' };
  Object.defineProperty(input, 'onmidimessage', { get: () => handler, set: f => { handler = f; } });
  window.__midi = bytes => handler?.({ data: new Uint8Array(bytes) });
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map([['test', input]]), outputs: new Map(), onstatechange: null }) });
});
const wavStats = async path => {
  const bytes = await readFile(path), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let peak = 0;
  for (let at = 44; at + 1 < bytes.length; at += 2) peak = Math.max(peak, Math.abs(view.getInt16(at, true)));
  return { riff: bytes.subarray(0, 4).toString(), frames: (bytes.length - 44) / 4, peak };
};
try {
  await page.goto(url);
  // The player lists docs/music/index.json before audio starts.
  await page.waitForFunction(() => document.querySelectorAll('#albums input').length === 33);
  assert.equal(await text('#library'), '33 ALBUMS · 943 TRACKS');
  // The page has no power state text.
  assert.equal(await page.locator('#state').count(), 0);
  // The page opens on Warcraft II, with its bank alone in the list before audio starts; the test plays Doom.
  assert.equal(await text('#album-title'), 'Warcraft II: Tides of Darkness');
  assert.equal(await page.locator('#tracks li').count(), 18);
  assert.match(await page.locator('#fm-banks').textContent(), /^18 · .*\(Warcraft II: Tides of Darkness\)$/);
  // A sleeve's click starts audio on the FM engine with Doom's bank and plays the album's first track.
  await album('doom-1993'); assert.equal(await text('#album-title'), 'Doom');
  // One list holds all of an album's editions (GM 23, Adlib 1, Unreleased 31), each row naming its own.
  assert.equal(await page.locator('#tracks li').count(), 55); assert.equal(await page.locator('#edition').count(), 0);
  assert.equal(await page.locator('#tracks small', { hasText: /^Adlib$/ }).count(), 1);
  assert.equal(await page.locator('#tracks small', { hasText: /^Unreleased$/ }).count(), 31);
  assert.deepEqual((await page.locator('#albums label strong').allTextContents()).slice(0, 3), ['Warcraft II: Tides of Darkness', 'Age of Empires II: The Age of Kings', 'Age of Empires II: The Conquerors']);
  // The DOS page: the Matrix rain behind it and the album's cover on a CRT tube, both drawn by defuss-shadcn's shaders; the
  // sleeves carry their years; the footer has no API notes.
  await page.waitForSelector('#page-rain[data-ready]'); await page.waitForSelector('#cover-art[data-ready]');
  assert.equal(await page.getAttribute('#page-rain', 'data-effect'), 'matrix');
  assert.equal(await page.locator('#albums .album-year').first().textContent(), '1995');
  assert.equal(await page.locator('footer a', { hasText: 'API notes' }).count(), 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('IBM VGA 8x14')), true);
  // Every sleeve shows its cover on the release cover's CRT tube.
  assert.equal(await page.locator('#albums .shader[data-effect="crt"] img').count(), 33);
  // The sleeve's track plays and Bergium draws; the sound reaches the analyser and the rain.
  await page.waitForSelector('#led.on');
  await title('Intro · Doom'); await sounding();
  // Loud music makes the rain fall faster than its quiet 0.6.
  await page.waitForFunction(() => Number(document.querySelector('#page-rain').dataset.speed) > 0.62);
  assert.equal(await page.getAttribute('#toggle', 'aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  // The FM engine shows its banks as a list, the game's chosen, and no bank text.
  await page.waitForFunction(() => document.querySelectorAll('#fm-banks option').length === 79);
  assert.equal(await page.locator('#fm-banks').inputValue(), '16');
  assert.equal(await page.locator('#fm-banks option:checked').textContent(), '16 · DMX (Bobby Prince v1) (Doom)');
  assert.equal(await page.locator('#soundfont-name').isHidden(), true);
  assert.equal(await text('#midi-in'), 'WEB MIDI: TEST KEYS');
  // The piano's scope stays flat while only the player sounds.
  await page.waitForFunction(() => document.querySelector('#scope').dataset.live === 'false');
  await pressed('#visualizer .toggle[value=milkdrop]', 'true');
  await page.waitForFunction(() => document.querySelector('#visual-name').textContent === 'Martin - charisma', null, { timeout: 20000 });
  await page.waitForFunction(() => Number(document.querySelector('#visual').dataset.frames) >= 30, null, { timeout: 20000 });
  // Bergium draws at a quarter of the resolution; its frames reach the CRT shader as hard-edged blocks.
  await page.waitForSelector('#visual-crt[data-ready]');
  assert.deepEqual(await page.evaluate(() => { const v = document.querySelector('#visual'), b = document.querySelector('#visual-blocks'); return [Math.abs(v.width - Math.round(v.clientWidth / 4)) <= 1, b.width > v.width]; }), [true, true]);
  // At 2x the 6.7 s intro ends after about 3.4 s and the next track plays by itself.
  await page.selectOption('#speed', '2');
  await title("At Doom's Gate (E1M1) · Doom");
  assert.equal(await page.locator('#tracks input:checked').inputValue(), '1');
  const fast = await position(); await page.waitForTimeout(1500); const moved = await position() - fast;
  assert.ok(moved > 2.2 && moved < 3.8, `2x moved ${moved} s in 1.5 s`);
  await page.selectOption('#speed', '1');
  const skipFrom = await position(); await page.click('#forward');
  await page.waitForFunction(from => Number(document.querySelector('#seek').value) >= from + 9, skipFrom);
  const backFrom = await position(); await page.click('#back');
  await page.waitForFunction(from => Number(document.querySelector('#seek').value) <= from - 8, backFrom);
  await setRange('#seek', '60', 'change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#seek').value) - 60.5) < 1.5);
  // The bar keeps moving while the slider has the focus, and its filled part follows the position.
  await page.locator('#seek').focus(); const focused = await position();
  await page.waitForFunction(from => Number(document.querySelector('#seek').value) >= from + 1, focused);
  const fill = await page.locator('#seek').evaluate(el => [parseFloat(el.style.getPropertyValue('--slider-value')), Number(el.value) / Number(el.max) * 100]);
  assert.ok(Math.abs(fill[0] - fill[1]) < 2, `fill ${fill[0]}% at ${fill[1]}% of the track`);
  await page.click('#toggle'); await pressed('#toggle', 'false');
  await page.waitForTimeout(400); const held = await position(); await page.waitForTimeout(600);
  assert.equal(await position(), held, 'a paused track holds its position');
  await page.click('#toggle'); await pressed('#toggle', 'true');
  await page.click('#next'); await title("The Imp's Song (E1M2) · Doom");
  await page.click('#previous'); await title("At Doom's Gate (E1M1) · Doom");
  // The volume, the mute button and the instrument's output slider move together.
  await page.click('#mute'); assert.equal(await page.getAttribute('#mute', 'aria-pressed'), 'true'); assert.equal(await text('#gain-value'), '0%');
  await page.click('#mute'); assert.equal(await text('#gain-value'), '60%');
  await setRange('#volume', '0.4', 'input'); assert.equal(await text('#gain-value'), '40%');
  await page.locator('#gain').focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#volume').inputValue(), '0.4');
  await setRange('#volume', '0.6', 'input');
  // Albums; the Horst-Wessel-Lied of Wolfenstein 3D's soundtrack is left out of the index.
  await album('wolfenstein-3d-1992');
  assert.equal(await text('#album-title'), 'Wolfenstein 3D'); assert.equal(await page.locator('#tracks li').count(), 26);
  assert.equal((await page.locator('#tracks').textContent()).includes('Horst'), false);
  assert.equal(await page.getAttribute('#player-cover', 'src'), `${url}/music/covers/wolfenstein-3d-1992.jpg`);
  // Each game plays with its own bank.
  await page.click('#tracks li:nth-child(2) label'); await title('Get Them Before They Get You (E1M1) · Wolfenstein 3D');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 74');
  assert.equal(await page.locator('#fm-banks').inputValue(), '74');
  await sounding();
  // A bank picked from the list plays at once and holds for the album's next track; another album takes its own.
  await page.selectOption('#fm-banks', '58');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 58');
  await page.click('#tracks li:nth-child(3) label'); await title('Searching For the Enemy (E1M2) · Wolfenstein 3D');
  assert.equal(await page.locator('#fm-banks').inputValue(), '58'); assert.equal(await text('#engine-label'), 'LIBADLMIDI / NUKED OPL3 · BANK 58');
  assert.equal(await page.locator('#bank option').count(), 2); assert.equal(await page.locator('#program option').count(), 128);
  // Raptor's files state Doom's 140 Hz clock; the index's tempo plays them at Raptor's 70 Hz, twice as long.
  await album('raptor-call-of-the-shadows-1994'); await page.click('#tracks li:nth-child(5) label'); await title('Wave Music 1 · Raptor: Call of the Shadows');
  assert.equal(await text('#duration'), '0:33');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 64');
  const raptor = await position(); await page.waitForTimeout(1500); const raptorMoved = await position() - raptor;
  assert.ok(raptorMoved > 1.1 && raptorMoved < 1.9, `at tempo 0.5 the position moved ${raptorMoved} s in 1.5 s`);
  await album('doom-1993'); await page.click('#tracks li:nth-child(2) label'); await title("At Doom's Gate (E1M1) · Doom");
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  await page.selectOption('#bank', '128'); assert.deepEqual(await page.locator('#program option').allTextContents(), ['001 · Percussion']);
  await page.selectOption('#bank', '0');
  // The SoundFont engine loads the OPL-3 FM 128M SoundFont, Brotli-compressed, and the song plays on; then FM again.
  // The progress bar shows its download and then its decompression, and leaves.
  await page.evaluate(() => {
    window.__labels = new Set();
    new MutationObserver(() => window.__labels.add(document.querySelector('#load-label').textContent))
      .observe(document.querySelector('#load-label'), { childList: true, characterData: true, subtree: true });
  });
  // The SoundFont comes from huggingface.co over the real network, capped at 50 MB/s, so the bar shows both phases.
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 50 * 1024 * 1024, uploadThroughput: -1 });
  await page.click('#engine .toggle[value=soundfont]');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'TINYSOUNDFONT / OPL-3 FM 128M', null, { timeout: 120000 });
  assert.equal(await text('#message'), 'SoundBlaster 16: 129 presets.'); assert.equal(await text('#soundfont-name'), 'OPL-3 FM 128M SoundFont (104 MB)');
  assert.equal(await page.locator('#fm-banks').isHidden(), true);
  await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await network.detach();
  assert.deepEqual(await page.evaluate(() => [...window.__labels]), ['Downloading OPL-3_FM_128M.sf2.br', 'Decompressing OPL-3_FM_128M.sf2.br']);
  assert.deepEqual(hub, ['https://huggingface.co/kyr0/midi-synth/resolve/main/soundfonts/OPL-3_FM_128M/OPL-3_FM_128M.sf2.br'], 'the SoundFont comes from the Hub');
  await page.waitForSelector('#load-progress', { state: 'hidden' });
  await sounding();
  await page.click('#engine .toggle[value=fm]');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  assert.match(await text('#message'), /^Gravis Ultrasound: .*36 voices\.$/);
  // A track's WAV button renders it on the engine and bank shown without choosing it.
  const trackDownload = page.waitForEvent('download', { timeout: 60000 }); await page.click('#tracks li:nth-child(1) .track-download');
  const track = await trackDownload; assert.equal(track.suggestedFilename(), 'Doom - 1 Intro.wav');
  await track.saveAs('output/browser-track.wav');
  const trackWav = await wavStats('output/browser-track.wav');
  assert.equal(trackWav.riff, 'RIFF'); assert.ok(trackWav.frames >= 8.5 * 48000 && trackWav.frames <= 9 * 48000, `${trackWav.frames} frames`); assert.ok(trackWav.peak > 300, `peak ${trackWav.peak}`);
  assert.equal(await page.locator('#tracks input:checked').inputValue(), '1');
  // Bergium draws, steps to the next preset of the page's list, and stops.
  const frames = Number(await page.getAttribute('#visual', 'data-frames') ?? 0);
  await page.waitForFunction(frames => Number(document.querySelector('#visual').dataset.frames) >= frames + 30, frames, { timeout: 20000 });
  const shown = await text('#visual-name'); await page.click('#visual-next');
  await page.waitForFunction(shown => document.querySelector('#visual-name').textContent !== shown, shown);
  assert.deepEqual(await page.locator('#visualizer .toggle').allTextContents(), ['No Visuals', 'Bergium']);
  assert.deepEqual(await page.locator('#engine .toggle').allTextContents(), ['Gravis Ultrasound', 'SoundBlaster 16']);
  await page.screenshot({ path: 'output/visualizer.png', clip: await page.locator('#visual-panel').boundingBox() });
  await page.click('#visualizer .toggle[value=off]'); assert.equal(await page.locator('#visual-panel').isHidden(), true);
  // The instrument below the player, on the FM engine.
  assert.equal(await text('#demo'), '▶ Play demo sequence'); assert.equal(await page.locator('#export').count(), 0);
  assert.equal(await text('#take-info'), 'Nothing recorded yet.'); assert.equal(await page.locator('#take-download').isDisabled(), true);
  await page.click('#demo'); await page.waitForTimeout(300);
  await page.click('#stop'); const patch = await text('#patch-name'); await page.selectOption('#program', '80');
  await page.waitForFunction(patch => document.querySelector('#patch-name').textContent !== patch, patch);
  await page.keyboard.down('a'); await page.waitForTimeout(100); await page.keyboard.up('a');
  await page.selectOption('#bank', '128');
  await page.waitForFunction(() => document.querySelector('#patch-name').textContent === 'Percussion');
  assert.match(await text('#bank-label'), /channel 10/);
  await page.click('[data-note="61"]');
  await page.selectOption('#bank', '0'); await page.click('[data-note="60"]');
  await page.locator('#velocity').focus(); await page.keyboard.press('ArrowLeft');
  // A Web MIDI keyboard plays, lights the key it plays and moves the scope, and the recording takes it.
  await page.evaluate(() => window.__midi([0x90, 64, 100]));
  await page.waitForFunction(() => document.querySelector('[data-note="64"]').classList.contains('active') && document.querySelector('#scope').dataset.live === 'true');
  await page.waitForTimeout(200); await page.evaluate(() => window.__midi([0x80, 64, 0]));
  await page.waitForFunction(() => !document.querySelector('[data-note="64"]').classList.contains('active'));
  assert.match(await text('#take-info'), /^Recorded: 4 notes, 0:0\d\.$/);
  // The user's files play in the player.
  for (const [name, bytes] of [['original.mid', midiFixture()], ['original.rmi', rmiFixture(midiFixture())], ['original.mus', musFixture()]]) {
    await page.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await title(name); assert.equal(await page.locator('#tracks input:checked').count(), 0);
    await page.click('#toggle'); await pressed('#toggle', 'false'); await page.click('#toggle'); await pressed('#toggle', 'true'); await page.click('#stop');
  }
  // A WOPL file replaces the FM bank (switching to FM), and the game's bank comes back; an FM export renders it.
  // Banks also open Brotli-compressed, as the page's own ship.
  await page.setInputFiles('#file', { name: 'test.wopl.br', mimeType: 'application/octet-stream', buffer: Buffer.from(compress(await readFile('tests/test.wopl'), { quality: 5 })) });
  await page.waitForFunction(() => document.querySelector('#message').textContent === 'FM bank loaded from your WOPL file.');
  assert.equal(await text('#engine-label'), 'LIBADLMIDI / NUKED OPL3 · WOPL FILE');
  await pressed('#engine .toggle[value=fm]', 'true');
  assert.equal(await page.locator('#fm-banks').inputValue(), '-1'); assert.equal(await page.locator('#fm-banks option:checked').textContent(), 'Your WOPL file');
  const fmDownload = page.waitForEvent('download'); await page.click('#take-download');
  await (await fmDownload).saveAs('output/browser-fm-recording.wav');
  const fmWav = await wavStats('output/browser-fm-recording.wav'); assert.ok(fmWav.riff === 'RIFF' && fmWav.peak > 300, `recording peak ${fmWav.peak}`);
  await page.selectOption('#fm-banks', '16'); await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  assert.equal(await page.locator('#fm-banks option[value="-1"]').count(), 0);
  await page.setInputFiles('#file', { name: 'sines.sf2.br', mimeType: 'application/octet-stream', buffer: Buffer.from(compress(soundfont(), { quality: 5 })) });
  await page.waitForFunction(() => document.querySelector('#message').textContent === 'SoundFont loaded: 3 presets.');
  await pressed('#engine .toggle[value=soundfont]', 'true');
  assert.equal(await text('#engine-label'), 'TINYSOUNDFONT / YOUR SOUNDFONT');
  assert.equal(await page.locator('#program option').count(), 2);
  await page.click('[data-note="62"]'); await page.click('#panic');
  const downloadEvent = page.waitForEvent('download'); await page.click('#take-download');
  const download = await downloadEvent; await download.saveAs('output/browser-recording.wav');
  assert.ok((await wavStats('output/browser-recording.wav')).peak > 300, 'the recording sounds on your SoundFont');
  await page.click('#take-clear'); assert.equal(await text('#take-info'), 'Nothing recorded yet.'); assert.equal(await page.locator('#take-download').isDisabled(), true);
  await page.setInputFiles('#file', { name: 'invalid.mid', mimeType: 'audio/midi', buffer: Buffer.from([1, 2, 3]) });
  await page.waitForFunction(() => /invalid|unsupported|format|header/i.test(document.querySelector('#message').textContent));
  assert.equal(await text('#track-title'), 'Choose a track'); assert.equal(await page.locator('#seek').isDisabled(), true);
  await page.setInputFiles('#file', { name: 'broken.sf2', mimeType: 'application/octet-stream', buffer: Buffer.from(new Uint8Array(64)) });
  await page.waitForFunction(() => /Invalid SoundFont/.test(document.querySelector('#message').textContent));
  assert.equal(await page.locator('#program option').count(), 2, 'a rejected SoundFont keeps the loaded one');
  // Public API test using a real AudioContext, real WASM, real worklet and analyzer.
  const evidence = await page.evaluate(async ({ midiBytes, sineFont }) => {
    const { MidiSynth } = await import('./synth/index.js');
    const context = new AudioContext({ sampleRate: 48000 }); await context.resume();
    const synth = await MidiSynth.create({ context, baseUrl: new URL('./synth/', location.href), queueCapacity: 64 });
    const info = synth.info;
    const analyzer = context.createAnalyser(); analyzer.fftSize = 2048; synth.output.connect(analyzer);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rms = () => { const x = new Float32Array(2048); analyzer.getFloatTimeDomainData(x); return Math.sqrt(x.reduce((sum, v) => sum + v*v, 0) / x.length); };
    const start = context.currentTime + 0.15;
    await synth.schedule([{ time:start, type:'programChange',channel:0,program:0 }, {time:start,type:'noteOn',channel:0,note:60,velocity:127}]);
    await wait(350); const sounding = rms(); const voices = (await synth.status()).voices;
    // source carries the signal before the output gain: it sounds while the gain is 0.
    const before = context.createAnalyser(); before.fftSize = 2048; synth.source.connect(before);
    synth.setGain(0); await wait(150);
    const x = new Float32Array(2048); before.getFloatTimeDomainData(x); const sourceRms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const silenced = rms(); synth.setGain(1); synth.source.disconnect(before);
    await synth.noteOff(0,60); await synth.panic(); await synth.clearScheduled();
    await synth.controlChange(0,7,110); await synth.pitchBend(0,8192);
    await synth.send({ type:'channelPressure',channel:0,value:20 });
    await synth.send({ type:'polyPressure',channel:0,note:60,value:20 });
    await synth.selectPreset(3, 128, 25); await synth.sendMidi([0x93, 49, 127]);
    await wait(60); const drums = rms(); await synth.reset();
    let badPreset = false; try { await synth.selectPreset(0, 5, 0); } catch (e) { badPreset = e instanceof RangeError; }
    const future = context.currentTime + 10;
    await synth.clearScheduled();
    await synth.schedule(Array.from({length:64}, (_,i)=>({time:future+i,type:'noteOff',channel:0,note:60})));
    let overflow = false; try { await synth.noteOn(0,60); } catch (e) { overflow = /queue full/.test(e.message); }
    await synth.clearScheduled();
    const meta = await synth.loadMidi(new Uint8Array(midiBytes)); await synth.play(); await wait(100); await synth.pause();
    const paused = (await synth.status()).position; await wait(100); const pausedAgain = (await synth.status()).position;
    await synth.seek(0); await synth.play(); await wait(1500); const ended = (await synth.status()).ended;
    await synth.stop();
    const sines = await synth.loadSoundFont(new Uint8Array(sineFont));
    let badFont = false; try { await synth.loadSoundFont(new Uint8Array(64)); } catch (e) { badFont = /Invalid SoundFont/.test(e.message); }
    const keptFont = synth.info.presets.length;
    // The FM engine through the public API: loaded on demand, its banks, its sound, and the checks of its arguments.
    const fm = await synth.useEngine('fm'); await synth.setFmBank(16);
    await synth.noteOn(0, 60, 127); await wait(250); const fmSounding = rms(); await synth.panic();
    let fmBadBank = false; try { await synth.setFmBank(79); } catch (e) { fmBadBank = e instanceof RangeError; }
    let fmDrumChannel = false; try { await synth.selectPreset(0, 128, 0); } catch (e) { fmDrumChannel = e instanceof RangeError; }
    await synth.setPlaybackRate(1.5); let badRate = false; try { await synth.setPlaybackRate(5); } catch (e) { badRate = e instanceof RangeError; }
    const back = await synth.useEngine('soundfont');
    const engines = { kind: fm.kind, engines: fm.engines, banks: fm.fm.banks.length, bank: synth.info.fm.bank, voices: fm.maxVoices, fmSounding, fmBadBank, fmDrumChannel, badRate, back: back.kind, backPresets: back.presets.length };
    synth.setGain(0.3); await synth.resume();
    const stats = await synth.status(); await Promise.all([synth.dispose(), synth.dispose()]);
    const callerContextPreserved = context.state !== 'closed';
    let disposedRejected = false; try { await synth.noteOn(0,60); } catch { disposedRejected = true; }
    const second = await MidiSynth.create({ context, baseUrl:new URL('./synth/',location.href) }); await second.dispose();
    await context.close();
    const owned = await MidiSynth.create({ baseUrl:new URL('./synth/',location.href) }); await owned.resume(); await owned.dispose();
    return { info: { engine: info.engine, presets: info.presets.length, first: info.presets[0], maxVoices: info.maxVoices }, sounding, voices, drums, badPreset, overflow,
      duration:meta.duration, paused, pausedAgain, ended, sinePresets: sines.presets.length, badFont, keptFont, stats, callerContextPreserved, disposedRejected, ownedContextClosed:owned.context.state === 'closed', engines, sourceRms, silenced };
  }, { midiBytes: [...midiFixture()], sineFont: [...soundfont()] });
  assert.equal(evidence.info.engine, 'TinySoundFont 0.9'); assert.equal(evidence.info.presets, 136);
  assert.ok(evidence.sounding > 0.001, 'Actual audio output must be nonzero'); assert.ok(evidence.voices > 0);
  assert.ok(evidence.drums > 0.001, 'A drum kit on channel 4 must sound');
  assert.equal(evidence.badPreset, true); assert.equal(evidence.overflow, true); assert.equal(evidence.duration, 0.5);
  assert.equal(evidence.paused, evidence.pausedAgain); assert.equal(evidence.ended, true);
  assert.equal(evidence.sinePresets, 3); assert.equal(evidence.badFont, true); assert.equal(evidence.keptFont, 3);
  assert.deepEqual(evidence.engines, { kind: 'fm', engines: ['soundfont', 'fm'], banks: 79, bank: 16, voices: 36, fmSounding: evidence.engines.fmSounding,
    fmBadBank: true, fmDrumChannel: true, badRate: true, back: 'soundfont', backPresets: 3 });
  assert.ok(evidence.engines.fmSounding > 0.001, 'The FM engine must sound');
  assert.ok(evidence.sourceRms > 0.001 && evidence.silenced < evidence.sourceRms / 10, `source ${evidence.sourceRms} sounds while output at gain 0 gives ${evidence.silenced}`);
  assert.equal(evidence.callerContextPreserved, true); assert.equal(evidence.disposedRejected, true); assert.equal(evidence.ownedContextClosed,true);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path:'output/demo-desktop.png', fullPage:true });
  // The phone layout section by section: Chromium fails to capture the 9,194 px phone page whole while its WebGL
  // surfaces (the rain, the cover's shader, Bergium) and the sleeves' filter are on it (tmp/probe-phone-capture.mjs).
  await page.setViewportSize({width:390,height:844});
  for (const [file, id] of [['demo-mobile.png', 'player'], ['demo-mobile-crates.png', 'crates'], ['demo-mobile-synth.png', 'synth']]) {
    await page.locator(`#${id}`).evaluate(el => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300);
    await page.screenshot({ path: `output/${file}` });
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'Mobile must not overflow horizontally');
  const result = { passed: true, browser: await browser.version(), ...evidence, errors };
  await writeFile('output/e2e.json', JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
