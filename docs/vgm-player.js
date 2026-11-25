// Each selection renders off the UI thread. A superseded selection releases its worker and PCM immediately.
export function createOplPlayer(readWasm, progress) {
  let module, audio, output, url;
  async function render(recording, name, signal) {
    module ??= readWasm(new URL('./soundcards/vgm-opl.wasm', import.meta.url)).then(bytes => WebAssembly.compile(bytes))
      .catch(error => { module = undefined; throw error; });
    const compiled = await module;
    signal?.throwIfAborted();
    const worker = new Worker(new URL('./vgm-worker.js', import.meta.url), { type: 'module' });
    let abort;
    try {
      const wav = await new Promise((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        worker.onerror = e => reject(new Error(e.message));
        worker.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          else if (data.wav) resolve(data.wav);
          else progress({ phase: 'render', url: name, loaded: data.loaded, total: data.total });
        };
        worker.postMessage({ recording, module: compiled });
      });
      return new Blob([wav], { type: 'audio/wav' });
    } finally {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      progress({ phase: 'finish', url: name });
    }
  }
  function close() {
    if (!audio) return;
    audio.pause(); output.disconnect();
    audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
    audio = undefined;
  }
  return {
    render, close,
    load(blob, input, rate) {
      close();
      audio = new Audio(); url = URL.createObjectURL(blob); audio.src = url; audio.playbackRate = rate;
      output = input.context.createMediaElementSource(audio); output.connect(input);
    },
    play() { if (audio.ended) audio.currentTime = 0; return audio.play(); },
    pause() { audio.pause(); },
    seek(time) { audio.currentTime = time; },
    setPlaybackRate(rate) { audio.playbackRate = rate; },
    status() { return { position: audio.currentTime, ended: audio.ended }; },
  };
}
