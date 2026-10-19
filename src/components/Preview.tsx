import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { updateSelected } from '../actions';
import { engine } from '../engine/engine';
import { setTelestratorEditing } from '../engine/graphics';
import { hitTest, type DrawBox } from '../engine/render';
import { projectDuration } from '../model/ops';
import type { TeleMark } from '../model/types';
import { beginGesture, endGesture, select, setShowStats, toast, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatTimecode } from '../utils';

type Drag =
  | { mode: 'draw' }
  | { mode: 'move'; startX: number; startY: number; x0: number; y0: number }
  | { mode: 'scale'; cx: number; cy: number; d0: number; s0: number }
  | { mode: 'rotate'; cx: number; cy: number; a0: number; r0: number }
  | { mode: 'pinch'; d0: number; a0: number; s0: number; r0: number };

type Pt = { x: number; y: number };
const span = (a: Pt, b: Pt) => ({ d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) });

export function Preview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useEditor((s) => s.project.settings);
  const selectedId = useEditor((s) => s.selectedId);
  const pick = useEditor((s) => s.pick);
  const task = useEditor((s) => s.task);
  const showStats = useEditor((s) => s.showStats);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<DrawBox | null>(null);
  const [guides, setGuides] = useState({ v: false, h: false });
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const gestureOpen = useRef(false);

  // Fit the stage inside the available space while keeping the project aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const aspect = settings.width / settings.height;
      let w = r.width;
      let h = w / aspect;
      if (h > r.height) {
        h = r.height;
        w = h * aspect;
      }
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.width, settings.height]);

  // Phones draw the overlay canvas at 1x while playing (a quarter of the pixels at 2x), sharp again on pause.
  const lowRes = useEditor((s) => s.playing) && engine.directVideo;
  const sizeCanvas = (c: HTMLCanvasElement, low: boolean) => {
    const dpr = low ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, settings.width / size.w);
    const w = Math.round(size.w * Math.max(1, scale));
    const h = Math.round(size.h * Math.max(1, scale));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      engine.invalidate();
    }
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || size.w === 0) return;
    sizeCanvas(c, engine.directVideo && useEditor.getState().playing);
    engine.setPreviewCanvas(c);
    return () => engine.setPreviewCanvas(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, settings.width]);
  useEffect(() => {
    const c = canvasRef.current;
    if (c && size.w > 0) sizeCanvas(c, lowRes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowRes]);

  useEffect(
    () =>
      engine.onFrame((boxes) => {
        const id = useEditor.getState().selectedId;
        const b = id ? (boxes.find((x) => x.clipId === id) ?? null) : null;
        setBox((prev) => {
          if (!b || !prev) return b === prev ? prev : b;
          const same =
            prev.clipId === b.clipId &&
            Math.abs(prev.cx - b.cx) < 0.5 &&
            Math.abs(prev.cy - b.cy) < 0.5 &&
            Math.abs(prev.w - b.w) < 0.5 &&
            Math.abs(prev.h - b.h) < 0.5 &&
            Math.abs(prev.rotation - b.rotation) < 0.1;
          return same ? prev : b;
        });
      }),
    [],
  );

  useEffect(() => {
    if (!selectedId) setBox(null);
    else engine.invalidate();
  }, [selectedId]);

  const k = size.w / settings.width; // project px -> screen px

  const toProject = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const currentTransform = () => useEditor.getState().project.clips.find((c) => c.id === useEditor.getState().selectedId)?.transform;

  /** Position of a project-space point within the selected clip's frame, as fractions (may fall outside 0..1). */
  const pointInSelected = (pt: Pt) => {
    if (!box) return null;
    const a = (-box.rotation * Math.PI) / 180;
    const dx = pt.x - box.cx;
    const dy = pt.y - box.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return { fx: lx / box.w + 0.5, fy: ly / box.h + 0.5 };
  };

  const handlePick = (mode: 'chroma' | 'spotlight', pt: Pt) => {
    const st = useEditor.getState();
    const clip = st.project.clips.find((c) => c.id === st.selectedId);
    const f = pointInSelected(pt);
    if (!clip || !f || f.fx < 0 || f.fx > 1 || f.fy < 0 || f.fy > 1) {
      toast('Tap inside the selected clip');
      return;
    }
    if (mode === 'chroma') {
      const color = engine.sampleColor(clip, f.fx, f.fy);
      if (color) updateSelected((c) => ({ chroma: { similarity: 0.4, smoothness: 0.15, ...c.chroma, color } }));
    } else {
      updateSelected((c) => (c.spotlight ? { spotlight: { ...c.spotlight, x: f.fx, y: f.fy } } : {}));
    }
    useEditor.setState({ pick: null });
  };

  /** The selected telestrator, when the pen is out. */
  const drawingOn = () => {
    const st = useEditor.getState();
    const c = st.draw ? st.project.clips.find((x) => x.id === st.selectedId) : undefined;
    return c?.graphic?.type === 'telestrator' ? c : null;
  };
  /** A point as fractions of the telestrator's frame (it may have been moved or scaled). */
  const teleFraction = (pt: Pt): [number, number] => {
    const f = pointInSelected(pt);
    const fx = f ? f.fx : pt.x / settings.width;
    const fy = f ? f.fy : pt.y / settings.height;
    return [+Math.min(1, Math.max(0, fx)).toFixed(4), +Math.min(1, Math.max(0, fy)).toFixed(4)];
  };

  const onStageDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = toProject(e);
    const tele = drawingOn();
    if (tele) {
      const { tool, color } = useEditor.getState().draw!;
      const at = teleFraction(pt);
      beginGesture();
      gestureOpen.current = true;
      updateSelected((c) => ({ graphic: { ...c.graphic!, marks: [...(c.graphic!.marks ?? []), { kind: tool, pts: [at, at], color }] } }));
      drag.current = { mode: 'draw' };
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      return;
    }
    const pick = useEditor.getState().pick;
    if (pick) {
      handlePick(pick, pt);
      return;
    }
    pointers.current.set(e.pointerId, pt);
    // A second finger on a selected clip turns the gesture into pinch-to-scale and twist-to-rotate.
    if (pointers.current.size === 2) {
      const tr = currentTransform();
      if (tr && gestureOpen.current) {
        const [a, b] = [...pointers.current.values()];
        const g = span(a, b);
        drag.current = { mode: 'pinch', d0: g.d, a0: g.a, s0: tr.scale, r0: tr.rotation };
        setGuides({ v: false, h: false });
        (e.target as Element).setPointerCapture(e.pointerId);
      }
      return;
    }
    if (pointers.current.size > 2) return;
    const hit = hitTest(engine.boxes, pt.x, pt.y);
    if (!hit) {
      select(null);
      return;
    }
    const clip = useEditor.getState().project.clips.find((c) => c.id === hit.clipId);
    const track = clip && useEditor.getState().project.tracks.find((t) => t.id === clip.trackId);
    select(hit.clipId);
    if (!clip || track?.locked) return;
    drag.current = { mode: 'move', startX: pt.x, startY: pt.y, x0: clip.transform.x, y0: clip.transform.y };
    beginGesture();
    gestureOpen.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onHandleDown = (mode: 'scale' | 'rotate') => (e: React.PointerEvent) => {
    e.stopPropagation();
    const tr = currentTransform();
    if (!tr || !box) return;
    const pt = toProject(e);
    if (mode === 'scale') {
      drag.current = { mode, cx: box.cx, cy: box.cy, d0: Math.hypot(pt.x - box.cx, pt.y - box.cy) || 1, s0: tr.scale };
    } else {
      drag.current = { mode, cx: box.cx, cy: box.cy, a0: Math.atan2(pt.y - box.cy, pt.x - box.cx), r0: tr.rotation };
    }
    beginGesture();
    gestureOpen.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const pt = toProject(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'draw') {
      const at = teleFraction(pt);
      updateSelected((c) => {
        const marks = [...(c.graphic!.marks ?? [])];
        const m = marks[marks.length - 1];
        if (!m) return {};
        if (m.kind === 'pen') {
          const last = m.pts[m.pts.length - 1];
          if (Math.hypot(at[0] - last[0], at[1] - last[1]) < 0.006) return {};
          marks[marks.length - 1] = { ...m, pts: [...m.pts, at] };
        } else {
          marks[marks.length - 1] = { ...m, pts: [m.pts[0], at] };
        }
        return { graphic: { ...c.graphic!, marks } };
      });
      return;
    }
    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const g = span(a, b);
      const scale = Math.max(0.05, Math.min(10, (d.s0 * g.d) / d.d0));
      let rot = d.r0 + ((g.a - d.a0) * 180) / Math.PI;
      rot = ((((rot + 180) % 360) + 360) % 360) - 180;
      const snapped = Math.round(rot / 90) * 90;
      if (Math.abs(snapped - rot) < 5) rot = snapped;
      updateSelected((c) => ({
        transform: { ...c.transform, scale: Math.round(scale * 100) / 100, rotation: Math.round(rot * 10) / 10 },
      }));
    } else if (d.mode === 'move') {
      let x = d.x0 + (pt.x - d.startX) / settings.width;
      let y = d.y0 + (pt.y - d.startY) / settings.height;
      const snapV = Math.abs(x) < 0.012 && !e.altKey;
      const snapH = Math.abs(y) < 0.012 && !e.altKey;
      if (snapV) x = 0;
      if (snapH) y = 0;
      setGuides({ v: snapV, h: snapH });
      updateSelected((c) => ({ transform: { ...c.transform, x, y } }));
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(pt.x - d.cx, pt.y - d.cy);
      const scale = Math.max(0.05, Math.min(10, (d.s0 * dist) / d.d0));
      updateSelected((c) => ({ transform: { ...c.transform, scale: Math.round(scale * 100) / 100 } }));
    } else {
      const a = Math.atan2(pt.y - d.cy, pt.x - d.cx);
      let rot = d.r0 + ((a - d.a0) * 180) / Math.PI;
      rot = ((((rot + 180) % 360) + 360) % 360) - 180;
      if (!e.shiftKey) {
        const snapped = Math.round(rot / 45) * 45;
        if (Math.abs(snapped - rot) < 4) rot = snapped;
      }
      updateSelected((c) => ({ transform: { ...c.transform, rotation: Math.round(rot * 10) / 10 } }));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    setGuides({ v: false, h: false });
    if (pointers.current.size > 0) {
      // Lifting one finger of a pinch pauses it; the gesture ends when the last finger lifts.
      if (drag.current?.mode === 'pinch') drag.current = null;
      return;
    }
    if (drag.current?.mode === 'draw') {
      // A tap rather than a stroke leaves nothing behind.
      updateSelected((c) => {
        const marks = c.graphic!.marks ?? [];
        const m = marks[marks.length - 1];
        if (!m) return {};
        const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
        const tiny = m.kind === 'pen' ? m.pts.length < 3 : Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.015;
        return tiny ? { graphic: { ...c.graphic!, marks: marks.slice(0, -1) } } : {};
      });
    }
    if (gestureOpen.current) endGesture();
    gestureOpen.current = false;
    drag.current = null;
  };

  // Show the telestrator being drawn on complete, and keep the playhead on it.
  const draw = useEditor((s) => s.draw);
  useEffect(() => {
    const tele = draw ? drawingOn() : null;
    // Selecting something else puts the pen away.
    if (draw && !tele) useEditor.setState({ draw: null });
    setTelestratorEditing(tele?.id ?? null);
    if (tele) {
      const t = useEditor.getState().currentTime;
      if (t < tele.start || t >= tele.start + tele.duration) engine.seek(tele.start + Math.min(0.5, tele.duration / 2));
    }
    engine.invalidate();
    return () => setTelestratorEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, selectedId]);

  return (
    <section className="preview panel">
      <div className="preview-wrap" ref={wrapRef}>
        <div
          className={`stage ${pick || draw ? 'picking' : ''}`}
          ref={stageRef}
          style={{ width: size.w, height: size.h }}
          onPointerDown={onStageDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={() => {
            const st = useEditor.getState();
            const c = st.project.clips.find((x) => x.id === st.selectedId);
            if (c?.kind === 'text') document.querySelector<HTMLTextAreaElement>('#text-content')?.focus();
          }}
        >
          <canvas ref={canvasRef} data-preview style={{ width: size.w, height: size.h }} />
          {pick && (
            <div className="pick-banner" role="status">
              <Icon name={pick === 'chroma' ? 'eyedropper' : 'target'} size={16} />
              {pick === 'chroma' ? 'Tap the colour to remove' : 'Tap your player'}
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.setState({ pick: null })}>
                Cancel
              </button>
            </div>
          )}
          {task && (
            <div className="task-pill" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>
                {task.label}
                {task.progress !== null ? ` ${Math.round(task.progress * 100)}%` : '...'}
              </span>
              {task.cancel && (
                <button onPointerDown={(e) => e.stopPropagation()} onClick={task.cancel}>
                  Cancel
                </button>
              )}
            </div>
          )}
          {guides.v && <div className="guide v" />}
          {guides.h && <div className="guide h" />}
          {box && !draw && (
            <div
              className="sel-box"
              style={{
                left: box.cx * k,
                top: box.cy * k,
                width: box.w * k,
                height: box.h * k,
                transform: `translate(-50%,-50%) rotate(${box.rotation}deg)`,
              }}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                <span key={c} className={`handle ${c}`} onPointerDown={onHandleDown('scale')} />
              ))}
              <span
                // Below the frame the handle would sit over the play controls, so tuck it inside when there's no room.
                className={`handle rot ${(box.cy + box.h / 2) * k + 48 > size.h ? 'inside' : ''}`}
                title="Rotate"
                onPointerDown={onHandleDown('rotate')}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
                </svg>
              </span>
            </div>
          )}
          {showStats && <PlaybackStats />}
        </div>
        {/* Under the whole preview rather than the frame: a tall frame on a phone is too narrow for it. */}
        {draw && <PenBar />}
      </div>
      <Transport />
    </section>
  );
}

