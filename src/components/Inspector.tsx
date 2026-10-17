import { useEffect, useState } from 'react';
import { cutToBeat, detectBeatsSelected, renameProject, updateSelected } from '../actions';
import { neighbours, setClipSpeed } from '../model/ops';
import {
  ANIMATIONS,
  ASPECT_PRESETS,
  aspectIdFor,
  DEFAULT_ADJUST,
  FILTERS,
  fontLabel,
  FONTS,
  SPEED_PRESETS,
  TRANSITIONS,
} from '../model/presets';
import type { AnimKind, Clip, TextStyle, TransitionKind } from '../model/types';
import { edit, selectedClip, useEditor } from '../store';
import { ColorField, gestureProps, Section, Segmented, Slider, Toggle } from '../ui/controls';
import { CropSection, CurveSection, CutoutPanel, KeyframeNav, KeySlider, QuickActions, SpotlightPanel } from './ClipTools';
import { Icon } from '../ui/Icon';
import { formatTimecode } from '../utils';

type Tab = 'text' | 'basic' | 'audio' | 'speed' | 'animation' | 'adjust' | 'cutout' | 'spotlight';

const TAB_LABELS: Record<Tab, string> = {
  text: 'Text',
  basic: 'Basic',
  audio: 'Audio',
  speed: 'Speed',
  animation: 'Animation',
  adjust: 'Adjust',
  cutout: 'Cutout',
  spotlight: 'Spotlight',
};

function tabsFor(c: Clip): Tab[] {
  switch (c.kind) {
    case 'video':
      return ['basic', 'spotlight', 'speed', 'audio', 'animation', 'adjust', 'cutout'];
    case 'image':
      return ['basic', 'animation', 'adjust', 'cutout'];
    case 'audio':
      return ['audio', 'speed'];
    case 'text':
      return ['text', 'basic', 'animation'];
    case 'sticker':
      return ['basic', 'animation'];
  }
}

