import { useState } from 'react';
import { addHighlightsToTimeline, addSticker, addTelestrator, addText, findHighlightsIn } from '../actions';
import { highlightKey, toggleHighlight, useHighlights } from '../ai/highlightState';
import { FONTS } from '../model/presets';
import type { TextStyle } from '../model/types';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';

const VB_TEXT: { label: string; style: Partial<TextStyle> }[] = [
  { label: 'KILL!', style: { content: 'KILL!', fontFamily: FONTS[1], fontSize: 150, color: '#ffffff', strokeColor: '#ef4444', strokeWidth: 10, bold: true } },
  { label: 'ACE!', style: { content: 'ACE!', fontFamily: FONTS[1], fontSize: 150, color: '#fde047', strokeColor: '#111111', strokeWidth: 10, bold: true } },
  { label: 'BLOCK!', style: { content: 'BLOCK!', fontFamily: FONTS[1], fontSize: 140, color: '#ffffff', strokeColor: '#2563eb', strokeWidth: 10, bold: true } },
  { label: 'DIG!', style: { content: 'DIG!', fontFamily: FONTS[1], fontSize: 140, color: '#4ade80', strokeColor: '#052e16', strokeWidth: 10, bold: true } },
  { label: '#12 Name', style: { content: '#12  JORDAN LEE\nOUTSIDE HITTER · 2027', fontSize: 52, background: 'rgba(0,0,0,0.7)', align: 'left', shadow: false } },
  { label: 'Score', style: { content: 'HOME 24  –  22 AWAY', fontFamily: '"Courier New", monospace', fontSize: 54, background: '#111827', color: '#fbbf24', shadow: false } },
];

const VB_STICKERS = ['\u{1F3D0}', '\u{1F525}', '\u{1F4AA}', '\u{1F3C6}', '\u{1F947}', '\u{1F4A5}', '\u{26A1}', '\u{1F64C}'];

