import { activeLayers, projectDuration, upcomingClips } from '../model/ops';
import { clipGain, rateAt } from '../model/timing';
import type { Asset, Clip } from '../model/types';
import { useEditor } from '../store';
import { clamp } from '../utils';
import { renderFrame, type DrawBox, type Source } from './render';

interface MediaEntry {
  el: HTMLVideoElement | HTMLAudioElement;
  assetId: string;
  gain?: GainNode;
}

type FrameListener = (boxes: DrawBox[]) => void;

export interface ExportOptions {
  /** Output size of the shorter side, e.g. 1080. */
  shortSide: number;
  fps: number;
  bitrate: number;
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

/**
 * Owns playback: the clock, one media element per clip, the Web Audio graph and the
 * render loop that composites into the preview (and, while exporting, the export canvas).
 */
class Engine {
  private media = new Map<string, MediaEntry>();
  private images = new Map<string, HTMLImageElement>();
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private preview: HTMLCanvasElement | null = null;
  private exportCtx: CanvasRenderingContext2D | null = null;
  private clockStartWall = 0;
  private clockStartTime = 0;
  private dirtyFrames = 10;
  private listeners = new Set<FrameListener>();
  private onEnded: (() => void) | null = null;
  boxes: DrawBox[] = [];

  constructor() {
    if (typeof window === 'undefined') return;
    useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.currentTime !== prev.currentTime || s.assets !== prev.assets || s.selectedId !== prev.selectedId) {
        this.invalidate();
      }
    });
    requestAnimationFrame(this.loop);
    // Web fonts arrive after first paint; redraw text once they do.
    document.fonts?.addEventListener?.('loadingdone', this.invalidate);
    void document.fonts?.load?.('800 40px "Big Shoulders Display"').then(this.invalidate, () => {});
  }

  /** Silences the speakers (not the export mix), e.g. while recording a voiceover. */
  setMonitorMuted(muted: boolean) {
    this.ensureAudio();
    if (this.master && this.audioCtx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.audioCtx.currentTime, 0.02);
  }

  invalidate = () => {
    this.dirtyFrames = Math.max(this.dirtyFrames, 8);
  };

  setPreviewCanvas(canvas: HTMLCanvasElement | null) {
    this.preview = canvas;
    this.invalidate();
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- transport ----------

  get playing() {
    return useEditor.getState().playing;
  }

  play() {
    const s = useEditor.getState();
    const dur = projectDuration(s.project);
    if (dur <= 0) return;
    this.ensureAudio();
    let t = s.currentTime;
    if (t >= dur - 0.01) t = 0;
    this.clockStartTime = t;
    this.clockStartWall = performance.now();
    useEditor.setState({ playing: true, currentTime: t });
  }

  pause() {
    useEditor.setState({ playing: false });
    for (const m of this.media.values()) m.el.pause();
    this.invalidate();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const s = useEditor.getState();
    const dur = projectDuration(s.project);
    t = clamp(t, 0, Math.max(0, dur));
    this.clockStartTime = t;
    this.clockStartWall = performance.now();
    useEditor.setState({ currentTime: t });
  }

  stepFrames(n: number) {
    if (this.playing) this.pause();
    const fps = useEditor.getState().project.settings.fps;
    const t = useEditor.getState().currentTime;
    this.seek(Math.round(t * fps + n) / fps);
  }

  // ---------- audio ----------

  private ensureAudio() {
    if (!this.audioCtx) {
      const ctx = new AudioContext();
      this.audioCtx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.recordDest = ctx.createMediaStreamDestination();
      this.master.connect(this.recordDest);
      for (const entry of this.media.values()) this.route(entry);
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
  }

  private route(entry: MediaEntry) {
    if (!this.audioCtx || !this.master || entry.gain) return;
    try {
      const src = this.audioCtx.createMediaElementSource(entry.el);
      const gain = this.audioCtx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      entry.gain = gain;
      entry.el.muted = false;
    } catch (err) {
      console.warn('Audio routing failed', err);
    }
  }

  private setGain(entry: MediaEntry, value: number) {
    if (!entry.gain || !this.audioCtx) return;
    const g = entry.gain.gain;
    if (Math.abs(g.value - value) > 0.001) g.setTargetAtTime(value, this.audioCtx.currentTime, 0.015);
  }

  // ---------- media elements ----------

  private mediaFor(clip: Clip, asset: Asset): MediaEntry {
    let entry = this.media.get(clip.id);
    if (entry && entry.assetId === asset.id) return entry;
    if (entry) this.dispose(clip.id);
    const el = document.createElement(asset.kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.preload = 'auto';
    el.muted = true;
    el.playsInline = true;
    // Export resamples audio for speed changes (pitch follows speed); keep the preview identical.
    el.preservesPitch = false;
    el.src = asset.url;
    el.addEventListener('seeked', this.invalidate);
    el.addEventListener('loadeddata', this.invalidate);
    // iOS Safari loads no frames until a video has played, so a paused preview would stay blank.
    el.addEventListener(
      'loadedmetadata',
      () => {
        if (el.readyState >= 2 || !el.paused || this.playing) return;
        el.play()
          .then(() => {
            if (!this.playing) el.pause();
            this.invalidate();
          })
          .catch(() => {});
      },
      { once: true },
    );
    entry = { el, assetId: asset.id };
    this.media.set(clip.id, entry);
    this.route(entry);
    return entry;
  }

  private dispose(clipId: string) {
    const entry = this.media.get(clipId);
    if (!entry) return;
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
    entry.gain?.disconnect();
    this.media.delete(clipId);
  }

  private imageFor(asset: Asset): HTMLImageElement {
    let img = this.images.get(asset.id);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.onload = this.invalidate;
      img.src = asset.url;
      this.images.set(asset.id, img);
    }
    return img;
  }

  private getSource = (clip: Clip): Source | null => {
    const asset = clip.assetId ? useEditor.getState().assets[clip.assetId] : undefined;
    if (!asset) return null;
    if (clip.kind === 'image') return this.imageFor(asset);
    if (clip.kind === 'video') return this.mediaFor(clip, asset).el as HTMLVideoElement;
    return null;
  };

  /**
   * Colour of the selected clip's source at fractional position (fx, fy) of its displayed (cropped) frame,
   * read from the unprocessed media so an active key doesn't hide the colour being picked.
   */
  sampleColor(clip: Clip, fx: number, fy: number): string | null {
    const src = this.getSource(clip);
    if (!src) return null;
    const [iw, ih] = src instanceof HTMLVideoElement ? [src.videoWidth, src.videoHeight] : src instanceof HTMLImageElement ? [src.naturalWidth, src.naturalHeight] : [src.width, src.height];
    if (!iw || !ih) return null;
    const c = clip.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const x = clip.flipH ? 1 - fx : fx;
    const y = clip.flipV ? 1 - fy : fy;
    const sx = Math.floor((c.left + x * (1 - c.left - c.right)) * iw);
    const sy = Math.floor((c.top + y * (1 - c.top - c.bottom)) * ih);
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true })!;
    // Average a small patch to avoid picking a noisy pixel.
    ctx.drawImage(src, Math.max(0, sx - 3), Math.max(0, sy - 3), 7, 7, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /** Bring every media element in line with the timeline at time `t`. */
  private sync(t: number, playing: boolean) {
    const { project, assets } = useEditor.getState();
    const fps = project.settings.fps;
    const live = new Set<string>();
    const layers = activeLayers(project, t);

    for (const layer of layers) {
      const { clip, track } = layer;
      if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
      const asset = clip.assetId ? assets[clip.assetId] : undefined;
      if (!asset) continue;
      const entry = this.mediaFor(clip, asset);
      live.add(clip.id);
      const el = entry.el;
      const end = Math.max(0, asset.duration - 0.01);
      const target = clamp(layer.sourceTime, 0, end);
      // Outgoing transition clips keep playing into their handles; holds and exhausted media freeze.
      const rawRate = rateAt(clip, layer.local);
      const running = playing && rawRate > 0 && layer.sourceTime < end;
      if (running) {
        const rate = clamp(rawRate, 0.0625, 16);
        if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate;
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          void el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.25 * Math.max(1, rate)) {
          el.currentTime = target;
        }
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target;
      }

      let gain = running && !track.muted ? clipGain(clip, Math.min(layer.local, clip.duration)) : 0;
      // Crossfade the sound under a transition.
      if (layer.transition) gain *= layer.transition.role === 'out' ? 1 - layer.transition.progress : layer.transition.progress;
      this.setGain(entry, gain);
    }

    // Pre-roll clips that are about to start so the cut is seamless.
    for (const clip of upcomingClips(project, t)) {
      if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
      const asset = clip.assetId ? assets[clip.assetId] : undefined;
      if (!asset) continue;
      const entry = this.mediaFor(clip, asset);
      live.add(clip.id);
      if (!entry.el.paused) entry.el.pause();
      if (!entry.el.seeking && Math.abs(entry.el.currentTime - clip.inPoint) > 0.05) entry.el.currentTime = clip.inPoint;
      this.setGain(entry, 0);
    }

    const existing = new Set(project.clips.map((c) => c.id));
    for (const [id, entry] of this.media) {
      if (!existing.has(id)) {
        this.dispose(id);
      } else if (!live.has(id)) {
        if (!entry.el.paused) entry.el.pause();
        this.setGain(entry, 0);
      }
    }
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const state = useEditor.getState();
    let t = state.currentTime;
    if (state.playing) {
      t = this.clockStartTime + (now - this.clockStartWall) / 1000;
      const dur = projectDuration(state.project);
      if (t >= dur) {
        t = dur;
        useEditor.setState({ currentTime: t, playing: false });
        for (const m of this.media.values()) m.el.pause();
        const done = this.onEnded;
        this.onEnded = null;
        done?.();
      } else {
        useEditor.setState({ currentTime: t });
      }
    }
    const playing = useEditor.getState().playing;
    this.sync(t, playing);
    if (!playing && !this.exportCtx && this.dirtyFrames <= 0) return;
    this.dirtyFrames--;
    const project = useEditor.getState().project;
    if (this.preview) {
      const ctx = this.preview.getContext('2d');
      if (ctx) this.boxes = renderFrame(ctx, project, t, { getSource: this.getSource });
    }
    if (this.exportCtx) renderFrame(this.exportCtx, project, t, { getSource: this.getSource });
    for (const fn of this.listeners) fn(this.boxes);
  };

  // ---------- export ----------

  static pickMimeType(): string {
    const candidates = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
  }

  async export(opts: ExportOptions): Promise<{ blob: Blob; mime: string }> {
    const { project } = useEditor.getState();
    const duration = projectDuration(project);
    if (duration <= 0) throw new Error('The timeline is empty.');
    const mime = Engine.pickMimeType();
    if (!mime) throw new Error('This browser cannot record video. Try a recent Chrome, Edge or Firefox.');

    this.pause();
    this.ensureAudio();
    const { width: W, height: H } = project.settings;
    const s = opts.shortSide / Math.min(W, H);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((W * s) / 2) * 2;
    canvas.height = Math.round((H * s) / 2) * 2;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    // Park the playhead at zero and give media a moment to seek and buffer.
    this.seek(0);
    this.exportCtx = ctx;
    await this.waitForMedia(4000);

    const stream = canvas.captureStream(opts.fps);
    const tracks = [...stream.getVideoTracks(), ...(this.recordDest?.stream.getAudioTracks() ?? [])];
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      videoBitsPerSecond: opts.bitrate,
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    const finished = new Promise<void>((resolve) => (this.onEnded = resolve));
    const unsub = useEditor.subscribe((st) => opts.onProgress(Math.min(1, st.currentTime / duration)));
    const abort = () => this.pause();
    opts.signal.addEventListener('abort', abort);

    try {
      recorder.start(250);
      this.play();
      await Promise.race([finished, new Promise<void>((r) => opts.signal.addEventListener('abort', () => r()))]);
      // Let the final frame land in the stream.
      await new Promise((r) => setTimeout(r, 120));
      recorder.stop();
      await stopped;
    } finally {
      this.exportCtx = null;
      this.onEnded = null;
      unsub();
      opts.signal.removeEventListener('abort', abort);
      stream.getTracks().forEach((tr) => tr.stop());
    }
    if (opts.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime };
  }

  private async waitForMedia(timeoutMs: number) {
    const start = performance.now();
    // Allow the loop one frame to create elements and issue seeks.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    while (performance.now() - start < timeoutMs) {
      const pending = [...this.media.values()].some((m) => m.el.seeking || m.el.readyState < 2);
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

export const engine = new Engine();
export { Engine };
