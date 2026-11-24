// The demo page's visualizer: bergium's low-level createVisualizer (vendor/bergium) on one canvas, fed by the
// synthesizer's output, with its Geiss and Milkdrop (Butterchurn) pipelines. scripts/build.mjs bundles this file into
// docs/visualizer/ with the Milkdrop presets the page rotates through.
import { createVisualizer } from '../vendor/bergium/src/api/createVisualizer.ts';
import { GeissAdapter } from '../vendor/bergium/src/adapters/GeissAdapter.ts';
import type { BergiumVisualizer } from '../vendor/bergium/src/api/types.ts';
import type { Preset } from '../vendor/bergium/src/presets/types.ts';

export type Pipeline = 'geiss' | 'milkdrop';
interface Entry { name: string; preset: unknown }
/** Both pipelines move on every 30 s, as bergium's BergiumPlayer does. */
const CYCLE_SECONDS = 30;

/** The Milkdrop presets the build put beside this module (docs/visualizer/presets.json from demo/bergium-presets.json). */
async function milkdropPresets(): Promise<Entry[]> {
  const response = await fetch(new URL('./presets.json', import.meta.url));
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status} for the visualizer's presets`);
  return await response.json() as Entry[];
}

/**
 * One canvas, one pipeline at a time. use() destroys the running pipeline and starts the other on the same canvas
 * (as bergium's BergiumPlayer does); the canvas follows its box at up to 1.5 device pixels per CSS pixel.
 */
export class Visualizer {
  private viz?: BergiumVisualizer;
  private kind?: Pipeline;
  private presets?: Entry[];
  private index = 0;
  private raf = 0;
  private frames = 0;
  private shown = 0;
  private visible = true;
  /** Runs after each drawn frame, while the canvas still holds it: a page can copy or post-process the frame. */
  onFrame?: () => void;
  private readonly resizer = new ResizeObserver(() => this.resize());
  private readonly watcher = new IntersectionObserver(entries => { this.visible = entries.some(e => e.isIntersecting); });

  /** pixel: CSS pixels per drawn pixel; above 1 the pipeline draws fewer pixels, which the canvas's CSS
   *  (image-rendering: pixelated) scales up as blocks. 1 draws at the display's resolution, up to 1.5 device pixels. */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly context: AudioContext, private readonly source: AudioNode,
    private readonly changed: (name: string) => void = () => undefined, private readonly pixel = 1) {
    this.resizer.observe(canvas);
    this.watcher.observe(canvas);
  }
  /** The pipeline that draws, if any. */
  get pipeline(): Pipeline | undefined { return this.kind; }
  /** The Milkdrop preset or the Geiss mode on screen. */
  get name(): string {
    if (this.viz instanceof GeissAdapter) return `Geiss mode ${this.viz.getMode()} of 9`;
    return this.presets?.[this.index]?.name ?? '';
  }
  /** Starts pipeline on the canvas, or stops drawing for 'off'. */
  async use(pipeline: Pipeline | 'off'): Promise<void> {
    cancelAnimationFrame(this.raf);
    this.viz?.disconnectAudio(); this.viz?.destroy(); this.viz = undefined; this.kind = undefined;
    if (pipeline === 'off') return;
    if (pipeline === 'milkdrop') this.presets ??= await milkdropPresets();
    const { width, height } = this.size();
    const viz = createVisualizer(this.context, this.canvas, { pipeline, width, height, onlyUseWASM: false });
    viz.connectAudio(this.source);
    if (viz instanceof GeissAdapter) {
      viz.setAutoMode(true); viz.setAutoCycleSeconds(CYCLE_SECONDS); viz.setEffect('chasers', true);
    } else viz.loadPreset(this.presets![this.index]!.preset as Preset, 0);
    this.viz = viz; this.kind = pipeline;
    this.changed(this.name);
    this.shown = performance.now();
    let mode = viz instanceof GeissAdapter ? viz.getMode() : 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.visible) return;
      viz.render();
      // Geiss changes its mode itself; Milkdrop's presets change here.
      if (viz instanceof GeissAdapter) { if (viz.getMode() !== mode) { mode = viz.getMode(); this.changed(this.name); } }
      else if (now - this.shown > CYCLE_SECONDS * 1000) this.next();
      this.onFrame?.();
      if (++this.frames % 30 === 0) this.canvas.dataset.frames = String(this.frames);
    };
    this.raf = requestAnimationFrame(loop);
  }
  /** The next Milkdrop preset (blended over 2.7 s, as Butterchurn's demo does) or the next Geiss mode. */
  next(): void {
    if (this.viz instanceof GeissAdapter) this.viz.nextMode();
    else if (this.viz && this.presets) {
      this.index = (this.index + 1) % this.presets.length;
      this.viz.loadPreset(this.presets[this.index]!.preset as Preset, 2.7);
    }
    this.shown = performance.now();
    this.changed(this.name);
  }
  /** Shows a song title over the picture. */
  title(text: string): void { this.viz?.launchSongTitleAnim(text); }
  private size(): { width: number; height: number } {
    const ratio = this.pixel > 1 ? 1 / this.pixel : Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(64, Math.round(this.canvas.clientWidth * ratio)), height = Math.max(48, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    return { width, height };
  }
  private resize(): void {
    const { width, height } = this.size();
    this.viz?.setRendererSize(width, height);
  }
  /** Stops drawing and releases the pipeline and the observers. */
  destroy(): void {
    void this.use('off');
    this.resizer.disconnect(); this.watcher.disconnect();
  }
}
