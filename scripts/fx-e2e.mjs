import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function checkFx(page) {
  assert.equal(await page.locator('#sound-engine + #fx').count(), 1);
  assert.equal(await page.locator('#fx-eq .envelope-handle').count(), 3);
  const settings = () => page.evaluate(async () => (await import('./fx.js')).fxSettings());
  const dial = async (id, value) => {
    await page.locator('#fx-' + id).evaluate((input, v) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };
  const handle = page.locator('#fx-eq .envelope-handle').nth(1);
  const before = (await settings()).bands[1].frequency;
  await handle.focus(); await handle.press('ArrowRight');
  assert.ok((await settings()).bands[1].frequency > before);
  await page.getByRole('button', { name: 'Reset EQ' }).click();
  assert.equal((await settings()).bands[1].frequency, before);

  // Measure the same graph used for live playback with a half-second tone followed by silence.
  async function probe() {
    return page.evaluate(async () => {
      const { createFx, fxSettings } = await import('./fx.js');
      const rate = 48000, ctx = new OfflineAudioContext(2, rate, rate);
      const buffer = ctx.createBuffer(2, rate / 2, rate);
      for (let ch = 0; ch < 2; ch++) {
        const pcm = buffer.getChannelData(ch);
        for (let i = 0; i < pcm.length; i++) pcm[i] = .8 * Math.sin(2 * Math.PI * 1200 * i / rate);
      }
      const source = ctx.createBufferSource(), fx = await createFx(ctx, fxSettings());
      source.buffer = buffer; source.connect(fx.input); fx.output.connect(ctx.destination); source.start();
      const samples = (await ctx.startRendering()).getChannelData(0);
      const rms = (a, b) => Math.sqrt(samples.subarray(a, b).reduce((sum, x) => sum + x*x, 0) / (b-a));
      return { tone: rms(12000, 22000), tail: rms(26000, 34000) };
    });
  }
  assert.equal((await settings()).autoLevel, true);
  assert.equal((await settings()).compressor, true);
  // Step the input level between two steady tones. The same default must converge from either direction.
  const leveled = await page.evaluate(async () => {
    const { createFx, fxSettings } = await import('./fx.js');
    const rate = 48000, ctx = new OfflineAudioContext(2, 8 * rate, rate);
    const tone = ctx.createOscillator(), gain = ctx.createGain(), fx = await createFx(ctx, fxSettings());
    tone.frequency.value = 1000;
    gain.gain.setValueAtTime(.08, 0); gain.gain.setValueAtTime(.45, 4);
    tone.connect(gain).connect(fx.input); fx.output.connect(ctx.destination); tone.start();
    const samples = (await ctx.startRendering()).getChannelData(0);
    function dbAt(seconds) {
      const window = samples.subarray(seconds * rate, (seconds + .5) * rate);
      return 10 * Math.log10(window.reduce((sum, x) => sum + x*x, 0) / window.length);
    }
    return [dbAt(3.5), dbAt(7.5)];
  });
  assert.ok(Math.abs(leveled[1] - leveled[0]) < 1, `steady output levels: ${leveled.join(', ')} dBFS`);
  await page.locator('#fx-auto-level').uncheck();
  await page.locator('#fx-compressor').uncheck();
  assert.equal(await page.locator('#fx-auto-level').isDisabled(), true);
  const dry = await probe();
  assert.ok(Math.abs(dry.tone - .8 / Math.sqrt(2)) < .001 && dry.tail < .00001);
  await dial('mid', -12);
  assert.equal((await settings()).bands[1].gain, -12);
  assert.ok(Math.abs(20 * Math.log10((await probe()).tone / dry.tone) + 12) < .15);
  await page.getByRole('button', { name: 'Reset EQ' }).click();
  await dial('threshold', -40); await dial('ratio', 12);
  await dial('attack', .005); await dial('release', .12);
  await page.locator('#fx-compressor').check();
  assert.ok((await probe()).tone < dry.tone * .6);
  await page.locator('#fx-compressor').uncheck();
  await dial('mix', .65); await dial('decay', 1.2);
  assert.ok((await probe()).tail > .001);

  await page.locator('label.album:has(input[value="doom-1993"])').click();
  await page.waitForFunction(() => document.querySelector('#album-title').textContent === 'Doom');
  const download = page.waitForEvent('download');
  await page.locator('#tracks .track-download').first().click();
  const bytes = await readFile(await (await download).path());
  const frames = (bytes.length - 44) / 4;
  assert.ok(frames > 9.8 * 48000 && frames < 10.2 * 48000, 'the exported Doom intro includes the 1.2 s reverb tail');
  await dial('mix', 0);
}
