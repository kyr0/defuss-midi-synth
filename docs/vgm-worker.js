import { renderOpl } from './vgm-render.js';
self.onmessage = async ({ data: { recording, module } }) => {
  try {
    const raw = await new Response(new Blob([recording]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const core = (await WebAssembly.instantiate(module)).exports;
    const wav = renderOpl(new Uint8Array(raw), core, (loaded, total) => self.postMessage({ loaded, total }));
    self.postMessage({ wav }, [wav]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