export function Inspector() {
  const clip = useEditor(selectedClip);
  const [tab, setTab] = useState<Tab>('basic');
  const tabs = clip ? tabsFor(clip) : [];
  const active = tabs.includes(tab) ? tab : tabs[0];

  useEffect(() => {
    if (clip?.kind === 'text') setTab('text');
  }, [clip?.id, clip?.kind]);

  if (!clip) return <ProjectPanel />;

  return (
    <aside className="inspector panel">
      <header className="insp-head">
        <span className={`kind-dot kind-${clip.kind}`} />
        <strong title={clip.name}>{clip.name}</strong>
        <small>
          {formatTimecode(clip.start)} &middot; {clip.duration.toFixed(2)}s
        </small>
      </header>
      <QuickActions clip={clip} />
      <nav className="insp-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={active === t} className={active === t ? 'on' : ''} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      <div className="insp-body">
        {active === 'text' && <TextPanel clip={clip} />}
        {active === 'basic' && <BasicPanel clip={clip} />}
        {active === 'audio' && <AudioPanel clip={clip} />}
        {active === 'speed' && <SpeedPanel clip={clip} />}
        {active === 'animation' && <AnimationPanel clip={clip} />}
        {active === 'adjust' && <AdjustPanel clip={clip} />}
        {active === 'cutout' && <CutoutPanel clip={clip} />}
        {active === 'spotlight' && <SpotlightPanel clip={clip} />}
      </div>
    </aside>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(1)}s`;

function BasicPanel({ clip }: { clip: Clip }) {
  const reset = () =>
    updateSelected((c) => ({
      transform: { ...c.transform, x: 0, y: 0, scale: 1, rotation: 0 },
      keyframes: c.keyframes?.volume ? { volume: c.keyframes.volume } : undefined,
    }));
  const pos = (v: number) => (v * 100).toFixed(1);
  return (
    <>
      <Section
        title="Transform"
        action={
          <span className="row-btns">
            <KeyframeNav clip={clip} />
            <button className="link-btn" onClick={reset}>
              Reset
            </button>
          </span>
        }
      >
        <p className="hint subtle">Tap ◆ to keyframe a value at the playhead; change it elsewhere to animate.</p>
        <KeySlider clip={clip} prop="scale" label="Scale" min={0.05} max={5} step={0.01} format={pct} defaultValue={1} />
        <KeySlider clip={clip} prop="x" label="Position X" min={-1} max={1} step={0.001} format={pos} defaultValue={0} />
        <KeySlider clip={clip} prop="y" label="Position Y" min={-1} max={1} step={0.001} format={pos} defaultValue={0} />
        <KeySlider clip={clip} prop="rotation" label="Rotation" min={-180} max={180} step={0.5} format={(v) => `${v.toFixed(1)}°`} defaultValue={0} />
        <KeySlider clip={clip} prop="opacity" label="Opacity" min={0} max={1} step={0.01} format={pct} defaultValue={1} />
      </Section>
      {(clip.kind === 'video' || clip.kind === 'image') && <CropSection clip={clip} />}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <Section title="Canvas fit">
          <Segmented
            value={clip.fit}
            onChange={(fit) => updateSelected({ fit })}
            options={[
              { value: 'contain', label: 'Fit' },
              { value: 'cover', label: 'Fill' },
            ]}
          />
        </Section>
      )}
    </>
  );
}

function TextPanel({ clip }: { clip: Clip }) {
  const t = clip.text!;
  const set = (patch: Partial<TextStyle>) =>
    updateSelected((c) => {
      const text = { ...c.text!, ...patch };
      return { text, name: text.content.split('\n')[0].slice(0, 40) || 'Text' };
    });
  return (
    <>
      <Section title="Content">
        <textarea
          id="text-content"
          className="text-input"
          rows={3}
          value={t.content}
          onChange={(e) => set({ content: e.target.value })}
          onFocus={gestureProps.onFocus}
          onBlur={gestureProps.onBlur}
        />
      </Section>
      <Section title="Font">
        <select className="select" value={t.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {fontLabel(f)}
            </option>
          ))}
        </select>
        <Slider label="Size" value={t.fontSize} min={16} max={320} defaultValue={96} onChange={(fontSize) => set({ fontSize })} />
        <div className="row-btns">
          <button className={`chip-btn square ${t.bold ? 'on' : ''}`} onClick={() => set({ bold: !t.bold })} title="Bold">
            <b>B</b>
          </button>
          <button className={`chip-btn square ${t.italic ? 'on' : ''}`} onClick={() => set({ italic: !t.italic })} title="Italic">
            <i>I</i>
          </button>
          <Segmented
            value={t.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </div>
      </Section>
      <Section title="Style">
        <ColorField label="Color" value={t.color} onChange={(color) => set({ color })} />
        <ColorField label="Stroke" value={t.strokeColor} onChange={(strokeColor) => set({ strokeColor, strokeWidth: t.strokeWidth || 6 })} />
        <Slider label="Stroke width" value={t.strokeWidth} min={0} max={20} defaultValue={0} onChange={(strokeWidth) => set({ strokeWidth })} />
        <Toggle label="Background" checked={!!t.background} onChange={(on) => set({ background: on ? 'rgba(0,0,0,0.6)' : null })} />
        {t.background && <ColorField label="Background color" value={t.background} onChange={(background) => set({ background })} />}
        <Toggle label="Shadow" checked={t.shadow} onChange={(shadow) => set({ shadow })} />
      </Section>
    </>
  );
}

function AudioPanel({ clip }: { clip: Clip }) {
  const asset = useEditor((s) => (clip.assetId ? s.assets[clip.assetId] : undefined));
  const silent = asset && asset.waveform && !asset.hasAudio;
  return (
    <>
      {silent && <p className="muted small">This clip has no audio track.</p>}
      <Section title="Volume">
        <KeySlider clip={clip} prop="volume" label="Volume" min={0} max={2} step={0.01} format={pct} defaultValue={1} />
        <Toggle label="Mute clip" checked={clip.volume === 0} onChange={(m) => updateSelected({ volume: m ? 0 : 1 })} />
      </Section>
      <BeatSection clip={clip} />
      <Section title="Fades">
        <Slider label="Fade in" value={clip.audioFadeIn} min={0} max={Math.min(10, clip.duration / 2)} step={0.1} format={secs} defaultValue={0} onChange={(audioFadeIn) => updateSelected({ audioFadeIn })} />
        <Slider label="Fade out" value={clip.audioFadeOut} min={0} max={Math.min(10, clip.duration / 2)} step={0.1} format={secs} defaultValue={0} onChange={(audioFadeOut) => updateSelected({ audioFadeOut })} />
      </Section>
    </>
  );
}

function SpeedPanel({ clip }: { clip: Clip }) {
  const setSpeed = (speed: number, history = true) => edit((p) => setClipSpeed(p, clip.id, speed), history);
  return (
    <>
    <Section title="Speed">
      <div className="speed-grid">
        {SPEED_PRESETS.map((s) => (
          <button key={s} className={`chip-btn ${clip.speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <Slider
        label="Custom"
        value={Math.log2(clip.speed)}
        min={-3}
        max={3.32}
        step={0.01}
        format={() => `${clip.speed.toFixed(2)}x`}
        defaultValue={0}
        onChange={(v) => setSpeed(Math.round(2 ** v * 100) / 100)}
      />
      <p className="muted small">
        Duration {clip.duration.toFixed(2)}s. Later clips on this track shift to make room.
      </p>
    </Section>
    {clip.kind === 'video' && <CurveSection clip={clip} />}
    </>
  );
}

