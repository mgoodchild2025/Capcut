import { useEffect, useMemo, useRef, useState } from 'react';
import { addRalliesToTimeline, analyzeMatchIn, reelFromRallies, updateRally } from '../actions';
import type { MatchRally } from '../model/types';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';

/**
 * A full game, point by point: every rally found in the video, to watch one at a time or back to
 * back (the whole game without the pauses), trim, and turn into a reel.
 */
export function MatchView() {
  const assets = useEditor((s) => s.assets);
  const matches = useEditor((s) => s.project.matches);
  const task = useEditor((s) => s.task);
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && !a.internal && !/reversed/.test(a.name));
  const [assetId, setAssetId] = useState<string>(() => useEditor.getState().match?.assetId ?? videos.slice().sort((a, b) => b.duration - a.duration)[0]?.id ?? '');
  const asset = assets[assetId];
  const match = matches?.[assetId];
  const rallies = useMemo(() => (match?.rallies ?? []).slice().sort((a, b) => a.start - b.start), [match]);
  const [current, setCurrent] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [playAll, setPlayAll] = useState(false);
  const [sort, setSort] = useState<'time' | 'best'>('time');
  const video = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const close = () => {
    video.current?.pause();
    useEditor.setState({ match: null });
  };
  const idx = rallies.findIndex((r) => r.id === current);
  const cur = idx >= 0 ? rallies[idx] : null;
  const shown = sort === 'best' ? rallies.slice().sort((a, b) => b.score - a.score) : rallies;
  const analysing = task?.label === 'Analysing the match';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !analysing && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Play a rally from its start; at its end, stop (or move on to the next one when playing all).
  const go = (r: MatchRally | undefined, play = true) => {
    const v = video.current;
    if (!r || !v) return;
    setCurrent(r.id);
    v.currentTime = r.start;
    if (play) void v.play().catch(() => {});
    listRef.current?.querySelector(`[data-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => {
      if (!cur || v.paused) return;
      if (v.currentTime >= cur.end) {
        if (playAll && idx + 1 < rallies.length) go(rallies[idx + 1]);
        else {
          v.pause();
          if (playAll) setPlayAll(false);
        }
      }
    };
    v.addEventListener('timeupdate', tick);
    return () => v.removeEventListener('timeupdate', tick);
  });

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const nudge = (r: MatchRally, edge: 'start' | 'end', d: number) => {
    const v = Math.max(0, Math.min(asset?.duration ?? Infinity, r[edge] + d));
    if (edge === 'start' ? v < r.end - 1 : v > r.start + 1) updateRally(assetId, r.id, { [edge]: v });
  };
  const total = rallies.reduce((s, r) => s + r.end - r.start, 0);

  return (
    <div className="modal-backdrop wiz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !analysing && close()}>
      <div className="wizard match-view" role="dialog" aria-modal="true" aria-labelledby="match-title">
        <header className="wiz-head">
          <div className="wiz-brand">
            <Icon name="film" size={22} />
            <h2 id="match-title">Match</h2>
          </div>
          {videos.length > 1 && (
            <select className="select match-source" value={assetId} onChange={(e) => (setAssetId(e.target.value), setCurrent(null), setPicked([]))} aria-label="Game video">
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({formatDuration(v.duration)})
                </option>
              ))}
            </select>
          )}
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={analysing}>
            <Icon name="close" />
          </button>
        </header>
        <div className="wiz-body match-body">
          {!asset ? (
            <p className="wiz-lede">Import a game video first (Media), then come back here to break it down rally by rally.</p>
          ) : (
            <>
              <section className="match-player">
                <video ref={video} src={asset.url} playsInline controls={false} onClick={() => (video.current?.paused ? void video.current.play() : video.current?.pause())} />
                <div className="match-transport">
                  <button className="icon-btn" aria-label="Previous rally" disabled={idx <= 0} onClick={() => go(rallies[idx - 1])}>
                    <Icon name="stepBack" size={16} />
                  </button>
                  <button className="btn" disabled={!rallies.length} onClick={() => go(cur ?? rallies[0])}>
                    <Icon name="play" /> {cur ? `Rally ${idx + 1}` : 'First rally'}
                  </button>
                  <button
                    className={`btn ${playAll ? 'primary' : ''}`}
                    disabled={!rallies.length}
                    onClick={() => {
                      setPlayAll(true);
                      go(cur ?? rallies[0]);
                    }}
                    title="Every rally back to back: the whole game without the pauses"
                  >
                    <Icon name="film" /> Play all
                  </button>
                  <button className="icon-btn" aria-label="Next rally" disabled={idx < 0 ? !rallies.length : idx >= rallies.length - 1} onClick={() => go(rallies[idx + 1])}>
                    <Icon name="stepFwd" size={16} />
                  </button>
                </div>
                {cur && (
                  <div className="match-edit">
                    <span>
                      <strong>Rally {idx + 1}</strong> {formatDuration(cur.start)}–{formatDuration(cur.end)} · {Math.round(cur.end - cur.start)}s
                    </span>
                    <span className="match-nudge" aria-label="Start">
                      Start
                      <button className="mini" aria-label="Start earlier" onClick={() => nudge(cur, 'start', -0.5)}>
                        −
                      </button>
                      <button className="mini" aria-label="Start later" onClick={() => nudge(cur, 'start', 0.5)}>
                        +
                      </button>
                    </span>
                    <span className="match-nudge" aria-label="End">
                      End
                      <button className="mini" aria-label="End earlier" onClick={() => nudge(cur, 'end', -0.5)}>
                        −
                      </button>
                      <button className="mini" aria-label="End later" onClick={() => nudge(cur, 'end', 0.5)}>
                        +
                      </button>
                    </span>
                    <button className="link-btn" onClick={() => (updateRally(assetId, cur.id, null), setCurrent(rallies[idx + 1]?.id ?? null))}>
                      Not a rally
                    </button>
                  </div>
                )}
              </section>

              <section className="match-list">
                <div className="match-list-head">
                  {match ? (
                    <>
                      <strong>
                        {rallies.length} rallies · {formatDuration(total)} of play
                      </strong>
                      <div className="segmented" role="radiogroup" aria-label="Order">
                        <button role="radio" aria-checked={sort === 'time'} className={sort === 'time' ? 'on' : ''} onClick={() => setSort('time')}>
                          In order
                        </button>
                        <button role="radio" aria-checked={sort === 'best'} className={sort === 'best' ? 'on' : ''} onClick={() => setSort('best')}>
                          Best first
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="wiz-lede">Find every rally in this game: whistles, crowd and movement on court show where each point starts and ends.</p>
                  )}
                  <div className="match-list-actions">
                    <button className={`btn ${match ? '' : 'primary'}`} disabled={!!task} onClick={() => void analyzeMatchIn(assetId).then((ok) => ok && setPicked([]))}>
                      <Icon name="sparkle" /> {match ? 'Analyse again' : 'Find every rally'}
                    </button>
                    {rallies.length > 0 && (
                      <button className="btn" onClick={() => setPicked(rallies.slice().sort((a, b) => b.score - a.score).slice(0, 8).map((r) => r.id))}>
                        <Icon name="star" /> Pick the best 8
                      </button>
                    )}
                  </div>
                </div>
                {analysing && (
                  <div className="caption-progress">
                    <span>Listening for whistles and watching the court... {Math.round((task?.progress ?? 0) * 100)}%</span>
                    <div className="bar">
                      <i style={{ width: `${Math.round((task?.progress ?? 0) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <ol className="rally-list" ref={listRef}>
                  {shown.map((r) => {
                    const n = rallies.indexOf(r) + 1;
                    const on = picked.includes(r.id);
                    return (
                      <li key={r.id} data-id={r.id} className={`rally ${current === r.id ? 'current' : ''}`}>
                        <button className={`rally-pick ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`Pick rally ${n}`} onClick={() => toggle(r.id)}>
                          {on && <Icon name="check" size={14} />}
                        </button>
                        <button className="rally-main" onClick={() => go(r)}>
                          <span className="rally-thumb">{r.thumb && <img src={r.thumb} alt="" />}</span>
                          <span className="rally-meta">
                            <strong>
                              #{n} · {formatDuration(r.start)} · {Math.round(r.end - r.start)}s
                            </strong>
                            <small>{r.reasons.join(' · ') || 'Rally'}</small>
                            <span className="hl-score">
                              <i style={{ width: `${r.score}%` }} />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </>
          )}
        </div>
        <footer className="wiz-foot">
          <span className="wiz-summary">{picked.length ? `${picked.length} picked` : match ? 'Tick rallies to use them' : asset ? asset.name : ''}</span>
          <div className="wiz-actions">
            <button className="btn" disabled={!picked.length} onClick={() => (addRalliesToTimeline(assetId, picked), close())}>
              <Icon name="plus" /> Add to timeline
            </button>
            <button className="btn primary go" disabled={!picked.length} onClick={() => reelFromRallies(assetId, picked)}>
              <Icon name="wand" /> Make a reel
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
