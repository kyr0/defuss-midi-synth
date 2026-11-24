// The page's progress bar (defuss-shadcn's Progress field, fixed at the bottom of the window): downloads of modules,
// SoundFonts and banks, their decompression, and WAV rendering. Files under 1 MB load too fast to need it.
const MB = 1024 * 1024;
const VERBS = { download: 'Downloading', decompress: 'Decompressing', render: 'Rendering' };

/** Returns the listener for the library's onProgress and the renderer's events, driving the field root. */
export function createProgress(root) {
  const label = root.querySelector('.progress-label'), value = root.querySelector('.progress-value'), bar = root.querySelector('progress');
  let hide = 0, shown = '', latest = null, frame = 0;
  function paint() {
    frame = 0;
    const { phase, url, loaded, total } = latest, name = decodeURIComponent(url.split('/').pop() || url);
    const text = `${VERBS[phase]} ${phase === 'render' ? `${name}.wav` : name}`;
    if (text !== shown) { label.textContent = shown = text; }
    if (total > 0) { bar.max = total; bar.value = loaded; } else bar.removeAttribute('value');
    value.textContent = phase === 'download'
      ? total > 0 ? `${(loaded / MB).toFixed(1)} / ${(total / MB).toFixed(1)} MB` : `${(loaded / MB).toFixed(1)} MB`
      : `${Math.round(loaded / Math.max(total, 1) * 100)}%`;
    root.dataset.phase = phase;
  }
  return progress => {
    if (progress.phase !== 'render' && Math.max(progress.total, progress.loaded) < MB) return;
    latest = progress;
    root.hidden = false;
    clearTimeout(hide);
    // The bar leaves once nothing follows a finished step: a decompression follows a compressed file's download.
    if (progress.total > 0 && progress.loaded >= progress.total) hide = setTimeout(() => { root.hidden = true; shown = ''; }, 700);
    frame ||= requestAnimationFrame(paint);
  };
}
