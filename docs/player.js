// The game music player: the albums of music/index.json played by the page's synthesizer, on the SoundFont or the FM
// engine. The controls use defuss-shadcn's Audio markup and styles, but this module drives them: the sound comes from
// the AudioWorklet, not from an <audio> element.
import { PROFILE_DESCRIPTORS, openProfileStore } from './synth/index.js';
import { byYear, deviceName, devicesIn, readFiles } from './profile-files.js';
import { renderWav, save } from './render.js';

/** Lucide icons (ISC licence, lucide.dev), 24-unit outlines. */
const ICONS = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'skip-back': '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'volume-x': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
};
const icon = name => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
/** Sets a defuss-shadcn slider's value from code: its script redraws the filled track only on the user's input. */
function setRange(input, value) {
  input.value = String(value);
  const min = Number(input.min || 0), max = Number(input.max || 100);
  input.style.setProperty('--slider-value', `${max > min ? (Number(input.value) - min) / (max - min) * 100 : 0}%`);
}
/** The gain of Bergium's input over the synthesizer's own level (src/voices.ts sets that level); the human asked twice
 *  for a stronger picture (2026-11-24). */
const VISUAL_GAIN = 4;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** An element with properties (a name with a dash is an attribute) and children. */
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) if (key.includes('-')) e.setAttribute(key, value); else e[key] = value;
  e.append(...children);
  return e;
}

/**
 * Builds the player in its section and returns its handle.
 * - start(): resolves with the page's MidiSynth, starting audio when it is off (a click is the user gesture).
 * - analyser(): the AnalyserNode on the synthesizer's output, or undefined before the start.
 * - engineChanged(info): the piano's lists follow the engine.
 * - setVolume(value): the page's output gain, 0 to 1; volumeChanged(value) is the player's call back into it.
 * - message(text): the display's status line.
 * - soundFontName(): what the SoundFont engine plays, for the bank line; soundFontEngine: that engine's name.
 * - local: { url, names }: the files of this machine the demo server serves at url (docs/app.js).
 * - sound(album): what a WAV download plays on (docs/render.js): the engine shown, album's FM bank, the SoundFont.
 * - progress(event): the page's progress bar.
 */
