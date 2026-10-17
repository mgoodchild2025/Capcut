import { type ReactNode } from 'react';
import { beginGesture, endGesture } from '../store';

/** Props that fold a continuous interaction (drag, typing) into a single undo step. */
export const gestureProps = {
  onPointerDown: beginGesture,
  onPointerUp: endGesture,
  onPointerCancel: endGesture,
  onFocus: beginGesture,
  onBlur: endGesture,
};

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  defaultValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  defaultValue?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span
          className="slider-val"
          title={defaultValue !== undefined ? 'Double-click to reset' : undefined}
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        >
          {format ? format(value) : Math.round(value * 100) / 100}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        {...gestureProps}
      />
    </label>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-swatch" style={{ background: value }}>
        <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} {...gestureProps} />
      </span>
    </label>
  );
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="insp-section">
      <header>
        <h4>{title}</h4>
        {action}
      </header>
      {children}
    </section>
  );
}
