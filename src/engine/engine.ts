import { activeLayers, projectDuration, upcomingClips } from '../model/ops';
import { clipGain, rateAt } from '../model/timing';
import type { Asset, Clip } from '../model/types';
import { useEditor } from '../store';
import { clamp } from '../utils';
import { setLivePhotoReady } from './livePhoto';
import { cssFilterFor, renderFrame, type DirectPlacement, type DrawBox, type Source } from './render';
import { motionFor } from './render';

interface MediaEntry {
  el: HTMLVideoElement | HTMLAudioElement;
  assetId: string;
  gain?: GainNode;
  /** Positions the element when the preview shows it directly. */
  wrap?: HTMLDivElement;
}

/** How long the clock may wait for the leading video to start or catch up before running on regardless. */
const MAX_STALL_MS = 1200;

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
  /** Holds the directly displayed video under the preview canvas. */
  private directHost: HTMLDivElement | null = null;
  private directShown: MediaEntry | null = null;
  /** The preview's on-screen size, kept by an observer so frames never have to ask for layout. */
  private previewSize = { w: 0, h: 0 };
  private previewObserver: ResizeObserver | null = null;
  private stallMs = 0;
  /** Clips that hold a media element this frame; the rest are spares to reuse. */
  private claimed = new Set<string>();
  private lastLoop = 0;
  /**
   * Show the bottom video as a page element rather than copying every frame onto the canvas.
   * Copying is the slow part of playback on phones; desktops handle it fine, so it's on for touch devices.
   */
  directVideo = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  boxes: DrawBox[] = [];

  constructor() {
    if (typeof window === 'undefined') return;
    useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.currentTime !== prev.currentTime || s.assets !== prev.assets || s.selectedId !== prev.selectedId) {
        this.invalidate();
      }
    });
    requestAnimationFrame(this.loop);
    // Living-photo layers build in the background; redraw when they're ready.
    setLivePhotoReady(this.invalidate);
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
    this.previewObserver?.disconnect();
    this.previewObserver = null;
    if (canvas) {
      this.previewSize = { w: canvas.clientWidth, h: canvas.clientHeight };
      if (typeof ResizeObserver !== 'undefined') {
        this.previewObserver = new ResizeObserver(() => {
          this.previewSize = { w: canvas.clientWidth, h: canvas.clientHeight };
          this.invalidate();
        });
        this.previewObserver.observe(canvas);
      }
    }
    this.directHost?.remove();
    this.directHost = null;
    this.directShown = null;
    if (canvas?.parentElement) {
      const host = document.createElement('div');
      host.className = 'direct-host';
      canvas.parentElement.insertBefore(host, canvas);
      for (const entry of this.media.values()) if (entry.wrap) host.appendChild(entry.wrap);
      this.directHost = host;
    }
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
    this.stallMs = 0;
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

  private mediaFor(clip: Clip, asset: Asset, near = clip.inPoint): MediaEntry {
    let entry = this.media.get(clip.id);
    if (entry && entry.assetId === asset.id) return entry;
    if (entry) this.dispose(clip.id);
    // Reuse an element of the same file that no clip needs right now, preferring the one already
    // nearest the wanted spot. After a plain cut that's the element that was just playing, so the
    // next piece carries on without a seek or a restart (phones stutter on both), and an edited
    // timeline doesn't pile up one decoder per piece.
    let spare: string | null = null;
    for (const [id, e] of this.media) {
      if (e.assetId !== asset.id || this.claimed.has(id)) continue;
      if (spare === null || Math.abs(e.el.currentTime - near) < Math.abs(this.media.get(spare)!.el.currentTime - near)) spare = id;
    }
    if (spare !== null) {
      entry = this.media.get(spare)!;
      this.media.delete(spare);
      this.media.set(clip.id, entry);
      return entry;
    }
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

  /** Keeps the timeline where it is while the leading video starts or buffers, up to a limit. */
  private holdClock(t: number, dtMs: number) {
    this.stallMs += dtMs;
    if (this.stallMs > MAX_STALL_MS) return;
    this.clockStartTime = Math.max(0, t);
    this.clockStartWall = performance.now();
  }

  /** The bottom layer, if it's a video the page can show as is (nothing that only the canvas can draw). */
  private directCandidate(t: number): { clipId: string; entry: MediaEntry } | null {
    if (!this.directVideo || !this.directHost || this.exportCtx) return null;
    const { project } = useEditor.getState();
    const layer = activeLayers(project, t).find((l) => !l.track.hidden && l.track.kind !== 'audio' && l.clip.kind !== 'audio');
    if (!layer) return null;
    const { clip } = layer;
    if (clip.kind !== 'video' || clip.chroma || clip.spotlight || clip.adjust.vignette > 0 || layer.transition) return null;
    if (motionFor(layer).wipe !== null) return null;
    const entry = this.media.get(clip.id);
    if (!entry || !(entry.el instanceof HTMLVideoElement) || !entry.el.videoWidth) return null;
    return { clipId: clip.id, entry };
  }

  private placeDirect(entry: MediaEntry, p: DirectPlacement) {
    const canvas = this.preview;
    const host = this.directHost;
    if (!canvas || !host) return;
    const { settings } = useEditor.getState().project;
    const kx = this.previewSize.w / settings.width;
    const ky = this.previewSize.h / settings.height;
    let wrap = entry.wrap;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'direct-clip';
      wrap.appendChild(entry.el);
      entry.wrap = wrap;
    }
    if (wrap.parentElement !== host) host.appendChild(wrap);
    if (this.directShown && this.directShown !== entry && this.directShown.wrap) this.directShown.wrap.style.display = 'none';
    this.directShown = entry;
    host.style.background = settings.background;

    const c = p.clip.crop;
    const left = c?.left ?? 0;
    const top = c?.top ?? 0;
    const w = p.w * kx;
    const h = p.h * ky;
    const innerW = w / Math.max(0.01, 1 - left - (c?.right ?? 0));
    const innerH = h / Math.max(0.01, 1 - top - (c?.bottom ?? 0));
    const flip = p.clip.flipH || p.clip.flipV ? ` scale(${p.clip.flipH ? -1 : 1},${p.clip.flipV ? -1 : 1})` : '';
    setStyle(wrap, {
      display: 'block',
      left: `${p.cx * kx - w / 2}px`,
      top: `${p.cy * ky - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: p.rotation ? `rotate(${p.rotation}deg)` : '',
      opacity: p.alpha < 1 ? String(p.alpha) : '',
    });
    setStyle(entry.el as HTMLVideoElement, {
      left: `${-left * innerW}px`,
      top: `${-top * innerH}px`,
      width: `${innerW}px`,
      height: `${innerH}px`,
      // Flip around the visible frame's centre, as the canvas does.
      transformOrigin: `${left * innerW + w / 2}px ${top * innerH + h / 2}px`,
      transform: flip,
      filter: cssFilterFor(p.clip, p.extraBlur, kx) === 'none' ? '' : cssFilterFor(p.clip, p.extraBlur, kx),
    });
  }

  private hideDirect() {
    if (this.directShown?.wrap) this.directShown.wrap.style.display = 'none';
    this.directShown = null;
    if (this.directHost) this.directHost.style.background = '';
  }

  private dispose(clipId: string) {
    const entry = this.media.get(clipId);
    if (!entry) return;
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
    entry.gain?.disconnect();
    entry.wrap?.remove();
    if (this.directShown === entry) this.directShown = null;
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
    if (clip.kind === 'image' || (clip.kind === 'graphic' && asset.kind === 'image')) return this.imageFor(asset);
    if (clip.kind === 'video' || (clip.kind === 'graphic' && asset.kind === 'video')) return this.mediaFor(clip, asset).el as HTMLVideoElement;
    return null;
  };

  private getImage = (assetId: string): CanvasImageSource | null => {
    const asset = useEditor.getState().assets[assetId];
    if (!asset || asset.kind !== 'image') return null;
    const img = this.imageFor(asset);
    return img.complete && img.naturalWidth ? img : null;
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
  private sync(t: number, playing: boolean, dtMs = 0) {
    const { project, assets } = useEditor.getState();
    const fps = project.settings.fps;
    const live = new Set<string>();
    const layers = activeLayers(project, t);
    let led = false;
    const isMedia = (clip: Clip) => {
      const asset = clip.assetId ? assets[clip.assetId] : undefined;
      return !!asset && (clip.kind === 'video' || clip.kind === 'audio' || (clip.kind === 'graphic' && asset.kind === 'video'));
    };
    // Upcoming clips that continue what's playing (the next piece after a cut) inherit its element
    // instead of pre-rolling their own.
    const upcoming = upcomingClips(project, t).filter((u) => {
      if (!isMedia(u)) return false;
      const continues = layers.some(
        (l) => l.clip.assetId === u.assetId && Math.abs(l.sourceTime + (u.start - t) * rateAt(l.clip, l.local) - u.inPoint) < 0.3,
      );
      // An element it was given earlier (say while paused here) becomes a spare.
      const own = this.media.get(u.id);
      if (continues && own) {
        this.media.delete(u.id);
        this.media.set(`~${u.id}`, own);
      }
      return !continues;
    });
    this.claimed = new Set([...layers.filter((l) => isMedia(l.clip)).map((l) => l.clip.id), ...upcoming.map((c) => c.id)]);

    for (const layer of layers) {
      const { clip, track } = layer;
      const asset = clip.assetId ? assets[clip.assetId] : undefined;
      // Graphics showing a player's clip play it like a (silent) video clip.
      if (clip.kind !== 'video' && clip.kind !== 'audio' && !(clip.kind === 'graphic' && asset?.kind === 'video')) continue;
      if (!asset) continue;
      const entry = this.mediaFor(clip, asset, layer.sourceTime);
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
        // The first playing video leads: the clock follows it, rather than the video being forced
        // to follow the clock. Seeking a video that has fallen behind makes it stall and fall
        // further behind, which is what made playback stutter on phones.
        const leads = !led && clip.kind === 'video' && layer.transition?.role !== 'out';
        if (leads) led = true;
        if (el.paused) {
          const off = target - el.currentTime;
          if (leads && Math.abs(off) < 0.5 * rate) {
            // Only just behind (a slow first frame after Play): wind the clock back to the video
            // rather than seeking it, since a seek stalls the start on phones.
            this.holdClock(t - off / rate, dtMs);
          } else {
            if (Math.abs(off) > 0.05) el.currentTime = target;
            if (leads) this.holdClock(t, dtMs);
          }
          void el.play().catch(() => {});
        } else if (leads) {
          const drift = el.currentTime - target;
          if (Math.abs(drift) > 1.5 * Math.max(1, rate)) {
            el.currentTime = target;
          } else if (el.seeking) {
            this.holdClock(t, dtMs);
          } else {
            this.stallMs = 0;
            // Ease the clock toward the video so the timeline never jumps.
            if (Math.abs(drift) > 0.03) this.clockStartTime += (drift / rate) * 0.2;
          }
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
    for (const clip of upcoming) {
      const asset = assets[clip.assetId!];
      const entry = this.mediaFor(clip, asset);
      live.add(clip.id);
      if (!entry.el.paused) entry.el.pause();
      if (!entry.el.seeking && Math.abs(entry.el.currentTime - clip.inPoint) > 0.05) entry.el.currentTime = clip.inPoint;
      this.setGain(entry, 0);
    }

    // Keep one spare element per file (the likeliest to be reused) and release the rest.
    const spares = new Set<string>();
    for (const [id, entry] of this.media) {
      if (live.has(id)) continue;
      if (!assets[entry.assetId] || spares.has(entry.assetId)) {
        this.dispose(id);
        continue;
      }
      spares.add(entry.assetId);
      if (!entry.el.paused) entry.el.pause();
      this.setGain(entry, 0);
    }
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dtMs = this.lastLoop ? Math.min(100, now - this.lastLoop) : 0;
    this.lastLoop = now;
    const state = useEditor.getState();
    let t = state.currentTime;
    if (state.playing) {
      // A frame's timestamp can predate a clock reset made since (Play, a seek), so never run backwards.
      t = this.clockStartTime + Math.max(0, now - this.clockStartWall) / 1000;
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
    const project = useEditor.getState().project;
    // Clips end exactly at the timeline's end, so the very end would show an empty canvas.
    // Hold the last frame there instead, as players do.
    const end = projectDuration(project);
    const shown = !this.exportCtx && end > 0 && t >= end ? Math.max(0, end - 0.5 / project.settings.fps) : t;
    this.sync(shown, playing, dtMs);
    if (!playing && !this.exportCtx && this.dirtyFrames <= 0) return;
    this.dirtyFrames--;
    if (this.preview) {
      const ctx = this.preview.getContext('2d');
      const direct = this.directCandidate(shown);
      let placed: MediaEntry | null = null;
      if (ctx) {
        this.boxes = renderFrame(ctx, project, shown, {
          getSource: this.getSource,
          getImage: this.getImage,
          direct: direct
            ? {
                clipId: direct.clipId,
                place: (p) => {
                  this.placeDirect(direct.entry, p);
                  placed = direct.entry;
                },
              }
            : undefined,
        });
      }
      if (!placed) this.hideDirect();
    }
    if (this.exportCtx) renderFrame(this.exportCtx, project, t, { getSource: this.getSource, getImage: this.getImage });
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

/** Writes inline styles only when they change, to avoid needless style work every frame. */
function setStyle(el: HTMLElement, styles: Partial<Record<'display' | 'left' | 'top' | 'width' | 'height' | 'transform' | 'transformOrigin' | 'opacity' | 'filter', string>>) {
  for (const [k, v] of Object.entries(styles) as [keyof typeof styles, string][]) {
    if (el.style[k] !== v) el.style[k] = v;
  }
}