function AnimationPanel({ clip }: { clip: Clip }) {
  const hasPrev = useEditor((s) => !!neighbours(s.project, clip).prev);
  const maxAnim = Math.max(0.1, Math.min(3, clip.duration));
  return (
    <>
      <Section title="In">
        <AnimGrid value={clip.animIn} onChange={(animIn) => updateSelected({ animIn })} />
        {clip.animIn !== 'none' && (
          <Slider label="Duration" value={Math.min(clip.animInDur, maxAnim)} min={0.1} max={maxAnim} step={0.05} format={secs} onChange={(animInDur) => updateSelected({ animInDur })} />
        )}
      </Section>
      <Section title="Out">
        <AnimGrid value={clip.animOut} onChange={(animOut) => updateSelected({ animOut })} />
        {clip.animOut !== 'none' && (
          <Slider label="Duration" value={Math.min(clip.animOutDur, maxAnim)} min={0.1} max={maxAnim} step={0.05} format={secs} onChange={(animOutDur) => updateSelected({ animOutDur })} />
        )}
      </Section>
      {clip.kind !== 'audio' && (
        <Section title="Transition in">
          {!hasPrev && <p className="muted small">Place this clip right after another on the same track to see the transition.</p>}
          <select className="select" value={clip.transition} onChange={(e) => updateSelected({ transition: e.target.value as TransitionKind })}>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {clip.transition !== 'none' && (
            <Slider label="Duration" value={Math.min(clip.transitionDur, maxAnim)} min={0.1} max={maxAnim} step={0.05} format={secs} onChange={(transitionDur) => updateSelected({ transitionDur })} />
          )}
        </Section>
      )}
    </>
  );
}

