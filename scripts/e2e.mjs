import { cards, variantSources } from '../docs/sound-cards.js';
import { renderWav } from '../docs/render.js';
import { checkFx } from './fx-e2e.mjs';
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { midiFixture, musFixture, rmiFixture, soundfont } from '../tests/fixtures.ts';
import { gusFixture } from '../tests/vintage-fixtures.ts';
import assert from 'node:assert/strict';
import { compress, init as brotli } from 'defuss-brotli/compressor';
await brotli();
const server = await serve('docs');
// SwiftShader gives headless Chromium WebGL2, so the player's shader renders instead of its poster.
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// One context, so a second page shares the first one's origin storage (OPFS).
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('requestfailed', request => {
  // Closing the VGZ transport cancels the browser's range read of its in-memory PCM blob.
  if (request.url().startsWith('blob:') && request.failure()?.errorText === 'net::ERR_ABORTED') return;
  errors.push(`${request.url()}: ${request.failure()?.errorText}`);
});
const isCardAsset = url => /\.(?:dspack|ecw|sf2|wasm)$/i.test(new URL(url).pathname);
const cardRequests = [];
page.on('request', request => { if (isCardAsset(request.url())) cardRequests.push(new URL(request.url()).pathname); });
const fmModules = []; page.on('request', request => { if (request.url().endsWith('/fm-synth.wasm')) fmModules.push(request.url()); });
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
  await page.waitForFunction(() => document.querySelector('#game-count')?.textContent === '311 albums');
  assert.equal(await page.locator('#albums .virtual-list-cell').first().locator(':scope > :first-child').getAttribute('id'), 'your-midi');
  assert.equal(await page.locator('#your-midi button').isEnabled(), true);
  const crateTiles = await page.locator('#your-midi, #albums .album').evaluateAll(tiles =>
    tiles.slice(0, 3).map(tile => tile.getBoundingClientRect().toJSON()));
  assert.ok(crateTiles.every(tile => tile.y === crateTiles[0].y), 'The upload and the first two albums share the first desktop row');
  assert.ok(crateTiles[0].x < crateTiles[1].x && crateTiles[1].x < crateTiles[2].x);
  assert.equal(await text('#stats-rms'), '—');
  assert.deepEqual(cardRequests, [], 'the gallery opens without downloading any cores or banks');
  assert.equal(await text('#library'), '311 ALBUMS · 7491 TRACKS');
  // The page has no power state text.
  assert.equal(await page.locator('#state').count(), 0);
  // The gallery selects the default waveset before audio starts.
  assert.equal(await text('#album-title'), 'Warcraft II: Tides of Darkness');
  assert.equal(await page.locator('#tracks li').count(), 18);
  await pressed('#cover-sb128', 'true');
  await pressed('button[value="sb128_EAPCI2M.ECW"]', 'true');
  assert.equal(await page.locator('#fm-banks').isHidden(), true);
  assert.deepEqual((await page.locator('#albums label strong').allTextContents()).slice(0, 3), ['Warcraft II: Tides of Darkness', 'Age of Empires II: The Age of Kings', 'Age of Empires II: The Conquerors']);
  assert.equal(await page.locator('#albums .album-year').first().textContent(), '1995');
  // A sleeve's click loads only the PCI core and its 2 MB waveset.
  await album('doom-1993'); assert.equal(await text('#album-title'), 'Doom');
  // One list holds all of an album's editions (GM 23, Adlib 1, Unreleased 31), each row naming its own.
  assert.equal(await page.locator('#tracks li').count(), 55); assert.equal(await page.locator('#edition').count(), 0);
  assert.equal(await page.locator('#tracks small', { hasText: /^Adlib$/ }).count(), 1);
  assert.equal(await page.locator('#tracks small', { hasText: /^Unreleased$/ }).count(), 31);
  // The DOS page: the Matrix rain behind it and the album's cover on a CRT tube, both drawn by defuss-shadcn's shaders; the
  // sleeves carry their years; the footer has no API notes.
  await page.waitForSelector('#page-rain[data-ready]'); await page.waitForSelector('#cover-art[data-ready]');
  assert.equal(await page.getAttribute('#page-rain', 'data-effect'), 'matrix');
  assert.equal(await page.locator('footer a', { hasText: 'API notes' }).count(), 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('IBM VGA 8x14')), true);
  // Every sleeve shows its cover on the release cover's CRT tube.
  assert.ok(await page.locator('#albums .shader[data-effect="crt"] img').count() < 35);
  // The sleeve's track plays and Bergium draws; the sound reaches the analyser and the rain.
  await page.waitForSelector('#led.on');
  await title('Intro · Doom'); await sounding();
  // Loud music makes the rain fall faster than its quiet 0.6.
  await page.waitForFunction(() => Number(document.querySelector('#page-rain').dataset.speed) > 0.62);
  assert.equal(await page.getAttribute('#toggle', 'aria-pressed'), 'true');
  assert.equal(await text('#engine-label'), 'SOUND BLASTER PCI 128');
  const pciAssets = ['/soundcards/sb128_EAPCI2M.ECW', '/synth/assets/profiles/sb-pci128.wasm'];
  assert.deepEqual([...cardRequests].sort(), pciAssets);
  await page.click('#cover-sb16');
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  // The FM engine shows its banks as a list, the game's chosen, and no bank text.
  await page.waitForFunction(() => document.querySelectorAll('#fm-banks option').length === 79);
  assert.equal(await page.locator('#fm-banks').inputValue(), '16');
  assert.equal(await page.locator('#fm-banks option:checked').textContent(), '16 · DMX (Bobby Prince v1) (Doom)');
  assert.equal(await page.locator('#soundfont-name').isHidden(), true);
  await page.getByRole('button', { name: 'Allow MIDI access' }).click();
  assert.equal(await text('#midi-in'), 'WEB MIDI: TEST KEYS');
  assert.equal(await page.locator('#midi-permission').isHidden(), true);
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
  const overlay = page.locator('#visual-panel');
  assert.equal(await overlay.evaluate(el => getComputedStyle(el).opacity), '0');
  await page.click('#toggle'); await pressed('#toggle', 'true');
  await page.waitForTimeout(1300);
  assert.equal(await overlay.evaluate(el => el.inert && getComputedStyle(el).opacity === '0'), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#visual-panel')).opacity === '1');
  assert.equal(await overlay.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
  assert.equal(await page.locator('#visual-crt').evaluate(el => getComputedStyle(el).opacity), '1');
  await page.click('#stop'); await pressed('#toggle', 'false');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#visual-panel')).opacity === '0');
  assert.equal(await page.locator('#cover-art').isVisible(), true);
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
  await album('raptor-call-of-the-shadows-1994');
  for (const edition of ['MUS', 'MDS']) {
    const cue = page.locator('#tracks li').filter({ has: page.getByText('Wave Music 1', { exact: true }) })
      .filter({ has: page.getByText(edition, { exact: true }) });
    const loaded = page.waitForResponse(response => response.url().endsWith(`__RAP1_${edition}.mid`) && response.ok());
    await cue.locator('label').click();
    await loaded;
    await title('Wave Music 1 · Raptor: Call of the Shadows');
    assert.equal(await text('#duration'), '1:34');
    await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 64');
    await sounding();
  }
  await album('doom-1993'); await page.click('#tracks li:nth-child(2) label'); await title("At Doom's Gate (E1M1) · Doom");
  await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  await page.selectOption('#bank', '128'); assert.deepEqual(await page.locator('#program option').allTextContents(), ['001 · Percussion']);
  await page.selectOption('#bank', '0');
  const label = value => page.waitForFunction(value => document.querySelector('#engine-label').textContent === value, value);
  const variant = file => `#sound-cards .toggle[value="${file}"]`;
  assert.deepEqual(await page.locator('.card-cover strong').allTextContents(),
    ['SoundBlaster 128', 'SoundBlaster 16', 'SoundBlaster AWE 64', 'SoundBlaster AWE 32', 'Gravis Ultrasound']);
  assert.deepEqual(await page.locator('.card-cover .album-year').allTextContents(), ['1998', '1992', '1996', '1994', '1992']);
  assert.deepEqual(await page.locator('.sound-card').evaluateAll(tiles => tiles.map(t => t.querySelectorAll('.toggle').length)), [3, 2, 0, 0, 0]);
  assert.deepEqual([...cardRequests].sort(), [...pciAssets, '/synth/assets/fm-synth.wasm'].sort());
  assert.deepEqual(await page.getByRole('group', { name: 'SoundBlaster 128 variants' }).getByRole('button').allTextContents(),
    ['2 MB ECW', '4 MB ECW', '8 MB ECW']);
  for (const id of ['sb16', 'sb128']) {
    const cover = page.locator(`#cover-${id}`);
    await cover.hover();
    const contrast = await cover.evaluate(button => {
      const luminance = color => {
        const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) / 255)
          .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const ink = luminance(getComputedStyle(button.querySelector('strong')).color);
      let bg = getComputedStyle(button).backgroundColor;
      if (bg === 'rgba(0, 0, 0, 0)') bg = getComputedStyle(button.closest('.sound-cards')).backgroundColor;
      const paper = luminance(bg);
      return (Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05);
    });
    assert.ok(contrast >= 4.5, `hovered ${id} caption contrast: ${contrast}`);
  }
  // Inspect the live Worklet's output gain without replacing audio nodes or the synth.
  const cdp = await context.newCDPSession(page);
  const { result: prototype } = await cdp.send('Runtime.evaluate', { awaitPromise: true,
    expression: "import(new URL('./synth/index.js', location.href)).then(module => module.MidiSynth.prototype)" });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: prototype.objectId });
  await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId,
    functionDeclaration: 'function () { window.__cardOutput = this[0].output.gain; }' });
  await cdp.detach();
  const { baseTrimDb } = JSON.parse(await readFile('docs/card-loudness.json'));
  const { albums: catalog } = JSON.parse(await readFile('docs/music/index.json'));
  const doomTracks = catalog.find(a => a.id === 'doom-1993').editions[0].tracks;
  const checkGain = key => {
    const correction = key === undefined ? 0 : baseTrimDb[key];
    return page.waitForFunction(expected => Math.abs(window.__cardOutput.value - expected) < .0001, 10 ** (correction / 20), { timeout: 3000 });
  };
  await page.evaluate(() => {
    window.__labels = [];
    new MutationObserver(() => {
      if (!document.querySelector('#load-progress').hidden) window.__labels.push(document.querySelector('#load-label').textContent);
    }).observe(document.querySelector('#load-label'), { childList: true, subtree: true });
  });
  await page.click('#cover-sb128'); await label('SOUND BLASTER PCI 128'); await sounding();
  await pressed(variant('sb128_EAPCI2M.ECW'), 'true'); await checkGain('sb128_EAPCI2M.ECW');
  assert.ok(!cardRequests.some(path => path.endsWith('pci128.sf2')));
  await page.getByRole('button', { name: '4 MB ECW', exact: true }).click(); await label('SOUND BLASTER PCI 128');
  await pressed(variant('sb128_EAPCI4M.ECW'), 'true'); await checkGain('sb128_EAPCI4M.ECW');
  await page.waitForFunction(() => Number.isFinite(parseFloat(document.querySelector('#stats-lufs').textContent)) &&
    Number.isFinite(parseFloat(document.querySelector('#stats-rms').textContent)));
  assert.doesNotMatch(await text('.player-stats'), /stereo|mono|channels|events|late/i);
  assert.match(await text('#stats-rate'), /kHz \(.+ samples\/s\)/);
  assert.match(await text('#stats-delay'), /^Delay ≈ [\d.]+ ms$/);
  assert.equal(await page.evaluate(() => {
    const match = /^\d+ EVENTS · (\d+) VOICES · \d+ LATE$/.exec(document.querySelector('#queue').textContent);
    return match && document.querySelector('#stats-activity').textContent === `${match[1]} voices`;
  }), true);
  await page.click('#mute'); await checkGain('sb128_EAPCI4M.ECW');
  await page.waitForFunction(() => ['#stats-rms', '#stats-lufs'].every(id => ['−∞', '< −120'].includes(document.querySelector(id).textContent)));
  await page.click('#mute'); await checkGain('sb128_EAPCI4M.ECW');
  assert.equal(await text('#soundfont-name'), 'Sound Blaster PCI 128');
  assert.ok((await page.evaluate(() => window.__labels)).includes('Downloading sb128_EAPCI4M.ECW'));
  await page.click('#cover-sb16'); await label('LIBADLMIDI / NUKED OPL3 · BANK 16');
  // A track's WAV button renders it on the engine and bank shown without choosing it.
  const trackDownload = page.waitForEvent('download', { timeout: 60000 }); await page.click('#tracks li:nth-child(1) .track-download');
  const track = await trackDownload; assert.equal(track.suggestedFilename(), 'Doom - 1 Intro.wav');
  await track.saveAs('output/browser-track.wav');
  const trackWav = await wavStats('output/browser-track.wav');
  assert.equal(trackWav.riff, 'RIFF'); assert.ok(trackWav.frames >= 8.5 * 48000 && trackWav.frames <= 9 * 48000, `${trackWav.frames} frames`); assert.ok(trackWav.peak > 300, `peak ${trackWav.peak}`);
  assert.equal(await page.locator('#tracks input:checked').inputValue(), '1');
  // All card banks and cores are requested once, including separate wavesets of the same card.
  const choices = [
    ['#cover-sb128', 'SOUND BLASTER PCI 128'],
    ...[2, 4, 8].map(size => [variant(`sb128_EAPCI${size}M.ECW`), 'SOUND BLASTER PCI 128']),
    ['#cover-ultrasound', 'GRAVIS ULTRASOUND (GF1)'], ['#cover-awe32', 'SOUND BLASTER AWE32'],
    ['#cover-awe64', 'SOUND BLASTER AWE64 (HARDWARE VOICES)'],
    [variant('sb16-cqm'), 'LIBADLMIDI / NUKED CQM · BANK 16'],
  ];
  for (const [selector, name] of choices) {
    await page.click(selector); await label(name); await pressed(selector, 'true');
    const active = await page.locator('.card-cover[aria-pressed=true]').getAttribute('id');
    const card = cards.find(c => active === `cover-${c.id}`);
    const key = card.variants.length === 1 ? card.variants[0].file : await page.locator(`#${active} + .toggle-group [aria-pressed=true]`).getAttribute('value');
    await checkGain(key);
    if (key === 'sb128_EAPCI8M.ECW') {
      // The variant trim holds across track changes and applies to any exported row.
      await page.click('#tracks li:nth-child(3) label'); await title("The Imp's Song (E1M2) · Doom");
      await checkGain(key);
      // Verify the manual calibration against an independent dry render.
      await page.locator('#fx-compressor').uncheck();
      const pending = page.waitForEvent('download');
      await page.locator('#tracks .track-download').first().click();
      const bytes = await readFile(await (await pending).path());
      const v = card.variants.find(v => v.file === key), file = doomTracks[0].file;
      const sources = variantSources(v, await readFile(`docs/soundcards/${key}`)), midi = await readFile(`docs/music/${file}`);
      const expectedWav = await renderWav(file, { engine: v.kind, profileSources: { [v.kind]: sources }, cardGain: 10 ** (baseTrimDb[key] / 20) },
        s => { const info = s.loadMidi(midi); s.play(); return info.duration + 2; }, () => {});
      assert.ok(bytes.equals(Buffer.from(await expectedWav.arrayBuffer())), 'ECW download uses the card gain');
      await page.locator('#fx-compressor').check();
      await page.click('#tracks li:nth-child(2) label'); await title("At Doom's Gate (E1M1) · Doom");
    }
    assert.equal(await text('#card-status'), '');
    assert.equal(await page.locator('#toggle').getAttribute('aria-pressed'), 'true');
  }
  await page.fill('#game-search', 'jazz jackrabbit 2');
  await album('jazz-jackrabbit-2-1998'); await title('Lab Rat · Jazz Jackrabbit 2');
  await label('LIBADLMIDI / NUKED CQM · BANK 0'); await pressed(variant('sb16-cqm'), 'true'); await checkGain('sb16-cqm');
  await page.click(variant('sb128_EAPCI4M.ECW')); await label('SOUND BLASTER PCI 128');
  await page.click('#tracks li:nth-child(2) label'); await title('Carrotus · Jazz Jackrabbit 2');
  await pressed('#cover-sb128', 'true');
  await page.fill('#game-search', 'doom');
  await album('doom-1993'); await title('Intro · Doom'); await label('SOUND BLASTER PCI 128');
  await pressed(variant('sb128_EAPCI4M.ECW'), 'true');
  // The final track leaves the cover visible until the listener chooses the next album.
  const priorAlbum = catalog[catalog.findIndex(a => a.id === 'doom-1993') - 1];
  const lastTrack = priorAlbum.editions.at(-1).tracks.at(-1);
  await page.click('#previous'); await title(`${lastTrack.title} · ${priorAlbum.title}`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#visual-panel')).opacity === '1');
  await setRange('#seek', Number(await page.locator('#seek').getAttribute('max')) - 0.5, 'change');
  await pressed('#toggle', 'false');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#visual-panel')).opacity === '0');
  assert.equal(await text('#album-title'), priorAlbum.title);
  assert.equal(await page.locator('#cover-art').isVisible(), true);
  await page.click('#next');
  await title('Intro · Doom'); await label('SOUND BLASTER PCI 128'); await pressed(variant('sb128_EAPCI4M.ECW'), 'true');
  const expected = ['sb128_EAPCI2M.ECW', 'sb128_EAPCI4M.ECW', 'sb128_EAPCI8M.ECW',
    'gus-gf1-1024k.dspack', 'awe32--emu8000-gm-rom-synthgs.dspack', 'awe64--emu8000-gm-rom-synthgs.dspack',
    'awe32.wasm', 'awe64.wasm', 'fm-synth.wasm',
    'sb-pci128.wasm', 'sb16-cqm.wasm', 'gus-gf1.wasm'].sort();
  assert.deepEqual(cardRequests.map(url => url.split('/').pop()).sort(), expected);
  const stored = await page.evaluate(async () => {
    const parent = await (await navigator.storage.getDirectory()).getDirectoryHandle('defuss-storage');
    const directory = await parent.getDirectoryHandle('midi-sound-cards');
    return Array.fromAsync(directory.keys());
  });
  assert.deepEqual(stored.sort(), expected.map(name => name.toLowerCase()).sort());
  // A new page only has persistent storage. Block downloads to distinguish OPFS from the HTTP cache.
  const second = await context.newPage(), blocked = [];
  await context.grantPermissions([], { origin: url });
  await second.route(/\.(dspack|ecw|sf2|wasm)$/i, route => { blocked.push(route.request().url()); return route.abort(); });
  await second.goto(url);
  await second.waitForFunction(() => !document.querySelector('#file').disabled);
  const localMidi = Buffer.from(midiFixture());
  localMidi.writeUInt16BE(1, 12); // Sustain the note while the second software-rendered browser initializes its shaders.
  await second.setInputFiles('#file', { name: 'from-crates.mid', mimeType: 'audio/midi', buffer: localMidi });
  await second.waitForFunction(() => document.querySelector('#track-title').textContent === 'from-crates.mid' && !document.querySelector('#controls').disabled);
  assert.equal(await second.locator('#visualizer .toggle[value=milkdrop]').getAttribute('aria-pressed'), 'true');
  await second.bringToFront();
  await second.locator('.stage').scrollIntoViewIfNeeded();
  await second.waitForFunction(() => !document.querySelector('#visual-panel').inert &&
    !document.querySelector('#visual-panel').hidden && document.querySelector('#visual').dataset.frames);
  assert.equal(await second.locator('#engine-label').textContent(), 'SOUND BLASTER PCI 128');
  assert.equal(await second.getByRole('button', { name: '2 MB ECW', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const selector of ['#cover-sb128', ...choices.slice(1).map(([selector]) => selector), variant('sb16-opl3')]) {
    await second.click(selector);
    await second.waitForFunction(sel => document.querySelector(sel).getAttribute('aria-pressed') === 'true' &&
      !document.querySelector('.card-cover[aria-busy]'), selector);
  }
  // Exercise the browser's MIDI API with access blocked, then granted from site settings.
  await second.getByRole('button', { name: 'Allow MIDI access' }).click();
  await second.waitForFunction(() => document.querySelector('#midi-in').textContent === 'WEB MIDI: BLOCKED IN SITE SETTINGS' &&
    !document.querySelector('#midi-permission').disabled);
  await context.grantPermissions(['midi', 'midi-sysex'], { origin: url });
  await second.locator('#midi-permission').waitFor({ state: 'hidden' });
  const inputNames = await second.evaluate(async () => [...(await navigator.requestMIDIAccess()).inputs.values()].map(input => input.name || 'Keyboard'));
  assert.equal(await second.locator('#midi-in').textContent(), 'WEB MIDI: ' + (inputNames.join(', ').toUpperCase() || 'NO KEYBOARD'));
  // The renderer must use the selected card's bank and cached core as well.
  await second.click('label.album:has(input[value="doom-1993"])');
  await second.waitForFunction(() => document.querySelector('#track-title').textContent === 'Intro · Doom');
  assert.equal(await second.locator('#tracks li').count(), 55);
  assert.equal(await second.locator('#cover-art').isVisible(), true);
  assert.ok(await second.locator('#player-cover').getAttribute('src'));
  assert.equal(await second.locator('#albums input:checked').inputValue(), 'doom-1993');
  await second.click('#cover-awe32');
  await second.waitForFunction(() => document.querySelector('#cover-awe32').getAttribute('aria-pressed') === 'true');
  const rendered = second.waitForEvent('download', { timeout: 60000 }).catch(async error => {
    throw new Error(`AWE32 export: ${await second.locator('#message').textContent()} (asset requests: ${blocked.join(', ')})`, { cause: error });
  });
  await second.locator('#tracks .track-download').first().click();
  await (await rendered).saveAs('output/browser-card-awe32.wav');
  assert.ok((await wavStats('output/browser-card-awe32.wav')).peak > 300);
  await second.fill('#game-search', 'lost vikings');
  await second.click('label.album:has(input[value="the-lost-vikings-1993"])');
  await second.waitForFunction(() => document.querySelector('#track-title').textContent === 'Track 465 · The Lost Vikings');
  assert.equal(await second.locator('#tracks li').count(), 47);
  await second.waitForFunction(() => document.querySelector('#player-cover').complete && document.querySelector('#player-cover').naturalWidth > 0 &&
    document.querySelector('#player-cover').currentSrc.endsWith('/the-lost-vikings-1993.jpg'));
  await second.click('#cover-sb16');
  await second.waitForFunction(() => document.querySelector('#fm-banks').value === '75');
  await second.locator('#tracks li').filter({ hasText: 'Track 467' }).locator('label').click();
  await second.waitForFunction(() => document.querySelector('#track-title').textContent === 'Track 467 · The Lost Vikings' &&
    Number(document.querySelector('#seek').value) > .3 && Number(document.querySelector('#page-rain').dataset.level) > .01);
  await second.fill('#game-search', '');
  await second.locator('#albums').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await second.locator('label.album:has(input[value="archive-Zorro"])').waitFor();
  await second.fill('#game-search', 'mirsoft batest2');
  await second.click('label.album:has(input[value="archive-Caesar 2"])');
  await second.waitForFunction(() => document.querySelector('#track-title').textContent === 'BATEST2 · Caesar 2' &&
    Number(document.querySelector('#seek').value) > .3 && Number(document.querySelector('#page-rain').dataset.level) > .01);
  assert.deepEqual(blocked, []); await second.close();
  await page.click(variant('sb16-opl3')); await label('LIBADLMIDI / NUKED OPL3 · BANK 16');
  const fresh = await browser.newPage();
  const coldAssets = [];
  fresh.on('request', req => { if (isCardAsset(req.url())) coldAssets.push(new URL(req.url()).pathname); });
  await fresh.goto(url);
  await fresh.fill('#computer-search', 'hanna chaya');
  await fresh.locator('#computer-albums').getByText('Hanna Lee', { exact: true }).click();
  await fresh.waitForFunction(() => document.querySelector('#track-title').textContent === 'Chaya · Hanna Lee' &&
    Number(document.querySelector('#page-rain').dataset.level) > .01);
  assert.deepEqual(coldAssets, ['/soundcards/vgm-opl.wasm']);
  await fresh.close();
  assert.equal(await text('#computer-count'), '215 artists');
  const grid = page.locator('#computer-albums');
  const visibleArtists = await grid.locator('.album').count();
  assert.ok(visibleArtists > 0 && visibleArtists < 215);
  await grid.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => +document.querySelector('#computer-albums .virtual-list-row').dataset.index > 0);
  await page.fill('#computer-search', 'unmatched-zzzz');
  await page.waitForFunction(() => document.querySelector('#computer-albums').dataset.state === 'empty');
  await page.fill('#computer-search', 'hanna chaya');
  assert.equal(await text('#computer-count'), '1 artist');
  await grid.getByText('Hanna Lee', { exact: true }).click();
  await title('Chaya · Hanna Lee');
  await sounding();
  assert.equal(await text('#release-type'), 'COMPUTER MUSIC');
  await page.click('#toggle'); await pressed('#toggle', 'false');
  await page.click('#forward'); await page.waitForFunction(() => +document.querySelector('#seek').value >= 10);
  await page.click('#toggle'); await pressed('#toggle', 'true');
  await page.fill('#game-search', 'at doom');
  await album('doom-1993'); await title('Intro · Doom');
  await page.fill('#game-search', '');
  await page.fill('#computer-search', '');
  // Bergium draws, steps to the next preset of the page's list, and stops.
  const frames = Number(await page.getAttribute('#visual', 'data-frames') ?? 0);
  await page.waitForFunction(frames => Number(document.querySelector('#visual').dataset.frames) >= frames + 30, frames, { timeout: 20000 });
  const shown = await text('#visual-name'); await page.click('#visual-next');
  await page.waitForFunction(shown => document.querySelector('#visual-name').textContent !== shown, shown);
  assert.deepEqual(await page.locator('#visualizer .toggle').allTextContents(), ['No Visuals', 'Bergium']);
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
  // A named sequence carries its own title, credits and meter inside either MIDI or RMI.
  const meta = (type, value) => {
    const bytes = [...Buffer.from(value)];
    return [0, 0xff, type, bytes.length, ...bytes];
  };
  const original = midiFixture(), events = [
    ...meta(3, 'Étude <2>'), ...meta(2, '© Test composer'), ...meta(1, 'Piano duet'),
    0, 0xff, 0x58, 4, 3, 2, 24, 8, ...original.subarray(22),
  ];
  const named = Uint8Array.from([...original.subarray(0, 21), events.length, ...events]);
  for (const [name, bytes, expectedTitle] of [
    ['original.mid', named, 'Étude <2>'], ['original.rmi', rmiFixture(named), 'Étude <2>'], ['original.mus', musFixture(), 'original.mus'],
  ]) {
    await page.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await page.waitForFunction(name => document.querySelector('#tracks small')?.textContent === name, name);
    await title(expectedTitle);
    assert.equal(await text('#album-title'), expectedTitle);
    assert.equal(await text('#release-type'), 'YOUR MIDI');
    assert.equal(await page.locator('#albums input:checked').count(), 0);
    assert.equal(await page.locator('#tracks li').count(), 1);
    assert.equal(await page.locator('#tracks input:checked').count(), 1);
    assert.equal(await text('#tracks strong'), expectedTitle);
    assert.equal(await text('#album-line'), name.endsWith('.mus') ? 'MUS' : 'MIDI format 0 · 1 MIDI track · 120 BPM · 3/4 · © Test composer · Piano duet');
    assert.equal(await page.locator('#player-cover').getAttribute('src'), null);
    assert.equal(await page.locator('#cover-art').isVisible(), false);
    assert.equal(await page.locator('#visual-panel').isVisible(), false);
    assert.equal(await page.locator('.stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    await page.click('#toggle'); await pressed('#toggle', 'false'); await page.click('#toggle'); await pressed('#toggle', 'true'); await page.click('#stop');
  }
  // A WOPL file replaces the FM bank (switching to FM), and the game's bank comes back; an FM export renders it.
  // Banks also open Brotli-compressed, as the page's own ship.
  await page.setInputFiles('#file', { name: 'test.wopl.br', mimeType: 'application/octet-stream', buffer: Buffer.from(compress(await readFile('tests/test.wopl'), { quality: 5 })) });
  await page.waitForFunction(() => document.querySelector('#message').textContent === 'FM bank loaded from your WOPL file.');
  assert.equal(await text('#engine-label'), 'LIBADLMIDI / NUKED OPL3 · WOPL FILE');
  await pressed('#cover-sb16', 'true'); await pressed(variant('sb16-opl3'), 'true');
  assert.equal(await page.locator('#fm-banks').inputValue(), '-1'); assert.equal(await page.locator('#fm-banks option:checked').textContent(), 'Your WOPL file');
  const fmDownload = page.waitForEvent('download'); await page.click('#take-download');
  await (await fmDownload).saveAs('output/browser-fm-recording.wav');
  const fmWav = await wavStats('output/browser-fm-recording.wav'); assert.ok(fmWav.riff === 'RIFF' && fmWav.peak > 300, `recording peak ${fmWav.peak}`);
  await page.selectOption('#fm-banks', '16'); await page.waitForFunction(() => document.querySelector('#engine-label').textContent === 'LIBADLMIDI / NUKED OPL3 · BANK 16');
  assert.equal(await page.locator('#fm-banks option[value="-1"]').count(), 0);
  await page.setInputFiles('#file', { name: 'sines.sf2.br', mimeType: 'application/octet-stream', buffer: Buffer.from(compress(soundfont(), { quality: 5 })) });
  await page.waitForFunction(() => document.querySelector('#message').textContent === 'SoundFont loaded: 3 presets.');
  await checkGain(undefined);
  assert.equal(await page.locator('.card-cover[aria-pressed=true]').count(), 0, 'a user SoundFont has its own identity');
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
  const fmModulesBefore = fmModules.length;
  const evidence = await page.evaluate(async ({ midiBytes, sineFont, gus32, gus14 }) => {
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
    // SysEx through the public API: GM System On, by send and by sendMidi, ends a held note; a data byte of 80h is a
    // RangeError. sb16-opl3 runs on the module fm loaded; a profile without its pack rejects naming it, and the engine
    // that played plays on.
    const held = async () => (await synth.status()).voices;
    await synth.noteOn(0, 60, 127); await wait(150); const heldVoices = await held();
    await synth.send({ type: 'sysex', data: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7] }); await wait(150); const afterSend = await held();
    await synth.noteOn(0, 62, 127); await wait(150);
    await synth.sendMidi([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]); await wait(150); const afterMidi = await held();
    let badSysex = false; try { await synth.send({ type: 'sysex', data: [0xf0, 0x80, 0xf7] }); } catch (e) { badSysex = e instanceof RangeError; }
    const opl3 = await synth.useProfile('sb16-opl3');
    let missing = ''; try { await synth.useProfile('awe32'); } catch (e) { missing = e.message; }
    const stillPlaying = synth.info.kind;
    // A module the loaded profile's core refuses (another profile's) leaves the GF1 playing, and a pack given later loads
    // on the GF1's own module, not on the one refused.
    await synth.useProfile('gus-gf1', { assets: new Uint8Array(gus32) });
    const foreign = await (await fetch(new URL('./synth/assets/profiles/sb-pci128.wasm', location.href))).arrayBuffer();
    let refused = ''; try { await synth.useProfile('gus-gf1', { wasm: foreign }); } catch (e) { refused = e.message; }
    const gusAfter = (await synth.useProfile('gus-gf1', { assets: new Uint8Array(gus14) })).maxVoices;
    const sysex = { heldVoices, afterSend, afterMidi, badSysex, opl3: opl3.kind, opl3Voices: opl3.maxVoices, missing, stillPlaying, refused, gusAfter };
    const back = await synth.useEngine('soundfont');
    const engines = { kind: fm.kind, engines: fm.engines, banks: fm.fm.banks.length, bank: synth.info.fm.bank, voices: fm.maxVoices, fmSounding, fmBadBank, fmDrumChannel, badRate, back: back.kind, backPresets: back.presets.length };
    synth.setGain(0.3); await synth.resume();
    const stats = await synth.status(); await Promise.all([synth.dispose(), synth.dispose()]);
    const callerContextPreserved = context.state !== 'closed';
    let disposedRejected = false; try { await synth.noteOn(0,60); } catch { disposedRejected = true; }
    const second = await MidiSynth.create({ context, baseUrl:new URL('./synth/',location.href) }); await second.dispose();
    await context.close();
    const owned = await MidiSynth.create({ baseUrl:new URL('./synth/',location.href) }); await owned.resume(); await owned.dispose();
    return { sysex, info: { engine: info.engine, presets: info.presets.length, first: info.presets[0], maxVoices: info.maxVoices }, sounding, voices, drums, badPreset, overflow,
      duration:meta.duration, paused, pausedAgain, ended, sinePresets: sines.presets.length, badFont, keptFont, stats, callerContextPreserved, disposedRejected, ownedContextClosed:owned.context.state === 'closed', engines, sourceRms, silenced };
  }, { midiBytes: [...midiFixture()], sineFont: [...soundfont()], gus32: [...gusFixture()], gus14: [...gusFixture(14)] });
  assert.equal(evidence.info.engine, 'TinySoundFont 0.9'); assert.equal(evidence.info.presets, 136);
  assert.ok(evidence.sounding > 0.001, 'Actual audio output must be nonzero'); assert.ok(evidence.voices > 0);
  assert.ok(evidence.drums > 0.001, 'A drum kit on channel 4 must sound');
  assert.equal(evidence.badPreset, true); assert.equal(evidence.overflow, true); assert.equal(evidence.duration, 0.5);
  assert.equal(evidence.paused, evidence.pausedAgain); assert.equal(evidence.ended, true);
  assert.equal(evidence.sinePresets, 3); assert.equal(evidence.badFont, true); assert.equal(evidence.keptFont, 3);
  assert.deepEqual(evidence.engines, { kind: 'fm', engines: ['soundfont', 'fm'], banks: 79, bank: 16, voices: 36, fmSounding: evidence.engines.fmSounding,
    fmBadBank: true, fmDrumChannel: true, badRate: true, back: 'soundfont', backPresets: 3 });
  assert.ok(evidence.engines.fmSounding > 0.001, 'The FM engine must sound');
  const { sysex } = evidence;
  assert.ok(sysex.heldVoices >= 1, 'a held note sounds'); assert.equal(sysex.afterSend, 0, 'GM System On by send ends it');
  assert.equal(sysex.afterMidi, 0, 'GM System On by sendMidi ends it'); assert.equal(sysex.badSysex, true);
  assert.equal(sysex.opl3, 'sb16-opl3'); assert.equal(sysex.opl3Voices, 18); assert.match(sysex.missing, /awe32/);
  assert.equal(sysex.stillPlaying, 'sb16-opl3');
  assert.match(sysex.refused, /gus-gf1/); assert.equal(sysex.gusAfter, 14, 'a later pack loads on the GF1 module, not the refused one');
  assert.equal(fmModules.length - fmModulesBefore, 1, 'fm and sb16-opl3 load fm-synth.wasm once');
  assert.ok(evidence.sourceRms > 0.001 && evidence.silenced < evidence.sourceRms / 10, `source ${evidence.sourceRms} sounds while output at gain 0 gives ${evidence.silenced}`);
  assert.equal(evidence.callerContextPreserved, true); assert.equal(evidence.disposedRejected, true); assert.equal(evidence.ownedContextClosed,true);
  assert.equal(errors.length, 0, errors.join('\n'));
  // Equal-amplitude channels in opposite phase expose an accidental mono downmix in either meter.
  for (const [rate, channels] of [[44100, 1], [48000, 2]]) {
    const levels = await page.evaluate(async ([rate, channels]) => {
      const { meterOutput } = await import('./audio-meter.js');
      const ctx = new OfflineAudioContext(channels, rate, rate);
      const source = ctx.createBufferSource(), buffer = ctx.createBuffer(channels, rate, rate);
      for (let channel = 0; channel < channels; channel++) {
        const pcm = buffer.getChannelData(channel), amplitude = channel === 0 ? 0.1 : -0.1;
        for (let i = 0; i < rate; i++) pcm[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / rate);
      }
      source.buffer = buffer; source.connect(ctx.destination);
      let publish;
      const reading = new Promise(resolve => { publish = resolve; });
      await meterOutput(source, publish); source.start(); await ctx.startRendering();
      return reading;
    }, [rate, channels]);
    assert.equal(levels.channels, channels);
    assert.ok(Math.abs(levels.rms + 23.01) < 0.05);
    assert.ok(Math.abs(levels.lufs - (channels === 1 ? -23 : -20)) < 0.1);
  }
  await checkFx(page);
  assert.deepEqual(errors, []);
  await page.locator('#fx').screenshot({ path: 'output/fx.png' });
  await page.locator('#sound-engine').screenshot({ path: 'output/sound-cards.png' });
  for (const [width, expectedRows] of [[1280, [5]], [768, [5]], [390, [3, 2]]]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await page.locator('.card-cover').evaluateAll(covers => covers.map(c => c.getBoundingClientRect().top));
    const rows = [...new Set(boxes)].map(top => boxes.filter(y => y === top).length);
    assert.deepEqual(rows, expectedRows, `sound card layout at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({ path:'output/demo-desktop.png', fullPage:true });
  // The phone layout section by section: Chromium fails to capture the 9,194 px phone page whole while its WebGL
  // surfaces (the rain, the cover's shader, Bergium) and the sleeves' filter are on it (tmp/probe-phone-capture.mjs).
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(() => ['albums', 'computer-albums'].every(id => {
    const grid = document.getElementById(id);
    return grid.getAttribute('aria-colcount') === '2' && grid.querySelector('.album');
  }));
  await page.fill('#computer-search', 'hanna chaya');
  await page.locator('#computer-albums').getByText('Hanna Lee', { exact: true }).waitFor();
  await page.fill('#computer-search', '');
  for (const [file, id] of [['demo-mobile-sound-cards.png', 'sound-engine'], ['demo-mobile-fx.png', 'fx'], ['demo-mobile.png', 'player'], ['demo-mobile-crates.png', 'crates'], ['demo-mobile-computer.png', 'computer-crates'], ['demo-mobile-synth.png', 'synth']]) {
    await page.locator(`#${id}`).evaluate(el => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300);
    await page.screenshot({ path: `output/${file}` });
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'Mobile must not overflow horizontally');
  const result = { passed: true, browser: await browser.version(), soundCards: { cachedFiles: stored, repeatAssetRequests: blocked }, ...evidence, errors };
  await writeFile('output/e2e.json', JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result,null,2));
} catch (error) {
  // What the page said when the run failed, and how it looked.
  console.error(`page message: ${await page.locator('#message').textContent().catch(() => '(none)')}`);
  await page.screenshot({ path: 'output/e2e-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
