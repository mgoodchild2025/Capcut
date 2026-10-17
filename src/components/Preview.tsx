import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { updateSelected } from '../actions';
import { engine } from '../engine/engine';
import { hitTest, type DrawBox } from '../engine/render';
import { projectDuration } from '../model/ops';
import { beginGesture, endGesture, select, toast, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatTimecode } from '../utils';

type Drag =
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

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || size.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, settings.width / size.w);
    c.width = Math.round(size.w * Math.max(1, scale));
    c.height = Math.round(size.h * Math.max(1, scale));
    engine.setPreviewCanvas(c);
    return () => engine.setPreviewCanvas(null);
  }, [size, settings.width]);

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

  const onStageDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = toProject(e);
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
    if (gestureOpen.current) endGesture();
    gestureOpen.current = false;
    drag.current = null;
  };

  return (
    <section className="preview panel">
      <div className="preview-wrap" ref={wrapRef}>
        <div
          className={`stage ${pick ? 'picking' : ''}`}
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
          {box && (
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
        </div>
      </div>
      <Transport />
    </section>
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
  return (
    <div className="transport">
      <span className="tc">
        <Timecode fps={fps} />
        <span> / {formatTimecode(dur, fps)}</span>
      </span>
      <div className="transport-mid">
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