function AnimGrid({ value, onChange }: { value: AnimKind; onChange: (v: AnimKind) => void }) {
  return (
    <div className="anim-grid">
      {ANIMATIONS.map((a) => (
        <button key={a.id} className={`chip-btn ${value === a.id ? 'on' : ''}`} onClick={() => onChange(a.id)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

function AdjustPanel({ clip }: { clip: Clip }) {
  const a = clip.adjust;
  const set = (patch: Partial<Clip['adjust']>) => updateSelected((c) => ({ adjust: { ...c.adjust, ...patch } }));
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  return (
    <>
      <Section title="Filter">
        <select className="select" value={clip.filter} onChange={(e) => updateSelected({ filter: e.target.value })}>
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Section>
      <Section
        title="Adjust"
        action={
          <button className="link-btn" onClick={() => updateSelected({ adjust: { ...DEFAULT_ADJUST } })}>
            Reset
          </button>
        }
      >
        <Slider label="Brightness" value={a.brightness} min={-100} max={100} format={signed} defaultValue={0} onChange={(brightness) => set({ brightness })} />
        <Slider label="Contrast" value={a.contrast} min={-100} max={100} format={signed} defaultValue={0} onChange={(contrast) => set({ contrast })} />
        <Slider label="Saturation" value={a.saturation} min={-100} max={100} format={signed} defaultValue={0} onChange={(saturation) => set({ saturation })} />
        <Slider label="Hue" value={a.hue} min={-180} max={180} format={(v) => `${v}°`} defaultValue={0} onChange={(hue) => set({ hue })} />
        <Slider label="Blur" value={a.blur} min={0} max={20} step={0.5} defaultValue={0} onChange={(blur) => set({ blur })} />
        <Slider label="Vignette" value={a.vignette} min={0} max={100} defaultValue={0} onChange={(vignette) => set({ vignette })} />
      </Section>
    </>
  );
}

function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const { settings } = project;
  const aspect = aspectIdFor(settings.width, settings.height);
  const setSettings = (patch: Partial<typeof settings>) => edit((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  return (
    <aside className="inspector panel">
      <header className="insp-head">
        <Icon name="film" size={16} />
        <strong>Project</strong>
      </header>
      <div className="insp-body">
        <Section title="Name">
          <input
            className="text-input"
            defaultValue={project.name}
            key={project.id + project.name}
            onBlur={(e) => renameProject(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Section>
        <Section title="Aspect ratio">
          <div className="ratio-grid">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.id}
                className={`chip-btn ${aspect === a.id ? 'on' : ''}`}
                title={a.hint}
                onClick={() => setSettings({ width: a.width, height: a.height })}
              >
                <span className="ratio-shape" style={{ aspectRatio: `${a.width}/${a.height}` }} />
                {a.label}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Background">
          <ColorField label="Canvas color" value={settings.background} onChange={(background) => setSettings({ background })} />
        </Section>
        <Section title="Frame rate">
          <Segmented
            value={settings.fps}
            onChange={(fps) => setSettings({ fps })}
            options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: String(f) }))}
          />
        </Section>
        <Section title="Shortcuts">
          <dl className="shortcuts">
            <dt>Space</dt>
            <dd>Play / pause</dd>
            <dt>S</dt>
            <dd>Split at playhead</dd>
            <dt>Del</dt>
            <dd>Delete clip</dd>
            <dt>Ctrl+D</dt>
            <dd>Duplicate</dd>
            <dt>Ctrl+Z</dt>
            <dd>Undo</dd>
            <dt>Left / Right</dt>
            <dd>Step one frame</dd>
            <dt>Home / End</dt>
            <dd>Jump to start / end</dd>
            <dt>Ctrl+Wheel</dt>
            <dd>Zoom timeline</dd>
          </dl>
        </Section>
      </div>
    </aside>
  );
}

function BeatSection({ clip }: { clip: Clip }) {
  const asset = useEditor((s) => (clip.assetId ? s.assets[clip.assetId] : undefined));
  const busy = useEditor((s) => !!s.task);
  const [every, setEvery] = useState(2);
  if (!asset || (clip.kind !== 'audio' && clip.kind !== 'video')) return null;
  return (
    <Section title="Beat sync" action={asset.bpm ? <span className="bpm-badge">{asset.bpm} BPM</span> : undefined}>
      <button className="btn block" disabled={busy} onClick={() => void detectBeatsSelected()}>
        <Icon name="beat" /> {asset.beats ? 'Mark beats on the timeline' : 'Find beats'}
      </button>
      <div className="beat-cut">
        <span className="muted small">Cut every</span>
        <Segmented value={every} onChange={setEvery} options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))} />
        <span className="muted small">beats</span>
      </div>
      <button className="btn block" disabled={busy || !asset.beats} onClick={() => void cutToBeat(every)}>
        <Icon name="wand" /> Sync cuts to the beat
      </button>
    </Section>
  );
}
