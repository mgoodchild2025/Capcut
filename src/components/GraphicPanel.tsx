import { updateSelected } from '../actions';
import type { Clip, GraphicLook, GraphicSpec } from '../model/types';
import { edit, useEditor } from '../store';
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
      {g.type === 'playerCard' && g.media === 'image' && (
        <Section title="Photo">
          {g.depth && <Toggle label="Living photo (3D camera move)" checked={!g.still} onChange={(v) => set({ still: !v })} />}
          <Toggle label="Cut-out style (photo has no background)" checked={!!g.cutout} onChange={(v) => set({ cutout: v })} />
        </Section>
      )}
    </>
  );
}
