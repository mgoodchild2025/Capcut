import { updateSelected } from '../actions';
import type { Clip, GraphicSpec } from '../model/types';
import { ColorField, gestureProps, Section, Toggle } from '../ui/controls';

/** Labels for the text fields graphics use, in the order they're shown. */
const FIELDS: [string, string][] = [
  ['kicker', 'Kicker'],
  ['title', 'Title'],
  ['first', 'First name'],
  ['last', 'Last name'],
  ['name', 'Name'],
  ['number', 'Number'],
  ['position', 'Position'],
  ['detail', 'Detail'],
  ['tag', 'Play'],
  ['usName', 'Our team'],
  ['us', 'Our score'],
  ['themName', 'Opponent'],
  ['them', 'Their score'],
  ['set', 'Set'],
  ['result', 'Result'],
  ['sub', 'Lines'],
  ['count', 'Counter'],
];
const MULTILINE = new Set(['title', 'sub']);

/** Edit a broadcast graphic: its words, team colours and stat rows. */
export function GraphicPanel({ clip }: { clip: Clip }) {
  const g = clip.graphic!;
  const set = (patch: Partial<GraphicSpec>) => updateSelected((c) => ({ graphic: { ...c.graphic!, ...patch } }));
  const setText = (key: string, value: string) => updateSelected((c) => ({ graphic: { ...c.graphic!, text: { ...c.graphic!.text, [key]: value } } }));
  const fields = FIELDS.filter(([k]) => k in g.text);
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
      <Section title="Team colours">
        <ColorField label="Primary" value={g.colors[0]} onChange={(v) => set({ colors: [v, g.colors[1]] })} />
        <ColorField label="Accent" value={g.colors[1]} onChange={(v) => set({ colors: [g.colors[0], v] })} />
      </Section>
      {g.type === 'playerCard' && g.media === 'image' && (
        <Section title="Photo">
          <Toggle label="Cut-out style (photo has no background)" checked={!!g.cutout} onChange={(v) => set({ cutout: v })} />
        </Section>
      )}
    </>
  );
}
