import { useState } from 'react';
import { updateSelected } from '../actions';
import { FULL_FRAME } from '../engine/graphics';
import { loadImage, renderPoster, shareImages } from '../engine/poster';
import { POSTER_FORMATS } from '../templates/posters';
import type { Clip, GraphicLook, GraphicSpec } from '../model/types';
import { edit, toast, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { ColorField, gestureProps, Section, Toggle } from '../ui/controls';

/** Labels for the text fields graphics use, in the order they're shown. */
const FIELDS: [string, string][] = [
  ['kicker', 'Kicker'],
  ['award', 'Award'],
  ['title', 'Title'],
  ['week', 'Week'],
  ['first', 'First name'],
  ['last', 'Last name'],
  ['name', 'Name'],
  ['number', 'Number'],
  ['position', 'Position'],
  ['detail', 'Detail'],
  ['tag', 'Play'],
  ['usName', 'Our team'],
  ['us', 'Our score'],
  ['usSub', 'Our line'],
  ['themName', 'Opponent'],
  ['them', 'Their score'],
  ['themSub', 'Their line'],
  ['score', 'Score'],
  ['college', 'College'],
  ['set', 'Set'],
  ['result', 'Result'],
  ['sub', 'Lines'],
  ['count', 'Counter'],
];
const MULTILINE = new Set(['title', 'sub']);

/** The analyst's pen: draw, undo and clear the marks. */
function TelestratorPanel({ clip }: { clip: Clip }) {
  const draw = useEditor((s) => s.draw);
  const marks = clip.graphic!.marks ?? [];
  const color = clip.graphic!.colors[1];
  return (
    <Section title="Telestrator">
      <p className="muted small">
        {marks.length ? `${marks.length} mark${marks.length === 1 ? '' : 's'}. ` : ''}Marks draw themselves in one after another when the clip plays.
      </p>
      <button className={`btn block ${draw ? '' : 'primary'}`} onClick={() => useEditor.setState({ draw: draw ? null : { tool: 'circle', color } })}>
        <Icon name="edit" /> {draw ? 'Stop drawing' : 'Draw on the preview'}
      </button>
      {marks.length > 0 && (
        <button className="btn block" onClick={() => updateSelected((c) => ({ graphic: { ...c.graphic!, marks: [] } }))}>
          <Icon name="trash" /> Clear all marks
        </button>
      )}
    </Section>
  );
}

/** Saves a full-screen graphic, finished, as an image: at the project's size or all three post sizes. */
function SaveAsImage({ clip }: { clip: Clip }) {
  const [busy, setBusy] = useState(false);
  const save = async (all: boolean) => {
    setBusy(true);
    try {
      const { assets, project } = useEditor.getState();
      const g = clip.graphic!;
      const ids = [g.logo, g.oppLogo, ...(g.players ?? []).map((p) => p.photo)].filter((x): x is string => !!x);
      const images: Record<string, HTMLImageElement | null> = {};
      for (const id of ids) images[id] = await loadImage(assets[id]?.url);
      const own = clip.assetId ? assets[clip.assetId] : undefined;
      // A clip's still: its own image, or the thumbnail of a video.
      const media = own ? await loadImage(own.kind === 'image' ? own.url : own.thumbnail) : null;
      const sizes: [number, number][] = all ? POSTER_FORMATS.map((f) => f.size) : [[project.settings.width, project.settings.height]];
      const base = (clip.name || g.type).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'graphic';
      const files: File[] = [];
      for (const [w, h] of sizes) files.push(new File([await renderPoster(g, [w, h], images, media)], `${base}-${w}x${h}.png`, { type: 'image/png' }));
      if ((await shareImages(files)) === 'downloaded') toast(files.length > 1 ? `Saved ${files.length} images` : `Saved ${files[0].name}`);
    } catch (e) {
      toast(`Couldn't make the image: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Image">
      <p className="muted small">The finished graphic as a picture to post.</p>
      <button className="btn block primary" disabled={busy} onClick={() => void save(false)}>
        <Icon name="image" /> {busy ? 'Making...' : 'Save as image'}
      </button>
      <button className="btn block" disabled={busy} onClick={() => void save(true)}>
        Story, post and wide sizes
      </button>
    </Section>
  );
}

/** Edit a broadcast graphic: its words, team colours and stat rows. */
export function GraphicPanel({ clip }: { clip: Clip }) {
  const g = clip.graphic!;
  const set = (patch: Partial<GraphicSpec>) => updateSelected((c) => ({ graphic: { ...c.graphic!, ...patch } }));
  const setText = (key: string, value: string) => updateSelected((c) => ({ graphic: { ...c.graphic!, text: { ...c.graphic!.text, [key]: value } } }));
  const fields = FIELDS.filter(([k]) => k in g.text);
  if (g.type === 'telestrator') return <TelestratorPanel clip={clip} />;
  return (
    <>
      {fields.length > 0 && (
        <Section title="Words">
          {fields.map(([key, label]) => (
            <label key={key} className="graphic-field">
              <span>{label}</span>
              {MULTILINE.has(key) ? (
                <textarea className="text-input" rows={2} value={g.text[key]} onChange={(e) => setText(key, e.target.value)} onFocus={gestureProps.onFocus} onBlur={gestureProps.onBlur} />
              ) : (
                <input className="text-input" value={g.text[key]} onChange={(e) => setText(key, e.target.value)} onFocus={gestureProps.onFocus} onBlur={gestureProps.onBlur} />
              )}
            </label>
          ))}
        </Section>
      )}
      {g.rows && (
        <Section title="Stats">
          {g.rows.map(([k, v], i) => (
            <div key={i} className="graphic-row">
              <input className="text-input" aria-label="Stat" value={k} onChange={(e) => set({ rows: g.rows!.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) })} />
              <input className="text-input" aria-label={`${k} value`} value={v} onChange={(e) => set({ rows: g.rows!.map((r, j) => (j === i ? [r[0], e.target.value] : r)) })} />
            </div>
          ))}
        </Section>
      )}
      <Section title="Look">
        <select
          className="select"
          aria-label="Graphics look"
          value={g.look ?? 'broadcast'}
          onChange={(e) => {
            const look = e.target.value as GraphicLook;
            // One package per reel: restyle every graphic together.
            edit((p) => ({ ...p, clips: p.clips.map((c) => (c.graphic ? { ...c, graphic: { ...c.graphic, look } } : c)) }));
          }}
        >
          <option value="broadcast">Broadcast</option>
          <option value="championship">Championship</option>
          <option value="neon">Neon</option>
          <option value="classic">Classic</option>
        </select>
        <p className="hint subtle">Changes every graphic in the reel.</p>
      </Section>
      <Section title="Team colours">
        <ColorField label="Primary" value={g.colors[0]} onChange={(v) => set({ colors: [v, g.colors[1]] })} />
        <ColorField label="Accent" value={g.colors[1]} onChange={(v) => set({ colors: [g.colors[0], v] })} />
      </Section>
      {g.oppColors && (
        <Section title="Opponent colours">
          <ColorField label="Primary" value={g.oppColors[0]} onChange={(v) => set({ oppColors: [v, g.oppColors![1]] })} />
          <ColorField label="Accent" value={g.oppColors[1]} onChange={(v) => set({ oppColors: [g.oppColors![0], v] })} />
        </Section>
      )}
      {FULL_FRAME.includes(g.type) && <SaveAsImage clip={clip} />}
      {g.type === 'playerCard' && g.media === 'image' && (
        <Section title="Photo">
          {g.depth && <Toggle label="Living photo (3D camera move)" checked={!g.still} onChange={(v) => set({ still: !v })} />}
          <Toggle label="Cut-out style (photo has no background)" checked={!!g.cutout} onChange={(v) => set({ cutout: v })} />
        </Section>
      )}
    </>
  );
}
