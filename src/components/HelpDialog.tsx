import { Icon } from '../ui/Icon';

const GROUPS: [string, [string, string][]][] = [
  [
    'Playback',
    [
      ['Space', 'Play / pause'],
      ['← / →', 'Step one frame (Shift: 10)'],
      ['Home / End', 'Jump to start / end'],
    ],
  ],
  [
    'Editing',
    [
      ['S or B', 'Split at playhead'],
      ['Delete', 'Delete clip (Shift: ripple)'],
      ['Ctrl/⌘ D', 'Duplicate'],
      ['Ctrl/⌘ Z', 'Undo (Shift: redo)'],
      ['Ctrl/⌘ Alt C / V', 'Copy / paste style'],
      ['Esc', 'Deselect or cancel picking'],
    ],
  ],
  [
    'Timeline',
    [
      ['M', 'Add marker'],
      ['N', 'Toggle snapping (hold Alt to bypass)'],
      ['+ / -', 'Zoom in / out'],
      ['Ctrl/⌘ + wheel', 'Zoom around the cursor'],
    ],
  ],
  [
    'Touch',
    [
      ['Tap', 'Select a clip'],
      ['Drag selected', 'Move or trim it'],
      ['Pinch timeline', 'Zoom'],
      ['Pinch / twist preview', 'Scale / rotate the selection'],
    ],
  ],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <h3 id="help-title">Shortcuts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="help-grid">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h4>{title}</h4>
              <dl className="shortcuts">
                {rows.map(([k, v]) => (
                  <div key={k} className="sc-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
