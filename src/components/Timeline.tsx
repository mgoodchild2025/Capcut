import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addAssetToTimeline,
  deleteSelected,
  duplicateSelected,
  importFiles,
  splitAtPlayhead,
} from '../actions';
import { engine } from '../engine/engine';
import { WAVEFORM_RATE } from '../engine/media';
import { clipEnd, moveClip, projectDuration, snapOffset, snapPoints, trimClip } from '../model/ops';
import { FILTERS, TRANSITIONS } from '../model/presets';
import type { Asset, Clip, Track } from '../model/types';
import { beginGesture, commit, edit, endGesture, redo, select, undo, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { clamp, formatTimecode } from '../utils';
import { useIsMobile } from '../ui/useMediaQuery';
import { ASSET_MIME } from './Library';

const HEAD_W_DESKTOP = 132;
const HEAD_W_PHONE = 52;
const RULER_H = 28;
const MIN_PPS = 4;
const MAX_PPS = 480;
const SNAP_PX = 8;

const rowHeight = (t: Track) => (t.kind === 'audio' ? 46 : t.kind === 'text' ? 34 : t.main ? 68 : 56);

interface DragState {
  clipId: string;
  mode: 'move' | 'trim-start' | 'trim-end';
  pointerX: number;
  pointerY: number;
  origStart: number;
  origEnd: number;
  /** Ghost position while moving. */
  start: number;
  targetTrackId: string | null;
  ghostTop: number;
  moved: boolean;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const pps = useEditor((s) => s.pxPerSec);
  const phone = useIsMobile();
  const HEAD_W = phone ? HEAD_W_PHONE : HEAD_W_DESKTOP;
  // Long-lived listeners read the current width through this ref.
  const headRef = useRef(HEAD_W);
  headRef.current = HEAD_W;
  const selectedId = useEditor((s) => s.selectedId);
  const snapping = useEditor((s) => s.snapping);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{ x: number; top: number; height: number } | null>(null);

  const duration = projectDuration(project);
  const contentSeconds = Math.max(duration + 20, view.width / pps);
  const contentWidth = HEAD_W + contentSeconds * pps;

  const trackNames = useMemo(() => {
    const counts: Record<string, number> = {};
    const names: Record<string, string> = {};
    // Number from the bottom up so "Overlay 1" sits just above the main track.
    for (let i = project.tracks.length - 1; i >= 0; i--) {
      const t = project.tracks[i];
      if (t.main) {
        names[t.id] = 'Main';
        continue;
      }
      if (t.captions) {
        names[t.id] = 'Captions';
        continue;
      }
      counts[t.kind] = (counts[t.kind] ?? 0) + 1;
      const base = t.kind === 'video' ? 'Overlay' : t.kind === 'text' ? 'Text' : 'Audio';
      names[t.id] = `${base} ${counts[t.kind]}`;
    }
    return names;
  }, [project.tracks]);

  // Keep viewport metrics for the ruler and auto-scroll.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Follow the playhead while playing.
  useEffect(
    () =>
      useEditor.subscribe((s) => {
        if (!s.playing) return;
        const el = scrollRef.current;
        if (!el) return;
        const head = headRef.current;
        const x = head + s.currentTime * s.pxPerSec;
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + head) {
          el.scrollLeft = x - head - 40;
        }
      }),
    [],
  );

  // Ctrl/Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left + el.scrollLeft - headRef.current;
      const old = useEditor.getState().pxPerSec;
      const t = x / old;
      const next = clamp(old * Math.exp(-e.deltaY * 0.0015), MIN_PPS, MAX_PPS);
      useEditor.setState({ pxPerSec: next });
      requestAnimationFrame(() => (el.scrollLeft = t * next + headRef.current - (e.clientX - r.left)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Two-finger pinch zooms the timeline around the midpoint between the fingers.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { d0: number; pps0: number; t: number; x: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const r = el.getBoundingClientRect();
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const pps0 = useEditor.getState().pxPerSec;
      pinch = { d0: dist(e.touches) || 1, pps0, x, t: (x + el.scrollLeft - headRef.current) / pps0 };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const next = clamp((pinch.pps0 * dist(e.touches)) / pinch.d0, MIN_PPS, MAX_PPS);
      useEditor.setState({ pxPerSec: next });
      const p = pinch;
      requestAnimationFrame(() => (el.scrollLeft = p.t * next + headRef.current - p.x));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      return Math.max(0, (clientX - r.left + el.scrollLeft - HEAD_W) / pps);
    },
    [pps],
  );

  /** Track under a client Y coordinate, plus its row top in content coordinates. */
  const trackAtClientY = (clientY: number): { trackId: string | null; top: number; height: number } => {
    const content = contentRef.current!;
    const cr = content.getBoundingClientRect();
    const rows = content.querySelectorAll<HTMLElement>('[data-track-id]');
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) {
        return { trackId: row.dataset.trackId!, top: r.top - cr.top, height: r.height };
      }
    }
    const first = rows[0]?.getBoundingClientRect();
    const last = rows[rows.length - 1]?.getBoundingClientRect();
    if (first && clientY < first.top) return { trackId: null, top: first.top - cr.top - 24, height: 24 };
    return { trackId: null, top: last ? last.bottom - cr.top + 4 : RULER_H, height: 40 };
  };

  // ---------- scrubbing ----------
  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const wasPlaying = engine.playing;
    if (wasPlaying) engine.pause();
    engine.seek(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => engine.seek(timeAtClientX(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---------- clip drag / trim ----------
  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // On touch, a clip must be selected (by tapping) before it can be dragged or trimmed, so
    // swiping across clips still scrolls the timeline.
    if (e.pointerType === 'touch' && useEditor.getState().selectedId !== clip.id) return;
    select(clip.id);
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    const rowInfo = trackAtClientY(e.clientY);
    const state: DragState = {
      clipId: clip.id,
      mode,
      pointerX: e.clientX,
      pointerY: e.clientY,
      origStart: clip.start,
      origEnd: clipEnd(clip),
      start: clip.start,
      targetTrackId: clip.trackId,
      ghostTop: rowInfo.top,
      moved: false,
    };
    beginGesture();
    setDrag(state);
    let latest = state;

    const base = useEditor.getState().project;
    const playhead = useEditor.getState().currentTime;
    const points = snapPoints(base, clip.id, playhead);
    const asset = clip.assetId ? useEditor.getState().assets[clip.assetId] : undefined;

    const move = (ev: PointerEvent) => {
      const curPps = useEditor.getState().pxPerSec;
      const dx = (ev.clientX - state.pointerX) / curPps;
      if (!state.moved && Math.abs(ev.clientX - state.pointerX) < 3 && Math.abs(ev.clientY - state.pointerY) < 3) return;
      state.moved = true;
      const doSnap = useEditor.getState().snapping && !ev.altKey;
      const threshold = SNAP_PX / curPps;
      if (mode === 'move') {
        let start = Math.max(0, state.origStart + dx);
        const len = state.origEnd - state.origStart;
        let line: number | null = null;
        if (doSnap) {
          const s = snapOffset([start, start + len], points, threshold);
          start = Math.max(0, start + s.offset);
          line = s.at;
        }
        const row = trackAtClientY(ev.clientY);
        setSnapLine(line);
        latest = { ...state, start, targetTrackId: row.trackId, ghostTop: row.top };
        setDrag(latest);
      } else {
        let time = (mode === 'trim-start' ? state.origStart : state.origEnd) + dx;
        let line: number | null = null;
        if (doSnap) {
          const s = snapOffset([time], points, threshold);
          time += s.offset;
          line = s.at;
        }
        setSnapLine(line);
        commit(trimClip(base, clip.id, mode === 'trim-start' ? 'start' : 'end', time, asset), false);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setSnapLine(null);
      setDrag(null);
      if (latest.mode === 'move' && latest.moved) {
        commit(moveClip(useEditor.getState().project, latest.clipId, latest.start, latest.targetTrackId), false);
      }
      endGesture();
    };
    const cancel = () => {
      latest = { ...latest, moved: false };
      up();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // ---------- drops from the library / desktop ----------
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (!types.includes(ASSET_MIME) && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const row = trackAtClientY(e.clientY);
    setDropHint({ x: HEAD_W + timeAtClientX(e.clientX) * pps, top: row.top, height: row.height });
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(null);
    const start = timeAtClientX(e.clientX);
    const { trackId } = trackAtClientY(e.clientY);
    const id = e.dataTransfer.getData(ASSET_MIME);
    if (id) {
      addAssetToTimeline(id, { start, trackId: trackId ?? undefined });
    } else if (e.dataTransfer.files.length) {
      const imported = await importFiles(e.dataTransfer.files);
      let at = start;
      for (const a of imported) {
        addAssetToTimeline(a.id, { start: at, trackId: trackId ?? undefined });
        at += a.kind === 'image' ? 5 : a.duration;
      }
    }
  };

  const zoomTo = (next: number) => useEditor.setState({ pxPerSec: clamp(next, MIN_PPS, MAX_PPS) });
  const fit = () => {
    const w = (scrollRef.current?.clientWidth ?? 800) - HEAD_W - 60;
    zoomTo(duration > 0 ? w / duration : 60);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const dragged = drag ? project.clips.find((c) => c.id === drag.clipId) : null;

  return (
    <section className="timeline panel">
      <div className="tl-toolbar">
        <div className="tl-tools">
          <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <Icon name="redo" />
          </button>
          <span className="sep" />
          <button className="icon-btn" title="Split (S)" onClick={splitAtPlayhead}>
            <Icon name="split" />
          </button>
          <button className="icon-btn" title="Delete (Del)" disabled={!selectedId} onClick={() => deleteSelected()}>
            <Icon name="trash" />
          </button>
          <button className="icon-btn" title="Duplicate (Ctrl+D)" disabled={!selectedId} onClick={duplicateSelected}>
            <Icon name="copy" />
          </button>
        </div>
        <div className="tl-tools">
          <button
            className={`icon-btn ${snapping ? 'active' : ''}`}
            title="Snapping (N). Hold Alt to bypass."
            onClick={() => useEditor.setState({ snapping: !snapping })}
          >
            <Icon name="magnet" />
          </button>
          <span className="sep" />
          <button className="icon-btn" title="Zoom out (-)" onClick={() => zoomTo(pps / 1.4)}>
            <Icon name="zoomOut" />
          </button>
          <input
            className="zoom-slider"
            type="range"
            min={Math.log(MIN_PPS)}
            max={Math.log(MAX_PPS)}
            step={0.01}
            value={Math.log(pps)}
            onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
            aria-label="Timeline zoom"
          />
          <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomTo(pps * 1.4)}>
            <Icon name="zoomIn" />
          </button>
          <button className="icon-btn" title="Zoom to fit (Shift+Z)" onClick={fit}>
            <Icon name="fit" />
          </button>
        </div>
      </div>

      <div
        className="tl-scroll"
        ref={scrollRef}
        onDragOver={onDragOver}
        onDragLeave={(e) => e.currentTarget === e.target && setDropHint(null)}
        onDrop={onDrop}
      >
        <div className="tl-content" ref={contentRef} style={{ width: contentWidth }}>
          <div className="tl-ruler-row" style={{ height: RULER_H }}>
            <div className="tl-corner" style={{ width: HEAD_W }}>
              <span className="tl-corner-dur">{formatTimecode(duration, project.settings.fps).slice(0, 5)}</span>
            </div>
            <Ruler pps={pps} headW={HEAD_W} left={view.left} width={view.width} onPointerDown={startScrub} />
          </div>

          {project.tracks.map((track) => (
            <div
              key={track.id}
              className={`tl-row kind-${track.kind} ${track.main ? 'main' : ''} ${track.locked ? 'locked' : ''} ${track.hidden ? 'hidden-track' : ''}`}
              style={{ height: rowHeight(track) }}
              data-track-id={track.id}
            >
              <TrackHead track={track} name={trackNames[track.id]} width={HEAD_W} compact={phone} />
              <div
                className="tl-lane"
                onPointerDown={(e) => {
                  if (e.pointerType === 'touch') return;
                  select(null);
                  startScrub(e);
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) select(null);
                }}
              >
                {project.clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      asset={clip.assetId ? assets[clip.assetId] : undefined}
                      pps={pps}
                      height={rowHeight(track) - 6}
                      selected={clip.id === selectedId}
                      dimmed={drag?.clipId === clip.id && drag.mode === 'move' && drag.moved}
                      onPointerDown={onClipPointerDown}
                    />
                  ))}
                {track.main && project.clips.every((c) => c.trackId !== track.id) && (
                  <div className="lane-empty">
                    {phone ? 'Tap Media below to add videos and photos' : 'Drag videos and photos here, or double-click media to add'}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="tl-spacer" />

          {drag && drag.mode === 'move' && drag.moved && dragged && (
            <div
              className={`clip-ghost kind-${dragged.kind}`}
              style={{
                left: HEAD_W + drag.start * pps,
                top: drag.ghostTop + 3,
                width: dragged.duration * pps,
              }}
            >
              {formatTimecode(drag.start, project.settings.fps)}
            </div>
          )}
          {dropHint && <div className="drop-hint" style={{ left: dropHint.x, top: dropHint.top, height: dropHint.height }} />}
          {snapLine !== null && <div className="snap-line" style={{ left: HEAD_W + snapLine * pps }} />}
          <Playhead pps={pps} headW={HEAD_W} onPointerDown={startScrub} />
        </div>
      </div>
    </section>
  );
}

function Ruler({
  pps,
  headW,
  left,
  width,
  onPointerDown,
}: {
  pps: number;
  headW: number;
  left: number;
  width: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * pps >= 90) ?? 600;
  const minor = major / (major >= 1 && major % 5 === 0 ? 5 : 2);
  const t0 = Math.max(0, (left - headW) / pps);
  const t1 = (left + width) / pps;
  const ticks: { t: number; major: boolean }[] = [];
  const first = Math.floor(t0 / minor) * minor;
  for (let t = first; t <= t1 + minor; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ t, major: isMajor });
  }
  const label = (t: number) => {
    if (major < 1) {
      const s = Math.floor(t);
      const f = Math.round((t - s) * 30);
      return f === 0 ? `${s}s` : `${f}f`;
    }
    const m = Math.floor(t / 60);
    const s = Math.round(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return (
    <div className="tl-ruler" onPointerDown={onPointerDown}>
      {ticks.map(({ t, major: isMajor }) => (
        <span key={t.toFixed(4)} className={`tick ${isMajor ? 'major' : ''}`} style={{ left: t * pps }}>
          {isMajor && <em>{label(t)}</em>}
        </span>
      ))}
    </div>
  );
}

function Playhead({ pps, headW, onPointerDown }: { pps: number; headW: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const t = useEditor((s) => s.currentTime);
  return (
    <div className="playhead" style={{ left: headW + t * pps }}>
      <span className="playhead-knob" onPointerDown={onPointerDown} />
    </div>
  );
}

function TrackHead({ track, name, width, compact }: { track: Track; name: string; width: number; compact: boolean }) {
  const toggle = (key: 'muted' | 'hidden' | 'locked') =>
    edit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, [key]: !t[key] } : t)) }));
  const icon = track.captions ? 'captions' : track.kind === 'audio' ? 'audio' : track.kind === 'text' ? 'text' : 'film';
  if (compact) {
    // Phones: just the track icon and its most useful switch (sound for media, visibility for text).
    const key = track.kind === 'text' ? 'hidden' : 'muted';
    const off = track[key];
    return (
      <div className="tl-head compact" style={{ width }} title={name}>
        <button
          className={`mini ${off ? 'active' : ''}`}
          aria-label={`${name}: ${key === 'hidden' ? (off ? 'show' : 'hide') : off ? 'unmute' : 'mute'}`}
          onClick={() => toggle(key)}
        >
          <Icon name={key === 'hidden' ? (off ? 'eyeOff' : icon) : off ? 'mute' : icon} size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="tl-head" style={{ width }} title={name}>
      <span className="tl-head-name">
        <Icon name={icon} size={14} />
        {name}
      </span>
      <span className="tl-head-btns">
        {track.kind !== 'text' && (
          <button className={`mini ${track.muted ? 'active' : ''}`} title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggle('muted')}>
            <Icon name={track.muted ? 'mute' : 'volume'} size={14} />
          </button>
        )}
        {track.kind !== 'audio' && (
          <button className={`mini ${track.hidden ? 'active' : ''}`} title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => toggle('hidden')}>
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
        <button className={`mini ${track.locked ? 'active' : ''}`} title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggle('locked')}>
          <Icon name={track.locked ? 'lock' : 'unlock'} size={14} />
        </button>
      </span>
    </div>
  );
}

const ClipView = memo(function ClipView({
  clip,
  asset,
  pps,
  height,
  selected,
  dimmed,
  onPointerDown,
}: {
  clip: Clip;
  asset?: Asset;
  pps: number;
  height: number;
  selected: boolean;
  dimmed: boolean;
  onPointerDown: (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => void;
}) {
  const width = Math.max(2, clip.duration * pps);
  const filter = clip.filter !== 'none' ? FILTERS.find((f) => f.id === clip.filter)?.label : null;
  const transition = clip.transition !== 'none' ? TRANSITIONS.find((t) => t.id === clip.transition)?.label : null;
  return (
    <div
      className={`clip kind-${clip.kind} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ left: clip.start * pps, width, height }}
      onPointerDown={(e) => onPointerDown(e, clip, 'move')}
      onClick={(e) => {
        e.stopPropagation();
        select(clip.id);
      }}
      title={clip.name}
    >
      <div className="clip-body">
        {clip.kind === 'video' && asset && <Filmstrip clip={clip} asset={asset} width={width} height={height} />}
        {clip.kind === 'image' && asset?.thumbnail && (
          <div className="clip-tiles" style={{ backgroundImage: `url(${asset.thumbnail})`, backgroundSize: `auto ${height}px` }} />
        )}
        {clip.kind === 'audio' && asset && <Waveform clip={clip} asset={asset} width={width} height={height} />}
        {clip.kind === 'text' && (
          <span className="clip-text">
            <b>T</b> {clip.text?.content.replace(/\n/g, ' ')}
          </span>
        )}
        {clip.kind === 'sticker' && <span className="clip-text">{clip.sticker} Sticker</span>}
      </div>
      <div className="clip-labels">
        {width > 60 && clip.kind !== 'text' && clip.kind !== 'sticker' && <span className="clip-name">{clip.name}</span>}
        {clip.speed !== 1 && <span className="clip-badge">{clip.speed}x</span>}
        {filter && width > 90 && <span className="clip-badge">{filter}</span>}
        {clip.volume === 0 && clip.kind !== 'image' && <span className="clip-badge"><Icon name="mute" size={11} /></span>}
      </div>
      {transition && <span className="clip-transition" title={`Transition: ${transition}`} style={{ width: Math.max(10, clip.transitionDur * pps) }} />}
      <span className="trim l" onPointerDown={(e) => onPointerDown(e, clip, 'trim-start')} />
      <span className="trim r" onPointerDown={(e) => onPointerDown(e, clip, 'trim-end')} />
    </div>
  );
});

function Filmstrip({ clip, asset, width, height }: { clip: Clip; asset: Asset; width: number; height: number }) {
  const frames = asset.filmstrip?.length ? asset.filmstrip : asset.thumbnail ? [asset.thumbnail] : [];
  if (!frames.length) return null;
  const tileW = Math.max(16, height * (asset.width && asset.height ? asset.width / asset.height : 16 / 9));
  const count = Math.min(240, Math.ceil(width / tileW));
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const tl = ((i + 0.5) * tileW) / width; // fraction across the clip
    const src = clip.inPoint + tl * clip.duration * clip.speed;
    const idx = clamp(Math.floor((src / asset.duration) * frames.length), 0, frames.length - 1);
    tiles.push(<img key={i} src={frames[idx]} alt="" draggable={false} style={{ left: i * tileW, width: tileW, height }} />);
  }
  return <div className="filmstrip">{tiles}</div>;
}

function Waveform({ clip, asset, width, height }: { clip: Clip; asset: Asset; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = asset.waveform;
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks?.length) return;
    const w = Math.min(4096, Math.max(1, Math.round(width)));
    c.width = w;
    c.height = height;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const srcStart = clip.inPoint;
    const srcSpan = clip.duration * clip.speed;
    const mid = height / 2;
    for (let x = 0; x < w; x += 2) {
      const a = Math.floor((srcStart + (x / w) * srcSpan) * WAVEFORM_RATE);
      const b = Math.max(a + 1, Math.floor((srcStart + ((x + 2) / w) * srcSpan) * WAVEFORM_RATE));
      let v = 0;
      for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i]);
      const h = Math.max(1, v * (height - 8) * Math.min(1, clip.volume));
      ctx.fillRect(x, mid - h / 2, 1.4, h);
    }
  }, [peaks, width, height, clip.inPoint, clip.duration, clip.speed, clip.volume]);
  if (!peaks) return <div className="wave-loading">Analysing audio...</div>;
  return <canvas ref={ref} className="waveform" style={{ width: '100%', height }} />;
}