export function VolleyballTab() {
  const assets = useEditor((s) => s.assets);
  const task = useEditor((s) => s.task);
  const byAsset = useHighlights((s) => s.byAsset);
  const selected = useHighlights((s) => s.selected);
  const [slowmo, setSlowmo] = useState(true);
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && !/reversed/.test(a.name));
  const [source, setSource] = useState<string>('');
  const src = source && assets[source] ? source : (videos.slice().sort((a, b) => b.duration - a.duration)[0]?.id ?? '');
  const results = src ? byAsset[src] : undefined;

  return (
    <div className="vb-tab">
      <button className="vb-hero" onClick={() => useEditor.setState({ wizard: {} })}>
        <span className="vb-hero-art" aria-hidden="true">
          <Icon name="volleyball" size={34} />
        </span>
        <span>
          <strong>Highlight reel</strong>
          <small>Recruiting, hype, spotlight, Play of the Week, team, victory, lineups for one or both teams, or a season recap. Titles, music and spotlights done for you.</small>
        </span>
        <Icon name="chevronRight" />
      </button>
      <button className="vb-hero vb-posters" onClick={() => useEditor.setState({ posters: {} })}>
        <span className="vb-hero-art" aria-hidden="true">
          <Icon name="image" size={30} />
        </span>
        <span>
          <strong>Graphics &amp; posters</strong>
          <small>Game day, final score, victory, player spotlight, Play of the Week, commitment, stats and lineup images to post.</small>
        </span>
        <Icon name="chevronRight" />
      </button>
      <div className="vb-styles">
        {(
          [
            ['recruiting', 'Recruiting'],
            ['hype', 'Hype'],
            ['spotlight', 'Spotlight'],
            ['potw', 'Play of the Week'],
            ['team', 'Team'],
            ['victory', 'Victory'],
            ['lineup', 'Lineup'],
            ['matchup', 'Matchup'],
            ['recap', 'Recap'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className="chip-btn" onClick={() => useEditor.setState({ wizard: { style: id } })}>
            {label}
          </button>
        ))}
      </div>

      <h5 className="lib-h">
        <Icon name="sparkle" size={13} /> Find highlights in game footage
      </h5>
      {videos.length === 0 ? (
        <p className="lib-note">Import a game video. The AI listens for referee whistles and crowd reactions and watches for bursts of action to pick your best rallies.</p>
      ) : (
        <>
          <div className="vb-source">
            <select className="select" value={src} onChange={(e) => setSource(e.target.value)} aria-label="Video to analyse">
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({formatDuration(v.duration)})
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={!!task || !src} onClick={() => void findHighlightsIn(src)}>
              {results ? 'Re-scan' : 'Scan'}
            </button>
          </div>
          {task?.label === 'Finding highlights' && (
            <div className="caption-progress">
              <span>Analysing whistles, crowd and motion...</span>
              <div className="bar">
                <i style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} />
              </div>
            </div>
          )}
          {results && results.length > 0 && (
            <>
              <ul className="hl-list">
                {results.map((h, i) => {
                  const key = highlightKey(h, i);
                  const on = selected.includes(key);
                  return (
                    <li key={key}>
                      <button className={`hl-item ${on ? 'on' : ''}`} onClick={() => toggleHighlight(key)} aria-pressed={on}>
                        <span className="hl-thumb">
                          {h.thumb && <img src={h.thumb} alt="" />}
                          <span className="hl-check">{on && <Icon name="check" size={14} />}</span>
                        </span>
                        <span className="hl-meta">
                          <strong>
                            {formatDuration(h.start)} – {formatDuration(h.end)}
                          </strong>
                          <small>{h.reasons.join(' · ') || 'Action'}</small>
                          <span className="hl-score">
                            <i style={{ width: `${h.score}%` }} />
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label className="toggle">
                <span>Slow-mo on the hit (Hero curve)</span>
                <input type="checkbox" checked={slowmo} onChange={(e) => setSlowmo(e.target.checked)} />
                <span className="toggle-track" aria-hidden="true" />
              </label>
              <div className="row-btns">
                <button className="btn" disabled={!selected.length} onClick={() => void addHighlightsToTimeline(slowmo)}>
                  <Icon name="plus" /> Add {selected.length || ''} to timeline
                </button>
                <button className="btn primary" disabled={!selected.length} onClick={() => useEditor.setState({ wizard: { style: 'recruiting' } })}>
                  <Icon name="wand" /> Make reel
                </button>
              </div>
            </>
          )}
          {results && results.length === 0 && <p className="lib-note">Nothing stood out in that video. Try a longer stretch of game footage.</p>}
        </>
      )}

      <h5 className="lib-h">Analyst's pen</h5>
      <div className="row-btns">
        <button className="btn" disabled={!!task} onClick={() => void addTelestrator(true)} title="Freeze the frame at the playhead and draw on it">
          <Icon name="target" /> Freeze and draw
        </button>
        <button className="btn" onClick={() => void addTelestrator(false)} title="Draw over the moving video">
          <Icon name="edit" /> Draw over video
        </button>
      </div>
      <p className="lib-note">Circles, arrows and lines that draw themselves in, like a TV analyst's telestrator.</p>

      <h5 className="lib-h">Game text</h5>
      <div className="text-grid">
        {VB_TEXT.map((t) => (
          <button key={t.label} className="text-tpl vb-text" onClick={() => addText(t.style)}>
            <span
              style={{
                fontFamily: t.style.fontFamily,
                color: t.style.color,
                background: t.style.background ?? 'transparent',
                padding: t.style.background ? '2px 6px' : 0,
                borderRadius: 3,
                WebkitTextStroke: t.style.strokeWidth ? `1px ${t.style.strokeColor}` : undefined,
                fontSize: 15,
              }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </div>
      <h5 className="lib-h">Stickers</h5>
      <div className="sticker-grid">
        {VB_STICKERS.map((s) => (
          <button key={s} onClick={() => addSticker(s)} title="Add sticker">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