const PEN_TOOLS: { id: TeleMark['kind']; label: string; icon: string }[] = [
  { id: 'circle', label: 'Circle', icon: 'M12 4a8 7 0 1 0 0.1 0' },
  { id: 'arrow', label: 'Arrow', icon: 'M5 19L19 5M19 5h-7M19 5v7' },
  { id: 'line', label: 'Line', icon: 'M5 19L19 5' },
  { id: 'pen', label: 'Pen', icon: 'M4 17c3-6 5 2 8-3s4-6 8-4' },
];
const PEN_COLORS = ['#ffd400', '#ffffff', '#ef4444', '#22d3ee', '#4ade80'];

/** The telestrator's pen, over the preview: pick a mark, a colour, undo, and finish. */
function PenBar() {
  const draw = useEditor((s) => s.draw)!;
  const set = (patch: Partial<NonNullable<typeof draw>>) => useEditor.setState({ draw: { ...draw, ...patch } });
  const undo = () => updateSelected((c) => (c.graphic?.marks?.length ? { graphic: { ...c.graphic, marks: c.graphic.marks.slice(0, -1) } } : {}));
  return (
    <div className="pen-bar" role="toolbar" aria-label="Telestrator" onPointerDown={(e) => e.stopPropagation()}>
      {PEN_TOOLS.map((t) => (
        <button key={t.id} className={draw.tool === t.id ? 'on' : ''} aria-pressed={draw.tool === t.id} aria-label={t.label} title={t.label} onClick={() => set({ tool: t.id })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.icon} />
          </svg>
        </button>
      ))}
      <span className="pen-sep" />
      {PEN_COLORS.map((c) => (
        <button key={c} className={`pen-color ${draw.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => set({ color: c })} />
      ))}
      <span className="pen-sep" />
      <button onClick={undo} aria-label="Undo last mark" title="Undo last mark">
        <Icon name="undo" size={15} />
      </button>
      <button className="pen-done" onClick={() => useEditor.setState({ draw: null })}>
        Done
      </button>
    </div>
  );
}

/** Live playback health, for diagnosing stutter on a real phone. Copy the report and send it on. */
function PlaybackStats() {
  const [s, setS] = useState(() => engine.statsSnapshot());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setS(engine.statsSnapshot()), 500);
    return () => clearInterval(id);
  }, []);
  const report = () => {
    const { project, assets } = useEditor.getState();
    const media = Object.values(assets)
      .filter((a) => a.kind === 'video' && !a.internal)
      .map((a) => `${a.name.split('.').pop()} ${a.width}x${a.height} ${a.duration.toFixed(1)}s ${(a.size / 1e6).toFixed(0)}MB`);
    const lines = [
      'ClipForge playback report',
      `Device: ${navigator.userAgent}`,
      `Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x`,
      `Project: ${project.settings.width}x${project.settings.height} ${project.settings.fps}fps, ${project.clips.length} clips, ${projectDuration(project).toFixed(1)}s`,
      `Video: ${media.join('; ') || 'none'}`,
      `Frames: ${s.frames} at ${s.fps.toFixed(1)} fps, ${s.slow} slow (>50ms), worst ${Math.round(s.worst)}ms`,
      `Seeks ${s.seeks} (start ${s.seekWhy.start}, video ${s.seekWhy.lead}, audio ${s.seekWhy.audio}, other ${s.seekWhy.other}), starts ${s.restarts}, waiting ${(s.stallMs / 1000).toFixed(1)}s`,
      `Video froze ${s.freezes} times (${(s.frozenMs / 1000).toFixed(1)}s), speed changes ${s.rateChanges}, players ${s.players}, direct ${s.direct ? 'on' : 'off'}`,
      `Browser frame counts: ${s.dropped ?? '?'} dropped of ${s.decoded ?? '?'}`,
    ];
    return lines.join('\n');
  };
  const copy = async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older iOS: fall back to a selection copy.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const bad = (v: number, warn: number) => (v > warn ? 'bad' : '');
  return (
    <div className="pb-stats" onPointerDown={(e) => e.stopPropagation()} role="status" aria-label="Playback stats">
      <div className="pb-grid">
        <span>FPS</span>
        <b className={s.frames > 30 && s.fps < 45 ? 'bad' : ''}>{s.frames ? s.fps.toFixed(0) : '-'}</b>
        <span>Slow frames</span>
        <b className={bad(s.slow, 5)}>
          {s.slow} <small>worst {Math.round(s.worst)}ms</small>
        </b>
        <span>Seeks / starts</span>
        <b className={bad(s.seeks, 3)}>
          {s.seeks} / {s.restarts}
        </b>
        <span>Waiting</span>
        <b className={bad(s.stallMs, 1500)}>{(s.stallMs / 1000).toFixed(1)}s</b>
        <span>Video froze</span>
        <b className={bad(s.freezes, 0)}>
          {s.freezes} <small>{(s.frozenMs / 1000).toFixed(1)}s</small>
        </b>
        <span>Players</span>
        <b className={bad(s.players, 3)}>
          {s.players} <small>{s.direct ? 'direct' : 'canvas'}</small>
        </b>
      </div>
      <div className="pb-actions">
        <button onClick={() => engine.resetStats()}>Reset</button>
        <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy report'}</button>
        <button onClick={() => setShowStats(false)} aria-label="Hide stats">
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

/** The running timecode, written straight to the page so the controls around it don't re-render every frame. */
function Timecode({ fps }: { fps: number }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const show = (t: number) => {
      if (ref.current) ref.current.textContent = formatTimecode(t, fps);
    };
    show(useEditor.getState().currentTime);
    return useEditor.subscribe((s, prev) => s.currentTime !== prev.currentTime && show(s.currentTime));
  }, [fps]);
  return <b ref={ref} />;
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const project = useEditor((s) => s.project);
  const dur = projectDuration(project);
  const fps = project.settings.fps;
  const atEnd = useEditor((s) => !s.playing && dur > 0 && s.currentTime >= dur - 0.01);
  const label = playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
  // Press and hold the timecode to show or hide the playback stats.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = () => {
    hold.current = setTimeout(() => setShowStats(!useEditor.getState().showStats), 600);
  };
  const holdEnd = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  return (
    <div className="transport">
      <span className="tc" onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} onContextMenu={(e) => e.preventDefault()}>
        <Timecode fps={fps} />
        <span> / {formatTimecode(dur, fps)}</span>
      </span>
      <div className="transport-mid">
        <button className="icon-btn" title="Back to start (Home)" aria-label="Back to start" onClick={() => engine.seek(0)} disabled={dur === 0}>
          <Icon name="toStart" size={16} />
        </button>
        <button className="icon-btn" title="Previous frame (Left)" onClick={() => engine.stepFrames(-1)}>
          <Icon name="stepBack" size={16} />
        </button>
        <button className="play-btn" title={`${label} (Space)`} aria-label={label} onClick={() => engine.toggle()} disabled={dur === 0}>
          <Icon name={playing ? 'pause' : atEnd ? 'replay' : 'play'} size={22} />
        </button>
        <button className="icon-btn" title="Next frame (Right)" onClick={() => engine.stepFrames(1)}>
          <Icon name="stepFwd" size={16} />
        </button>
      </div>
      <button
        className="icon-btn"
        title="Fullscreen preview"
        onClick={() => document.querySelector('.preview-wrap')?.requestFullscreen?.()}
      >
        <Icon name="fullscreen" />
      </button>
    </div>
  );
}
