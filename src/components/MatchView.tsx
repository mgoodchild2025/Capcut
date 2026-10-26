import { useEffect, useMemo, useRef, useState } from 'react';
import { addRalliesToTimeline, analyzeMatchIn, importFiles, playlistToReel, playlistToTimeline, reelFromRallies, savePlaylist, updatePlaylist, updateRally } from '../actions';
import type { MatchRally, PlaylistItem, RallyAction } from '../model/types';
import { ralliesWith, scoreMatch } from '../stats/matchStats';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';
import { isVolley, StatsPanel, SummaryCard, TagPad } from './MatchStats';

/**
 * A full game, point by point: every rally found in the video, to watch one at a time or back to
 * back (the whole game without the pauses), trim, and turn into a reel.
 */
export function MatchView() {
  const assets = useEditor((s) => s.assets);
  const matches = useEditor((s) => s.project.matches);
  const task = useEditor((s) => s.task);
  const playlists = useEditor((s) => s.project.playlists);
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && !a.internal && !/reversed/.test(a.name));
  const [assetId, setAssetId] = useState<string>(() => useEditor.getState().match?.assetId ?? videos.slice().sort((a, b) => b.duration - a.duration)[0]?.id ?? '');
  const asset = assets[assetId];
  const match = matches?.[assetId];
  const all = useMemo(() => (match?.rallies ?? []).slice().sort((a, b) => a.start - b.start), [match]);
  const score = useMemo(() => (match ? scoreMatch(match, isVolley(match)) : null), [match]);
  const scoreOf = useMemo(() => new Map((score?.rallies ?? []).map((s) => [s.rallyId, s])), [score]);
  const [tagPlayer, setTagPlayer] = useState<string | null>(null);
  const [tab, setTab] = useState<'rallies' | 'stats' | 'playlists'>('rallies');
  const [showSummary, setShowSummary] = useState(false);
  // Saving moments to a playlist: the name being typed.
  const [naming, setNaming] = useState<string | null>(null);
  // Playing a playlist: which one and where in it.
  const [pl, setPl] = useState<{ id: string; i: number } | null>(null);
  const plList = playlists?.find((x) => x.id === pl?.id);
  const plItem = pl && plList ? plList.items[pl.i] : undefined;
  // A seek waiting for the video (another game's) to load.
  const pending = useRef<{ t: number; play: boolean } | null>(null);
  // Watching a stat: just the rallies behind it.
  const [filter, setFilter] = useState<{ title: string; ids: string[] } | null>(null);
  const rallies = useMemo(() => (filter ? all.filter((r) => filter.ids.includes(r.id)) : all), [all, filter]);
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
  const watch = (title: string, test: (a: RallyAction) => boolean) => {
    if (!match) return;
    const found = ralliesWith(match, test);
    setFilter({ title, ids: found.map((r) => r.id) });
    setTab('rallies');
    setPlayAll(true);
    setTimeout(() => go(found[0]), 0);
  };
  const analysing = task?.label === 'Analysing the match';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !analysing && naming === null && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Play a rally from its start; at its end, stop (or move on to the next one when playing all).
  const seek = (url: string, t: number, play: boolean) => {
    const v = video.current;
    if (!v) return;
    if (v.src === url && v.readyState >= 1) {
      v.currentTime = t;
      if (play) void v.play().catch(() => {});
    } else pending.current = { t, play };
  };
  const go = (r: MatchRally | undefined, play = true) => {
    const v = video.current;
    if (!r || !v || !asset) return;
    setPl(null);
    setCurrent(r.id);
    seek(asset.url, r.start, play);
    listRef.current?.querySelector(`[data-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => {
      if (v.paused) return;
      if (pl) {
        if (plItem && v.currentTime >= plItem.end) playItem(pl.id, pl.i + 1);
        return;
      }
      if (!cur) return;
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

  const loaded = () => {
    const v = video.current;
    const p = pending.current;
    if (!v || !p) return;
    pending.current = null;
    v.currentTime = p.t;
    if (p.play) void v.play().catch(() => {});
  };
  // Plays item `i` of a playlist, from whichever game it is in; past the end, stops.
  const playItem = (id: string, i: number) => {
    const list = playlists?.find((x) => x.id === id);
    const it = list?.items[i];
    const a = it && assets[it.assetId];
    if (!it || !a) {
      video.current?.pause();
      setPl(null);
      return;
    }
    setCurrent(null);
    setTab('playlists');
    setPl({ id, i });
    seek(a.url, it.start, true);
  };
  const itemsOf = (ids: string[]): PlaylistItem[] =>
    all
      .filter((r) => ids.includes(r.id))
      .map((r) => ({ assetId, start: r.start, end: r.end, rallyId: r.id, label: `${asset?.name.replace(/\.[^.]+$/, '') ?? 'Game'} · #${all.indexOf(r) + 1}` }));
  const toSave = picked.length ? picked : filter ? filter.ids : [];
  const saveTo = (name: string) => {
    savePlaylist(name, itemsOf(toSave));
    setNaming(null);
    setPicked([]);
  };
  // A game straight from the device: in it goes, and the rallies are found straight away.
  const addGame = async (files: FileList | null) => {
    if (!files?.length) return;
    const game = (await importFiles(files)).find((a) => a.kind === 'video');
    if (!game) return;
    setAssetId(game.id);
    setCurrent(null);
    setPicked([]);
    setFilter(null);
    setTab('rallies');
    if (!useEditor.getState().project.matches?.[game.id]) void analyzeMatchIn(game.id);
  };
  const gamePicker = (label: string, primary: boolean) => (
    <label className={`btn ${primary ? 'primary' : ''} ${task ? 'disabled' : ''}`} aria-disabled={!!task}>
      <Icon name="upload" /> <span className={primary ? '' : 'hide-xs'}>{label}</span>
      <input type="file" accept="video/*" hidden disabled={!!task} onChange={(e) => void addGame(e.target.files)} />
    </label>
  );
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
          {asset && gamePicker('Add a game', false)}
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={analysing}>
            <Icon name="close" />
          </button>
        </header>
        <div className="wiz-body match-body">
          {!asset ? (
            <div className="match-empty">
              <p className="wiz-lede">
                Choose a full game video. ClipForge finds every rally (whistles, crowd and movement on court show where each point starts and ends), then you can watch them back to
                back, tag the stats and pick the best.
              </p>
              {gamePicker('Choose the game video', true)}
            </div>
          ) : (
            <>
              <section className="match-player">
                <video
                  ref={video}
                  src={(plItem && assets[plItem.assetId]?.url) || asset.url}
                  onLoadedMetadata={loaded}
                  playsInline
                  controls={false}
                  onClick={() => (video.current?.paused ? void video.current.play() : video.current?.pause())}
                />
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
                {cur && match && tab === 'rallies' && (
                  <TagPad
                    key={cur.id}
                    assetId={assetId}
                    match={match}
                    rally={cur}
                    score={scoreOf.get(cur.id)}
                    onNext={() => go(rallies[idx + 1], true)}
                    player={tagPlayer}
                    setPlayer={setTagPlayer}
                  />
                )}
              </section>

              <section className="match-list">
                {match && (
                  <div className="segmented match-tabs" role="tablist">
                    <button role="tab" aria-selected={tab === 'rallies'} className={tab === 'rallies' ? 'on' : ''} onClick={() => setTab('rallies')}>
                      Rallies
                    </button>
                    <button role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
                      Stats
                    </button>
                    <button role="tab" aria-selected={tab === 'playlists'} className={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>
                      Playlists{playlists?.length ? ` (${playlists.length})` : ''}
                    </button>
                  </div>
                )}
                {tab === 'stats' && match && score && (
                  <>
                    {match.rallies.some((r) => r.won || r.actions?.length) && (
                      <button className={`btn summary-toggle ${showSummary ? 'on' : ''}`} aria-expanded={showSummary} onClick={() => setShowSummary((x) => !x)}>
                        <Icon name="image" /> Game summary for families
                      </button>
                    )}
                    {showSummary && <SummaryCard match={match} />}
                    <StatsPanel match={match} score={score} watch={watch} />
                  </>
                )}
                {tab === 'playlists' && <Playlists playing={pl} play={playItem} onDone={close} />}
                {filter && tab === 'rallies' && (
                  <div className="watch-filter">
                    <span>
                      Watching <b>{filter.title}</b> ({filter.ids.length})
                    </span>
                    <button className="link-btn" onClick={() => (setFilter(null), setPlayAll(false))}>
                      Show all rallies
                    </button>
                  </div>
                )}
                {tab === 'rallies' && (
                  <div className="match-list-head">
                    {match ? (
                      <>
                        <strong>
                          {rallies.length} {rallies.length === 1 ? 'rally' : 'rallies'} · {formatDuration(total)} of play
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
                        <button
                          className="btn"
                          onClick={() =>
                            setPicked(
                              rallies
                                .slice()
                                .sort((a, b) => b.score - a.score)
                                .slice(0, 8)
                                .map((r) => r.id),
                            )
                          }
                        >
                          <Icon name="star" /> Pick the best 8
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {analysing && (
                  <div className="caption-progress">
                    <span>Listening for whistles and watching the court... {Math.round((task?.progress ?? 0) * 100)}%</span>
                    <div className="bar">
                      <i
                        style={{
                          width: `${Math.round((task?.progress ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {tab === 'rallies' && (
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
                                #{all.indexOf(r) + 1} · {formatDuration(r.start)} · {Math.round(r.end - r.start)}s
                                {r.won && <em className={`rally-won ${r.won}`}>{scoreOf.get(r.id)?.after.join('–')}</em>}
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
                )}
              </section>
            </>
          )}
        </div>
        {asset && (
          <footer className="wiz-foot">
            {naming !== null ? (
              <form
                className="pl-name"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTo(naming);
                }}
              >
                <input
                  className="text-input"
                  autoFocus
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  list="pl-names"
                  aria-label="Playlist name"
                  placeholder="Playlist name"
                  onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNaming(null))}
                />
                <datalist id="pl-names">
                  {playlists?.map((x) => (
                    <option key={x.id} value={x.name} />
                  ))}
                </datalist>
                <button className="btn primary" type="submit" disabled={!naming.trim()}>
                  Save {toSave.length}
                </button>
                <button className="btn" type="button" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <span className="wiz-summary">{picked.length ? `${picked.length} picked` : match ? 'Tick rallies to use them' : asset ? asset.name : ''}</span>
            )}
            <div className="wiz-actions">
              {naming === null && (
                <button
                  className="btn pl-save"
                  disabled={!toSave.length}
                  onClick={() => setNaming(filter && !picked.length ? filter.title : (playlists?.[playlists.length - 1]?.name ?? 'Highlights'))}
                  title="Keep these moments in a playlist: for teaching, or the best of the season"
                >
                  <Icon name="star" /> Save to playlist
                </button>
              )}
              <button className="btn" disabled={!picked.length} onClick={() => (addRalliesToTimeline(assetId, picked), close())}>
                <Icon name="plus" /> Add to timeline
              </button>
              <button className="btn primary go" disabled={!picked.length} onClick={() => reelFromRallies(assetId, picked)}>
                <Icon name="wand" /> Make a reel
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

/** Saved playlists: moments from any game, to watch back to back, reorder, or make into a reel. */
function Playlists({ playing, play, onDone }: { playing: { id: string; i: number } | null; play: (id: string, i: number) => void; onDone: () => void }) {
  const playlists = useEditor((s) => s.project.playlists) ?? [];
  const assets = useEditor((s) => s.assets);
  const matches = useEditor((s) => s.project.matches);
  const [open, setOpen] = useState<string | null>(playing?.id ?? null);
  if (!playlists.length)
    return (
      <p className="wiz-lede">
        Tick rallies (or watch a stat), then <b>Save to playlist</b>: a teaching reel of one skill, a player's best moments, the season's top plays. Playlists can take moments from
        every game you've analysed.
      </p>
    );
  const move = (id: string, items: PlaylistItem[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updatePlaylist(id, { items: next });
  };
  return (
    <ul className="playlists">
      {playlists.map((p) => {
        const len = p.items.reduce((s, it) => s + it.end - it.start, 0);
        const games = new Set(p.items.map((it) => it.assetId)).size;
        const expanded = open === p.id;
        return (
          <li key={p.id} className={`playlist ${playing?.id === p.id ? 'playing' : ''}`}>
            <div className="pl-head">
              <button className="pl-title" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                <strong>{p.name}</strong>
                <small>
                  {p.items.length} clip{p.items.length === 1 ? '' : 's'} · {formatDuration(len)}
                  {games > 1 ? ` · ${games} games` : ''}
                </small>
              </button>
              <button className="btn" disabled={!p.items.length} onClick={() => play(p.id, 0)}>
                <Icon name="play" /> Play
              </button>
            </div>
            {expanded && (
              <>
                <input
                  className="text-input pl-rename"
                  aria-label="Playlist name"
                  defaultValue={p.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && updatePlaylist(p.id, { name: e.target.value.trim() })}
                />
                <ol className="pl-items">
                  {p.items.map((it, i) => {
                    const thumb = it.rallyId ? matches?.[it.assetId]?.rallies.find((r) => r.id === it.rallyId)?.thumb : undefined;
                    const missing = !assets[it.assetId];
                    return (
                      <li key={`${it.assetId}-${it.start}-${i}`} className={playing?.id === p.id && playing.i === i ? 'current' : ''}>
                        <button className="pl-item" disabled={missing} onClick={() => play(p.id, i)}>
                          <span className="rally-thumb">{thumb && <img src={thumb} alt="" />}</span>
                          <span>
                            <strong>{it.label ?? `Clip ${i + 1}`}</strong>
                            <small>{missing ? 'Video missing' : `${formatDuration(it.start)} · ${Math.round(it.end - it.start)}s`}</small>
                          </span>
                        </button>
                        <span className="pl-item-tools">
                          <button className="mini" aria-label="Move up" disabled={i === 0} onClick={() => move(p.id, p.items, i, -1)}>
                            ↑
                          </button>
                          <button className="mini" aria-label="Move down" disabled={i === p.items.length - 1} onClick={() => move(p.id, p.items, i, 1)}>
                            ↓
                          </button>
                          <button className="mini" aria-label="Remove from playlist" onClick={() => updatePlaylist(p.id, { items: p.items.filter((_, k) => k !== i) })}>
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <div className="pl-actions">
                  <button className="btn" disabled={!p.items.length} onClick={() => (playlistToTimeline(p.id), onDone())}>
                    <Icon name="plus" /> Add to timeline
                  </button>
                  <button className="btn primary" disabled={!p.items.length} onClick={() => playlistToReel(p.id)}>
                    <Icon name="wand" /> Make a reel
                  </button>
                  <button className="link-btn danger" onClick={() => confirm(`Delete "${p.name}"? The games and rallies stay.`) && updatePlaylist(p.id, null)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
