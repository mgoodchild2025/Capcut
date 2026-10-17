import { useState } from 'react';
import {
  copySelectedStyle,
  DEFAULT_SPOTLIGHT,
  detachAudioSelected,
  freezeFrameSelected,
  hasCopiedStyle,
  importFiles,
  localPlayhead,
  pasteSelectedStyle,
  removeBackgroundSelected,
  replaceSelectedWith,
  reverseSelected,
  setAnimatable,
  setCurveSelected,
  setSpotlightHold,
  setSpotlightSelected,
  toggleKeyframe,
  updateSelected,
} from '../actions';
import { engine } from '../engine/engine';
import { trackKindFor } from '../model/ops';
import { CURVE_PRESETS, hasKeyframeAt, keyframeTimes, valueAt } from '../model/timing';
import type { Clip, Crop, KeyProp, SpeedPoint } from '../model/types';
import { useEditor } from '../store';
import { ColorField, gestureProps, Section, Slider, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';

// ---------- quick actions ----------

export function QuickActions({ clip }: { clip: Clip }) {
  const [replacing, setReplacing] = useState(false);
  const busy = useEditor((s) => !!s.task);
  const isVideo = clip.kind === 'video';
  const media = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio';
  return (
    <div className="quick-actions" role="toolbar" aria-label="Clip actions">
      {media && <ActionButton icon="swap" label="Replace" onClick={() => setReplacing(true)} />}
      {isVideo && <ActionButton icon="freeze" label="Freeze" disabled={busy} onClick={() => void freezeFrameSelected()} />}
      {isVideo && <ActionButton icon="reverse" label="Reverse" disabled={busy} onClick={() => void reverseSelected()} />}
      {isVideo && <ActionButton icon="detach" label="Extract audio" onClick={detachAudioSelected} />}
      {clip.kind === 'image' && <ActionButton icon="sparkle" label="Remove BG" disabled={busy} onClick={() => void removeBackgroundSelected()} />}
      <ActionButton icon="copy" label="Copy style" onClick={copySelectedStyle} />
      <ActionButton icon="paste" label="Paste style" disabled={!hasCopiedStyle()} onClick={pasteSelectedStyle} />
      {replacing && <ReplaceDialog clip={clip} onClose={() => setReplacing(false)} />}
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="qa-btn" onClick={onClick} disabled={disabled} title={label}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function ReplaceDialog({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const assets = useEditor((s) => s.assets);
  const kind = trackKindFor(clip.kind);
  const options = Object.values(assets).filter(
    (a) => a.id !== clip.assetId && trackKindFor(a.kind === 'audio' ? 'audio' : a.kind === 'image' ? 'image' : 'video') === kind,
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title">
        <header>
          <h3 id="replace-title">Replace clip</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <p className="muted small">The new media keeps this clip's position, length and effects.</p>
        <div className="asset-grid replace-grid">
          {options.map((a) => (
            <button
              key={a.id}
              className="asset replace-opt"
              onClick={() => {
                replaceSelectedWith(a.id);
                onClose();
              }}
            >
              <span className="asset-thumb">
                {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Icon name={a.kind === 'audio' ? 'audio' : 'image'} />}
                {a.kind !== 'image' && <span className="badge">{formatDuration(a.duration)}</span>}
              </span>
              <span className="replace-name">{a.name}</span>
            </button>
          ))}
        </div>
        {!options.length && <p className="muted small">Import another file to swap it in.</p>}
        <footer>
          <label className="btn">
            <Icon name="upload" /> Import new
            <input
              type="file"
              hidden
              accept={kind === 'audio' ? 'audio/*,video/*' : 'video/*,image/*'}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const [a] = await importFiles([f]);
                if (a) replaceSelectedWith(a.id);
                onClose();
              }}
            />
          </label>
        </footer>
      </div>
    </div>
  );
}

// ---------- keyframed slider ----------

export function KeySlider({
  clip,
  prop,
  label,
  min,
  max,
  step,
  format,
  defaultValue,
}: {
  clip: Clip;
  prop: KeyProp;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  defaultValue: number;
}) {
  useEditor((s) => s.currentTime); // follow the playhead so animated values stay current
  const local = localPlayhead(clip);
  const animated = !!clip.keyframes?.[prop]?.length;
  const here = hasKeyframeAt(clip, prop, local);
  const value = valueAt(clip, prop, local);
  return (
    <div className="key-slider">
      <Slider label={label} value={value} min={min} max={max} step={step} format={format} defaultValue={defaultValue} onChange={(v) => setAnimatable(prop, v)} />
      <button
        className={`key-btn ${here ? 'on' : animated ? 'part' : ''}`}
        title={here ? `Remove ${label} keyframe` : `Add ${label} keyframe at playhead`}
        aria-pressed={here}
        onClick={() => toggleKeyframe(prop)}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M6 1l5 5-5 5-5-5z" />
        </svg>
      </button>
    </div>
  );
}

/** Jump between the clip's keyframes. */
export function KeyframeNav({ clip }: { clip: Clip }) {
  useEditor((s) => s.currentTime);
  const times = keyframeTimes(clip);
  if (!times.length) return null;
  const local = localPlayhead(clip);
  const prev = [...times].reverse().find((t) => t < local - 1e-3);
  const next = times.find((t) => t > local + 1e-3);
  const go = (t: number) => {
    engine.pause();
    engine.seek(clip.start + t);
  };
  return (
    <span className="kf-nav">
      <button className="mini" disabled={prev === undefined} onClick={() => prev !== undefined && go(prev)} aria-label="Previous keyframe">
        <Icon name="chevronLeft" size={14} />
      </button>
      <span>{times.length} key{times.length === 1 ? '' : 's'}</span>
      <button className="mini" disabled={next === undefined} onClick={() => next !== undefined && go(next)} aria-label="Next keyframe">
        <Icon name="chevronRight" size={14} />
      </button>
    </span>
  );
}

// ---------- crop & flip ----------

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export function CropSection({ clip }: { clip: Clip }) {
  const asset = useEditor((s) => (clip.assetId ? s.assets[clip.assetId] : undefined));
  const crop = clip.crop ?? NO_CROP;
  const set = (patch: Partial<Crop>) => {
    const next = { ...crop, ...patch };
    // Keep at least 5% of the frame in each direction.
    next.left = Math.min(next.left, 0.95 - next.right);
    next.top = Math.min(next.top, 0.95 - next.bottom);
    const empty = !next.left && !next.top && !next.right && !next.bottom;
    updateSelected({ crop: empty ? undefined : next });
  };
  /** Centre crop to an aspect ratio of the source. */
  const toAspect = (ratio: number) => {
    if (!asset?.width || !asset.height) return;
    const src = asset.width / asset.height;
    if (src > ratio) {
      const keep = ratio / src;
      updateSelected({ crop: { left: (1 - keep) / 2, right: (1 - keep) / 2, top: 0, bottom: 0 } });
    } else {
      const keep = src / ratio;
      updateSelected({ crop: { top: (1 - keep) / 2, bottom: (1 - keep) / 2, left: 0, right: 0 } });
    }
  };
  const pctf = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Section
      title="Crop & flip"
      action={
        clip.crop || clip.flipH || clip.flipV ? (
          <button className="link-btn" onClick={() => updateSelected({ crop: undefined, flipH: false, flipV: false })}>
            Reset
          </button>
        ) : undefined
      }
    >
      <div className="row-btns">
        <button className={`chip-btn ${clip.flipH ? 'on' : ''}`} onClick={() => updateSelected({ flipH: !clip.flipH })} title="Mirror left to right">
          <Icon name="flipH" size={16} /> Flip H
        </button>
        <button className={`chip-btn ${clip.flipV ? 'on' : ''}`} onClick={() => updateSelected({ flipV: !clip.flipV })} title="Flip upside down">
          <Icon name="flipV" size={16} /> Flip V
        </button>
      </div>
      <div className="crop-presets">
        <span className="muted small">Crop to</span>
        {[
          ['Free', 0],
          ['16:9', 16 / 9],
          ['9:16', 9 / 16],
          ['1:1', 1],
          ['4:5', 4 / 5],
        ].map(([label, r]) => (
          <button key={label} className="chip-btn" onClick={() => (r ? toAspect(r as number) : updateSelected({ crop: undefined }))}>
            {label}
          </button>
        ))}
      </div>
      <Slider label="Left" value={crop.left} min={0} max={0.9} step={0.005} format={pctf} defaultValue={0} onChange={(left) => set({ left })} />
      <Slider label="Right" value={crop.right} min={0} max={0.9} step={0.005} format={pctf} defaultValue={0} onChange={(right) => set({ right })} />
      <Slider label="Top" value={crop.top} min={0} max={0.9} step={0.005} format={pctf} defaultValue={0} onChange={(top) => set({ top })} />
      <Slider label="Bottom" value={crop.bottom} min={0} max={0.9} step={0.005} format={pctf} defaultValue={0} onChange={(bottom) => set({ bottom })} />
    </Section>
  );
}

// ---------- speed curves ----------

function CurveGraph({ points, active }: { points: SpeedPoint[]; active?: boolean }) {
  const max = 4;
  const y = (s: number) => 34 - (Math.log2(Math.min(max, Math.max(0.25, s))) + 2) * (30 / 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(p.p * 76 + 2).toFixed(1)},${y(p.s).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 80 36" className={`curve-graph ${active ? 'on' : ''}`} aria-hidden="true">
      <line x1="2" x2="78" y1={y(1)} y2={y(1)} className="curve-base" />
      <path d={d} />
    </svg>
  );
}

export function CurveSection({ clip }: { clip: Clip }) {
  return (
    <Section title="Speed curve">
      <div className="curve-grid">
        <button className={`curve-opt ${!clip.curve ? 'on' : ''}`} onClick={() => setCurveSelected(null)}>
          <CurveGraph points={[{ p: 0, s: 1 }, { p: 1, s: 1 }]} active={!clip.curve} />
          <span>None</span>
        </button>
        {CURVE_PRESETS.map((c) => (
          <button key={c.id} className={`curve-opt ${clip.curve?.id === c.id ? 'on' : ''}`} title={c.hint} onClick={() => setCurveSelected(c.id)}>
            <CurveGraph points={c.points} active={clip.curve?.id === c.id} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Curves vary speed across the clip. Hero gives a slow-motion moment in the middle, perfect for a spike.</p>
    </Section>
  );
}

// ---------- cutout ----------

const KEY_SWATCHES = ['#00ff00', '#00b140', '#0047bb', '#ffffff'];

export function CutoutPanel({ clip }: { clip: Clip }) {
  const pick = useEditor((s) => s.pick);
  const busy = useEditor((s) => !!s.task);
  const k = clip.chroma;
  const set = (patch: Partial<NonNullable<Clip['chroma']>>) =>
    updateSelected((c) => ({ chroma: { color: '#00ff00', similarity: 0.4, smoothness: 0.15, ...c.chroma, ...patch } }));
  return (
    <>
      {clip.kind === 'image' && (
        <Section title="Remove background (AI)">
          <p className="muted small">Cuts out the person in a photo or freeze frame on your device. The first use downloads a 25 MB model.</p>
          <button className="btn block" disabled={busy} onClick={() => void removeBackgroundSelected()}>
            <Icon name="sparkle" /> Remove background
          </button>
        </Section>
      )}
      <Section title="Chroma key">
        <Toggle label="Remove a colour (green screen)" checked={!!k} onChange={(on) => (on ? set({}) : updateSelected({ chroma: undefined }))} />
        {k && (
          <>
            <div className="key-colors">
              {KEY_SWATCHES.map((c) => (
                <button key={c} className={`swatch ${k.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Key ${c}`} onClick={() => set({ color: c })} />
              ))}
              <ColorField label="" value={k.color} onChange={(color) => set({ color })} />
              <button
                className={`chip-btn ${pick === 'chroma' ? 'on' : ''}`}
                onClick={() => useEditor.setState({ pick: pick === 'chroma' ? null : 'chroma' })}
                title="Click the colour to remove in the preview"
              >
                <Icon name="eyedropper" size={16} /> Pick
              </button>
            </div>
            {pick === 'chroma' && <p className="hint">Click the background colour in the preview.</p>}
            <Slider label="Strength" value={k.similarity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} defaultValue={0.4} onChange={(similarity) => set({ similarity })} />
            <Slider label="Edge softness" value={k.smoothness} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} defaultValue={0.15} onChange={(smoothness) => set({ smoothness })} />
          </>
        )}
      </Section>
    </>
  );
}

// ---------- spotlight ----------

const SPOT_COLORS = ['#ffd400', '#00e5ff', '#ff3b5c', '#39ff14', '#ffffff'];

export function SpotlightPanel({ clip }: { clip: Clip }) {
  const pick = useEditor((s) => s.pick);
  const sp = clip.spotlight;
  const set = (patch: Partial<NonNullable<Clip['spotlight']>>) =>
    updateSelected((c) => ({ spotlight: { ...DEFAULT_SPOTLIGHT, ...c.spotlight, ...patch } }));
  return (
    <>
      <Section title="Player spotlight">
        <p className="muted small">Freezes the opening frame and rings your player, the classic recruiting-reel callout.</p>
        <Toggle label="Spotlight at clip start" checked={!!sp} onChange={(on) => setSpotlightSelected(on)} />
      </Section>
      {sp && (
        <>
          <Section title="Position">
            <button
              className={`btn block ${pick === 'spotlight' ? 'primary' : ''}`}
              onClick={() => useEditor.setState({ pick: pick === 'spotlight' ? null : 'spotlight' })}
            >
              <Icon name="target" /> {pick === 'spotlight' ? 'Tap your player in the preview' : 'Move spotlight'}
            </button>
            <Slider label="Ring size" value={sp.r} min={0.04} max={0.4} step={0.005} format={(v) => `${Math.round(v * 100)}`} defaultValue={0.12} onChange={(r) => set({ r })} />
          </Section>
          <Section title="Style">
            <label className="field-row">
              <span>Label</span>
              <input
                className="text-input"
                placeholder="#7 or a name"
                value={sp.label}
                maxLength={24}
                onChange={(e) => set({ label: e.target.value })}
                {...gestureProps}
              />
            </label>
            <div className="key-colors">
              {SPOT_COLORS.map((c) => (
                <button key={c} className={`swatch ${sp.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Ring colour ${c}`} onClick={() => set({ color: c })} />
              ))}
              <ColorField label="" value={sp.color} onChange={(color) => set({ color })} />
            </div>
            <Toggle label="Zoom towards the player" checked={sp.zoom} onChange={(zoom) => set({ zoom })} />
            <Slider label="Freeze length" value={clip.hold ?? 1.5} min={0.5} max={4} step={0.1} format={(v) => `${v.toFixed(1)}s`} defaultValue={1.5} onChange={setSpotlightHold} />
          </Section>
        </>
      )}
    </>
  );
}