export async function createPlayer({ start, analyser, engineChanged, message, setVolume, soundFontName, soundFontEngine = 'SoundFont', local = { names: [] }, sound, progress }) {
  const $ = id => document.getElementById(id);
  for (const slot of document.querySelectorAll('#player [data-icon]')) slot.outerHTML = icon(slot.dataset.icon);
  const music = new URL('./music/', import.meta.url);
  const library = await (await fetch(new URL('index.json', music))).json();
  const albums = library.albums;
  // The maker, model and release year of each engine and profile, for the Sound Engine list.
  const deviceTable = await fetch(new URL('devices.json', import.meta.url)).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const count = albums.reduce((n, a) => n + a.editions.reduce((m, e) => m + e.tracks.length, 0), 0);
  $('library').textContent = `${albums.length} ALBUMS · ${count} TRACKS`;
  // album shown; current is what the synthesizer holds: {album, edition, index} or a file of the user's. An album's list
  // holds the tracks of all its editions (GM first), each row naming its edition.
  // The page opens on Warcraft II, the first album (the human's choice of 2026-11-24).
  let album = albums.find(a => a.id === 'warcraft-ii-tides-of-darkness-1995') ?? albums[0];
  const entries = a => a.editions.flatMap(e => e.tracks.map((track, index) => ({ edition: e, index, track })));
  const position = (a, e, index) => entries(a).findIndex(x => x.edition === e && x.index === index);
  let current = null, playing = false, duration = 0, busy = false, muted = false, volume = Number($('volume').value);
  const status = synth => synth.status();
  const act = fn => () => fn().catch(error => message(error.message));

  $('albums').replaceChildren(...albums.map(a => {
    // A sleeve: the cover on the release's CRT tube (a still frame), the year on a sticker, the title and the platform.
    const label = el('label', { className: 'album', title: `${a.title} (${a.year})` },
      el('input', { type: 'radio', name: 'album', value: a.id, checked: a === album }),
      el('span', { className: 'album-year', textContent: String(a.year), 'aria-hidden': 'true' }),
      el('div', { className: 'shader', 'data-effect': 'crt', 'data-curve': '0.25', 'data-scanlines': '150', 'data-glow': '0.4', 'data-speed': '0', 'aria-hidden': 'true' },
        el('img', { src: new URL(a.thumbnail, music).href, alt: '', width: 240, height: 320 })),
      el('strong', { textContent: a.title }),
      el('small', { textContent: [a.composers[0], a.platform].filter(Boolean).join(' · ') }));
    // A sleeve chosen in the crates plays the album's first track and brings the player into view.
    label.querySelector('input').onchange = () => {
      showAlbum(a); $('player').scrollIntoView({ behavior: 'smooth', block: 'start' });
      play(a, a.editions[0], 0).catch(error => message(error.message));
    };
    return label;
  }));
  function showAlbum(next) {
    album = next;
    $('player-cover').src = new URL(album.thumbnail, music).href;
    $('album-title').textContent = album.title;
    $('album-line').textContent = [album.year, album.composers.join(', '), album.platform].filter(Boolean).join(' · ');
    showBank();
    listTracks();
  }
  /** The engines that play the game banks: libADLMIDI on one OPL3, on one CQM, and the legacy multi-chip engine. */
  const FM = new Set(['sb16-opl3', 'sb16-cqm', 'fm']);
  /** The built-in engines' names; a profile is named by its descriptor. */
  const ENGINE_NAMES = { 'sb16-opl3': 'Sound Blaster 16 (OPL3)', 'sb16-cqm': 'Sound Blaster 16 (CQM)', soundfont: soundFontEngine };
  $('engine').querySelector('.toggle[value=soundfont]').textContent = soundFontEngine;
  const engineName = (kind, synth) => ENGINE_NAMES[kind] ?? PROFILE_DESCRIPTORS[kind]?.label ?? synth?.info.engine ?? kind;
  /** The Sound Engine buttons: the engine a kind is (the FM engines are the Sound Blaster 16's chips; every profile is
   *  a device of the ROMs list), and the panel of its controls. */
  const engineOf = kind => FM.has(kind) ? 'sb16' : kind === 'soundfont' ? 'soundfont' : 'roms';
  function showPanel(engine) {
    for (const button of $('engine').querySelectorAll('.toggle')) button.setAttribute('aria-pressed', String(button.value === engine));
    for (const panel of ['sb16', 'soundfont', 'roms']) $(`panel-${panel}`).hidden = panel !== engine;
  }
  /** The engine the controls show (the synthesizer's, or the page's first before audio starts), the Sound Blaster 16's
   *  chip it played last, and the device of the ROMs list each profile has loaded, by its key. */
  let engineKind = 'sb16-opl3', chip = 'sb16-opl3';
  const loadedDevice = {};
  /** The controls show kind: its engine's button pressed and panel shown, its chip or its device chosen. */
  function markEngine(kind) {
    engineKind = kind;
    if (kind.startsWith('sb16')) chip = kind;
    showPanel(engineOf(kind));
    for (const button of $('engine-modes').querySelectorAll('.toggle')) button.setAttribute('aria-pressed', String(button.value === chip));
    if (loadedDevice[kind]) $('devices').value = loadedDevice[kind];
    $('soundfont-info').textContent = soundFontName();
  }
  /** The bank: on an FM engine a list of the synthesizer's banks (only the album's before audio starts), the playing
   *  bank chosen, with the user's WOPL file when one is loaded; on another engine its SoundFont's or its own name. */
  let shownSynth, picked = null;
  function showBank(synth = shownSynth) {
    shownSynth = synth;
    const kind = synth?.info.kind ?? engineKind;
    const fm = FM.has(kind), list = $('fm-banks');
    list.hidden = !fm; $('soundfont-name').hidden = fm;
    if (!fm) { $('soundfont-name').textContent = kind === 'soundfont' ? soundFontName() : engineName(kind, synth); return; }
    const info = synth?.info.fm, bank = info?.bank ?? album.fm.bank;
    const names = info ? info.banks.map((name, i) => [i, name]) : [[album.fm.bank, album.fm.name]];
    list.replaceChildren(...(bank < 0 ? [new Option('Your WOPL file', '-1')] : []),
      ...names.map(([i, name]) => new Option(`${i} · ${name}${i === album.fm.bank ? ` (${album.title})` : ''}`, String(i))));
    list.value = String(bank);
  }
  // A bank the user picks holds for the album it was picked on; another album plays with its game's bank.
  $('fm-banks').onchange = act(async () => {
    const synth = await start();
    picked = current?.album ?? album;
    await synth.setFmBank(Number($('fm-banks').value));
    showBank(synth); await engineChanged(synth.info);
  });
  /** Switches the synthesizer to engine kind for album a, with a's bank on an FM engine; sources is the user's pack for
   *  a device of the Sound Engine list. An engine that fails to load leaves the one that played, and the controls show it. */
  async function useEngine(synth, kind, a, sources) {
    const name = engineName(kind, synth);
    message(`Loading ${name}…`);
    try {
      await (sources ? synth.useProfile(kind, sources) : synth.useEngine(kind));
      await gameBank(synth, a);
    } finally { markEngine(synth.info.kind); showBank(synth); }
    engineChanged(synth.info);
    message(FM.has(kind) ? `${name}: ${synth.info.fm.banks[synth.info.fm.bank] ?? 'your bank'}, ${synth.info.maxVoices} voices.` : `${name}: ${synth.info.presets.length} presets.`);
  }
  // An album plays on its engine from the index (the FM engine unless it names the SoundFont engine); an engine the user
  // picks, or loads a file into, holds for the album it was picked on, as a picked bank does.
  let pickedEngine = null;
  async function albumEngine(synth, a) {
    if (pickedEngine === a) return;
    pickedEngine = null;
    const kind = a.engine ?? 'sb16-opl3';
    if (synth.info.kind !== kind) await useEngine(synth, kind, a);
  }
  /** The game's bank for album on the FM engine, unless the user loaded a WOPL file or picked a bank for it. */
  async function gameBank(synth, a) {
    if (picked === a) return;
    picked = null;
    if (FM.has(synth.info.kind) && synth.info.fm.bank !== -1 && synth.info.fm.bank !== a.fm.bank) { await synth.setFmBank(a.fm.bank); await engineChanged(synth.info); }
  }
  function listTracks() {
    const playing = current?.album === album ? position(album, current.edition, current.index) : -1;
    $('tracks').replaceChildren(...entries(album).map(({ edition, index: i, track }, at) => {
      const input = el('input', { type: 'radio', name: 'track', value: String(at), checked: at === playing });
      input.onchange = () => play(album, edition, i).catch(error => message(error.message));
      return el('li', { className: 'mk-playlist-item' }, el('label', {},
        input,
        el('span', { className: 'mk-playlist-item-index', 'aria-hidden': 'true' }, el('span', { textContent: String(track.number) }),
          el('i', { className: 'mk-playlist-item-bars' }, el('b'), el('b'), el('b'))),
        el('span', { className: 'mk-playlist-item-text' }, el('strong', { textContent: track.title }), el('small', { textContent: edition.name })),
        el('span', { className: 'mk-playlist-item-duration', textContent: clock(track.duration) }),
        download(album, edition, i)));
    }));
  }
  /** The track's WAV button. A button inside the label does not choose the track: it is interactive content. */
  function download(a, e, index) {
    const track = e.tracks[index];
    const button = el('button', { type: 'button', className: 'btn track-download', 'data-variant': 'ghost', 'data-size': 'sm', 'aria-label': `Download ${track.title} as WAV`, title: 'Download as WAV' });
    button.innerHTML = `${icon('download')}<span>WAV</span>`;
    button.onclick = act(async () => {
      button.disabled = true;
      try {
        await start();
        const data = new Uint8Array(await fetchTrack(track)), name = `${a.title} - ${track.number} ${track.title}`.replace(/[\\/:*?"<>|]+/g, '-');
        message(`Rendering ${track.title} as WAV…`);
        // The file plays to its end on the engine and bank shown, at the album's clock, with two seconds for the last notes.
        const wav = await renderWav(name, sound(a), offline => { const info = offline.loadMidi(data, { tempo: a.tempo ?? 1 }); offline.play(); return info.duration + 2; }, progress);
        save(wav, `${name}.wav`);
        message(`Downloaded ${track.title} as WAV: 48 kHz, stereo, 16-bit.`);
      } finally { button.disabled = false; }
    });
    return button;
  }
  const fetchTrack = async track => (await fetch(new URL(track.file.split('/').map(encodeURIComponent).join('/'), music))).arrayBuffer();

  /** Loads a file into the synthesizer and plays it from the start. */
  async function load(data, title, entry) {
    const synth = await start();
    busy = true;
    try {
      await synth.stop();
      if (entry) { await albumEngine(synth, entry.album); await gameBank(synth, entry.album); }
      let info;
      // tempo: the album's clock correction from the index (Raptor's files were converted at twice its clock).
      try { info = await synth.loadMidi(data, { tempo: entry?.album.tempo ?? 1 }); }
      catch (error) {
        // A rejected file unloads the previous one: the player holds nothing.
        current = null; duration = 0; setPlaying(false);
        $('track-title').textContent = 'Choose a track'; setRange($('seek'), 0); $('seek').disabled = true;
        $('time').value = $('duration').value = '0:00';
        for (const input of $('tracks').querySelectorAll('input')) input.checked = false;
        throw error;
      }
      current = entry ?? { title }; duration = info.duration;
      $('track-title').textContent = title;
      $('player-audio').setAttribute('aria-label', title);
      $('seek').max = String(Math.max(duration, 0.1)); setRange($('seek'), 0); $('seek').disabled = false;
      $('duration').value = clock(duration);
      await synth.play(false); setPlaying(true);
      showBank(synth);
      await showVisual(synth);
      visual?.title(title);
    } finally { busy = false; }
  }
  // Each choice of a track counts; a file that arrives after a later choice is left unplayed.
  let choice = 0;
  async function play(a, e, index) {
    const ticket = ++choice, track = e.tracks[index];
    const data = await fetchTrack(track);
    if (ticket !== choice) return;
    if (album !== a) showAlbum(a);
    await load(data, `${track.title} · ${a.title}`, { album: a, edition: e, index });
    const input = $('tracks').querySelector(`input[value="${position(a, e, index)}"]`);
    if (input) { input.checked = true; input.closest('li').scrollIntoView({ block: 'nearest' }); }
    message(`Playing ${track.title} from ${a.title} (${e.name}).`);
  }
  function setPlaying(value) {
    playing = value;
    $('toggle').setAttribute('aria-pressed', String(value));
    $('player').dataset.playing = String(value);
  }
  async function step(delta) {
    if (!current?.album) return play(album, album.editions[0], 0);
    const list = entries(current.album), at = position(current.album, current.edition, current.index) + delta;
    if (at >= 0 && at < list.length) return play(current.album, list[at].edition, list[at].index);
    // Past the album's last track the next album plays.
    const next = albums[(albums.indexOf(current.album) + (delta > 0 ? 1 : albums.length - 1)) % albums.length], all = entries(next);
    const to = delta > 0 ? all[0] : all.at(-1);
    return play(next, to.edition, to.index);
  }
  $('toggle').onclick = act(async () => {
    if (!current) return play(album, album.editions[0], 0);
    const synth = await start();
    if (playing) { await synth.pause(); setPlaying(false); }
    else { await synth.play(false); setPlaying(true); }
  });
  $('previous').onclick = act(() => step(-1));
  $('next').onclick = act(() => step(1));
  const skip = seconds => act(async () => {
    if (!current) return;
    const synth = await start(), position = (await status(synth)).position;
    await synth.seek(Math.min(Math.max(0, position + seconds), duration));
  });
  $('back').onclick = skip(-10);
  $('forward').onclick = skip(10);
  // While the user drags the slider the clock leaves it alone; focus alone does not hold it (a click leaves the
  // slider focused, and the bar then stood still).
  let dragging = false;
  $('seek').addEventListener('pointerdown', () => { dragging = true; });
  $('seek').addEventListener('pointerup', () => setTimeout(() => { dragging = false; }, 400));
  $('seek').addEventListener('input', () => { dragging = true; setRange($('seek'), $('seek').value); $('time').value = clock(Number($('seek').value)); });
  $('seek').onchange = act(async () => {
    try { if (current) await (await start()).seek(Number($('seek').value)); } finally { dragging = false; }
  });
  $('speed').onchange = act(async () => { await (await start()).setPlaybackRate(Number($('speed').value)); });
  $('volume').oninput = () => { volume = Number($('volume').value); muted = false; $('mute').setAttribute('aria-pressed', 'false'); setVolume(volume); };
  $('mute').onclick = () => { muted = !muted; $('mute').setAttribute('aria-pressed', String(muted)); setVolume(muted ? 0 : volume); };
  // The Sound Engine section: a button per engine, and its controls below it. The ROMs list holds the devices of the
  // user's files, dropped once (packs, ECW wavesets, Roland ROMs, an AWE card's local build) and chosen by name;
  // profile-files.js finds them. The page reads the
  // files here and sends them nowhere. A device that played is kept in this origin's private file system (OPFS), one per
  // profile, and listed on a later visit; a browser without OPFS plays the files and keeps none. packs[kind] is what a
  // WAV download of a profile renders with: the device that plays on it.
  const packs = {}, devices = new Map(), modules = {};
  // The device choices, one after another (choose, below), and the newest one not yet played.
  let queue = Promise.resolve(), latest = null;
  // roms.json (known ROM revisions) and packs.json (names of known files) load once, when files are first added.
  let known, catalog;
  const table = () => {
    known ??= fetch(new URL('roms.json', import.meta.url)).then(r => { if (!r.ok) throw new Error(`roms.json: HTTP ${r.status}`); return r.json(); });
    known.catch(() => { known = undefined; });
    return known;
  };
  // On a local server (scripts/serve.mjs) the AWE cards' local builds come with the page, so their packs play as they
  // are; GitHub Pages has none.
  const localModules = Promise.all(local.names.filter(name => /^awe(32|64)\.wasm$/.test(name)).map(async name =>
    [name.replace('.wasm', ''), new Uint8Array(await (await fetch(new URL(name, local.url))).arrayBuffer())]))
    .then(Object.fromEntries).catch(() => ({}));
  /** Every AWE pack of the list that has no module gets its card's, where one is known. */
  function completeModules() {
    for (const device of devices.values()) if (device.needs && modules[device.kind]) { device.sources.wasm = modules[device.kind]; delete device.needs; }
  }
  const store = openProfileStore().catch(() => undefined);
  // kept: the profiles whose files this browser keeps, for the Forget buttons; saved: the device of the list whose
  // files the store holds, by profile (one per profile).
  const storedKey = kind => `stored:${kind}`, kept = new Set(), saved = {};
  /** The ROMs list: the user's devices, the newest release first; the device that plays chosen, else the first. */
  function showDevices() {
    const all = [...devices.values()].sort(byYear), list = $('devices');
    list.replaceChildren(...all.map(d => {
      const option = new Option(d.needs ? `${d.name} (needs ${d.needs})` : d.name, d.key);
      option.disabled = Boolean(d.needs);
      return option;
    }));
    if (!all.length) { const empty = new Option('Drop your files to list their devices', ''); empty.disabled = true; list.append(empty); }
    list.value = (latest && devices.has(latest) ? latest : undefined) ?? loadedDevice[engineKind] ?? all.find(d => !d.needs)?.key ?? '';
    $('forget-files').hidden = !kept.size;
    $('forget-device').hidden = !devices.has(list.value);
  }
  showDevices(); markEngine(engineKind);
  store.then(s => s?.profiles()).then(kinds => {
    for (const kind of kinds ?? []) kept.add(kind);
    for (const kind of kinds ?? []) if (!devices.has(storedKey(kind))) {
      devices.set(storedKey(kind), { kind, key: storedKey(kind), stored: true, ...deviceName(deviceTable[kind], 'stored in this browser', PROFILE_DESCRIPTORS[kind].label) });
    }
    showDevices();
  }).catch(() => {});
  localModules.then(found => { Object.assign(modules, found); completeModules(); showDevices(); });
  async function addFiles(list) {
    const files = await readFiles(list);
    catalog ??= fetch(new URL('packs.json', import.meta.url)).then(r => r.ok ? r.json() : {}, () => ({}));
    const { devices: found, ignored, modules: built } = await devicesIn(files, PROFILE_DESCRIPTORS, table, await catalog, deviceTable);
    for (const device of found) devices.set(device.key, device);
    // An AWE card's local build, dropped with its packs or after them, completes every pack of that card.
    Object.assign(modules, await localModules, built); completeModules();
    showDevices(); showPanel('roms');
    message(`${found.length} device${found.length === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}${ignored.length ? `; not a device: ${ignored.join(', ')}` : ''}.`);
  }
  // The whole section takes dropped files, the list among it; Load pack… opens the file chooser.
  const section = $('sound-engine');
  section.ondragover = event => { event.preventDefault(); section.classList.add('dragging'); };
  section.ondragleave = event => { if (!section.contains(event.relatedTarget)) section.classList.remove('dragging'); };
  section.ondrop = event => { event.preventDefault(); section.classList.remove('dragging'); act(() => addFiles(event.dataTransfer.files))(); };
  $('load-pack').onclick = () => $('device-files').click();
  $('device-files').onchange = act(async () => { const chosen = [...$('device-files').files]; $('device-files').value = ''; if (chosen.length) await addFiles(chosen); });
  // An engine's button plays it: the Sound Blaster 16 on the chip it played last, the ROMs on the device chosen in
  // their list (the newest unless one played); with no device, the ROMs button shows the list to drop files on.
  const playEngine = engine => act(async () => {
    if (engine === 'roms') { showPanel('roms'); if ($('devices').value) await choose(); return; }
    const kind = engine === 'sb16' ? chip : 'soundfont';
    if (engineKind === kind) { showPanel(engine); return; }
    const synth = await start();
    pickedEngine = current?.album ?? album;
    await useEngine(synth, kind, pickedEngine);
  });
  for (const button of $('engine').querySelectorAll('.toggle')) button.onclick = playEngine(button.value);
  for (const button of $('engine-modes').querySelectorAll('.toggle')) button.onclick = act(async () => { chip = button.value; await playEngine('sb16')(); });
  // A device of the user's plays on its profile: loaded with its files, or loaded again with them when another device
  // of that profile played (a file plays on). Stored files that do not play are deleted, so they are not offered again.
  // A click on the chosen device plays it too (the first is chosen without a change). Choices load one after another,
  // since a profile takes no new sources while it loads, and a choice still waiting gives way to a newer one; the change
  // and click of one choice count once. latest is the newest choice not yet played, which the list keeps chosen.
  // Stored files are deleted only when they are gone or their core refuses them, not when the store is busy (another
  // tab saving them).
  const choose = () => {
    const key = $('devices').value;
    if (key === latest) return queue;
    latest = key;
    return (queue = queue.then(() => chooseDevice(key), () => chooseDevice(key)));
  };
  async function chooseDevice(key) {
    if (key !== latest) return;
    // Played or failed, it is no longer pending: the list shows the device that plays, unless a newer choice waits.
    try { await playDevice(key); } finally { if (latest === key) { latest = null; showDevices(); } }
  }
  async function playDevice(key) {
    const device = devices.get(key);
    if (!device || device.needs) return;
    if (loadedDevice[device.kind] === key && engineKind === device.kind) return;
    const synth = await start(), s = await store;
    pickedEngine = current?.album ?? album;
    let refused = false;
    try {
      if (device.stored && !device.sources) {
        device.sources = await s?.load(device.kind);
        if (!device.sources) { refused = true; throw new Error('they are no longer stored'); }
      }
      refused = true;
      await useEngine(synth, device.kind, pickedEngine, loadedDevice[device.kind] === key ? undefined : device.sources);
    } catch (error) {
      if (device.stored && refused) { await s?.remove(device.kind).catch(() => {}); devices.delete(key); kept.delete(device.kind); }
      showPanel('roms');
      throw new Error(device.stored && refused ? `Your stored files for ${engineName(device.kind)} did not play (${error.message}): drop them again` : error.message);
    }
    loadedDevice[device.kind] = key; packs[device.kind] = device.sources;
    if (s && !device.stored) {
      await s.save(device.kind, device.sources).then(() => {
        devices.delete(storedKey(device.kind)); kept.add(device.kind); saved[device.kind] = key;
        message(`${$('message').textContent} This browser keeps your files for later visits.`);
      }, error => message(`${engineName(device.kind)} plays, but this browser did not keep your files: ${error.message}`));
    }
    showDevices();
  }
  $('devices').onchange = act(choose);
  $('devices').onclick = act(choose);
  // Forget this device takes the chosen device off the list and, where this browser keeps its files (it was stored, or
  // it is the device of its profile that was saved), deletes them; the device that plays plays on until another is
  // chosen. The other devices and their stored files stay.
  $('forget-device').onclick = act(async () => {
    const key = $('devices').value, device = devices.get(key);
    if (!device) return;
    const keptHere = device.stored || saved[device.kind] === key, s = await store;
    if (keptHere && s) { await s.remove(device.kind); kept.delete(device.kind); delete saved[device.kind]; }
    devices.delete(key);
    if (loadedDevice[device.kind] === key) delete loadedDevice[device.kind];
    showDevices();
    message(`${device.name} is off the list${keptHere ? ', and this browser no longer keeps its files' : ''}.`);
  });
  // Forget asks the store, not this tab's list: another tab of the site may have stored a profile since this one loaded.
  $('forget-files').onclick = act(async () => {
    const s = await store;
    for (const kind of await s?.profiles() ?? []) await s.remove(kind);
    for (const [key, device] of devices) if (device.stored) devices.delete(key);
    kept.clear(); for (const kind in saved) delete saved[kind];
    showDevices(); message('Your files are no longer stored in this browser.');
  });
  showAlbum(album);

  // The visualizer: Bergium's Butterchurn pipeline, on by default, rotating through the presets of
  // demo/bergium-presets.json. It loads once audio runs, since it draws from the synthesizer's AudioContext.
  let visual;
  const chosen = () => $('visualizer').querySelector('[aria-pressed="true"]').value;
  async function showVisual(synth) {
    const kind = chosen();
    $('visual-panel').hidden = kind === 'off';
    if (kind !== 'off' && !visual) {
      const { Visualizer } = await import('./visualizer/visualizer.js');
      // Bergium hears the synthesizer before the volume slider, four times as loud, so quiet listening still moves it.
      const input = new GainNode(synth.context, { gain: VISUAL_GAIN });
      synth.source.connect(input);
      // Four CSS pixels per drawn pixel: the picture is pixelated, as on a DOS screen.
      visual ??= new Visualizer($('visual'), synth.context, input, name => { $('visual-name').textContent = name; }, 4);
      visual.onFrame = blocks();
    }
    if (visual && visual.pipeline !== (kind === 'off' ? undefined : kind)) await visual.use(kind);
  }
  /** Copies Bergium's frame into #visual-blocks at the display's resolution without smoothing, so its pixels stay hard
   *  blocks, and marks the copy changed: the CRT shader reads a canvas again only after a change to its subtree. */
  function blocks() {
    const from = $('visual'), to = $('visual-blocks'), paint = to.getContext('2d');
    let tick = 0;
    return () => {
      const width = Math.round(to.clientWidth * Math.min(devicePixelRatio || 1, 2)), height = Math.round(to.clientHeight * Math.min(devicePixelRatio || 1, 2));
      if (!width || !height) return;
      if (to.width !== width || to.height !== height) { to.width = width; to.height = height; }
      paint.imageSmoothingEnabled = false;
      paint.drawImage(from, 0, 0, width, height);
      to.dataset.frame = String(tick ^= 1);
    };
  }
  for (const button of $('visualizer').querySelectorAll('.toggle')) {
    button.onclick = act(async () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      for (const other of $('visualizer').querySelectorAll('.toggle')) other.setAttribute('aria-pressed', String(other === button));
      await showVisual(await start());
      if (current && button.value !== 'off') visual.title($('track-title').textContent);
    });
  }
  $('visual-next').onclick = () => visual?.next();

  // The clock: the position, the end of a track (the next one plays), and the background rain's speed from the analyser.
  setInterval(async () => {
    if (!current || busy) return;
    try {
      const synth = await start(), s = await status(synth);
      if (!dragging) setRange($('seek'), s.position);
      $('time').value = clock(s.position);
      if (s.ended && playing) {
        setPlaying(false);
        if (current.album) await step(1);
      }
    } catch (error) { message(error.message); }
  }, 250);
  const rain = $('page-rain'), wave = new Float32Array(2048), bins = new Uint8Array(1024);
  let shown = { level: 0, bass: 0 }, last = 0;
  (function meter(now) {
    requestAnimationFrame(meter);
    const node = analyser();
    if (!node || now - last < 90) return;
    last = now;
    node.getFloatTimeDomainData(wave.subarray(0, node.fftSize));
    node.getByteFrequencyData(bins.subarray(0, node.frequencyBinCount));
    let sum = 0;
    for (let i = 0; i < node.fftSize; i++) sum += wave[i] * wave[i];
    // Bins below about 250 Hz carry the bass line and the kick drum.
    const low = Math.max(1, Math.round(250 / (node.context.sampleRate / node.fftSize)));
    let bass = 0;
    for (let i = 0; i < low; i++) bass += bins[i];
    const level = Math.min(1, Math.sqrt(sum / node.fftSize) * 5), deep = Math.min(1, bass / low / 200);
    if (Math.abs(level - shown.level) > 0.02 || Math.abs(deep - shown.bass) > 0.02) {
      shown = { level, bass: deep };
      // The rain falls at 0.6 times its speed in silence and up to 3 times with loud music and a heavy bass.
      rain.dataset.level = level.toFixed(3);
      rain.dataset.speed = (0.6 + level * 1.6 + deep * 0.8).toFixed(2);
    }
  })(0);

  return {
    /** Plays a MIDI, RMI or MUS file of the user's. */
    playFile: (name, data) => load(data, name, null).then(() => {
      for (const input of $('tracks').querySelectorAll('input')) input.checked = false;
    }),
    /** Audio started (from any control): the bank list fills with the synthesizer's banks, the visualizer can draw. */
    started(synth) { showBank(synth); return showVisual(synth).catch(error => message(error.message)); },
    /** The volume slider follows the page's output gain (0 to 1). */
    volumeChanged(value) { volume = value; muted = false; setRange($('volume'), value); $('mute').setAttribute('aria-pressed', 'false'); },
    /** The engine buttons follow the synthesizer, after the user loaded a file into it: that engine holds for the album. */
    engineShown(synth) {
      pickedEngine = current?.album ?? album;
      markEngine(synth.info.kind); showBank(synth);
    },
    /** The profileSources the user loaded, by profile: a WAV download renders with the same ones. */
    get packs() { return packs; },
    get current() { return current; },
    get playing() { return playing; },
  };
}
