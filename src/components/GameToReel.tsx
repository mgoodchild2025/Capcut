import { useEffect, useRef, useState } from 'react';
import { analyzeMatchIn, buildReelFromWizard, importFiles } from '../actions';
import type { MatchRally } from '../model/types';
import { REEL_STYLES, type ReelInfo, type ReelStyle } from '../templates/reel';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';
import { loadInfo, STORE_KEY } from './ReelWizard';

type Who = 'player' | 'team';
type Phase = 'setup' | 'spot' | 'building';
const STYLES: Record<Who, ReelStyle[]> = { player: ['hype', 'spotlight', 'recruiting'], team: ['team', 'victory', 'recap'] };
/** How many of the best rallies go in. */
const COUNT: Record<Who, number> = { player: 8, team: 10 };

interface Spot {
  rally: MatchRally;
  /** Where the player is at the rally's first frame (fractions), and whether the user confirmed it. */
  at?: { x: number; y: number };
  guess?: boolean;
  skip?: boolean;
}

/**
 * A whole game to a finished reel: pick the video and whose reel it is, and ClipForge finds the
 * rallies, keeps the best, asks you to tap your player once (then finds them in the other plays for
 * you to confirm), and builds the reel with its titles, music and spotlights.
 */
export function GameToReel() {
  const assets = useEditor((s) => s.assets);
  const task = useEditor((s) => s.task);
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && !a.internal && !/reversed/.test(a.name));
  const [assetId, setAssetId] = useState<string>(() => videos.slice().sort((a, b) => b.duration - a.duration)[0]?.id ?? '');
  const [info, setInfo] = useState<ReelInfo>(loadInfo);
  const [who, setWho] = useState<Who>('player');
  const [style, setStyle] = useState<ReelStyle>('hype');
  const [phase, setPhase] = useState<Phase>('setup');
  const [spots, setSpots] = useState<Spot[]>([]);
  const [i, setI] = useState(0);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const pixels = useRef<{ w: number; h: number; byId: Map<string, Uint8ClampedArray> } | null>(null);
  const asset = assets[assetId];
  const close = () => useEditor.setState({ quick: null });
  const set = (patch: Partial<ReelInfo>) => setInfo((x) => ({ ...x, ...patch }));
  const busy = !!task;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
  }, [info]);
  useEffect(() => {
    if (!assetId && videos[0]) setAssetId(videos.slice().sort((a, b) => b.duration - a.duration)[0].id);
  }, [assetId, videos]);

  const build = async (list: Spot[]) => {
    setPhase('building');
    const clips = list
      .filter((s) => !s.skip)
      .sort((a, b) => a.rally.start - b.rally.start)
      .map((s) => ({ assetId, inPoint: s.rally.start, duration: s.rally.end - s.rally.start, spotlight: s.at }));
    const ok = await buildReelFromWizard({ style, info, clips, musicId: REEL_STYLES.find((s) => s.id === style)!.music, follow: true, followPlayer: true });
    if (ok) close();
    else setPhase(who === 'player' ? 'spot' : 'setup');
  };

  // Go: the rallies (found now unless they already were), the best of them, then spotting or building.
  const start = async () => {
    if (!asset) return;
    if (!useEditor.getState().project.matches?.[assetId] && !(await analyzeMatchIn(assetId))) return;
    const rallies = useEditor.getState().project.matches?.[assetId]?.rallies ?? [];
    if (!rallies.length) return;
    const best = rallies.slice().sort((a, b) => b.score - a.score).slice(0, COUNT[who]).sort((a, b) => a.start - b.start);
    const list = best.map((rally) => ({ rally }));
    if (who === 'team') return void build(list);
    setSpots(list);
    setI(0);
    setPhase('spot');
  };

  // Frames of each play's start, to tap on, and small pixel copies for finding the player again.
  useEffect(() => {
    if (phase !== 'spot' || !asset) return;
    let cancelled = false;
    (async () => {
      const { captureFrame } = await import('../engine/frames');
      for (const s of spots) {
        if (cancelled) return;
        if (frames[s.rally.id]) continue;
        try {
          const blob = await captureFrame(asset, s.rally.start + 0.05);
          if (!cancelled) setFrames((f) => ({ ...f, [s.rally.id]: URL.createObjectURL(blob) }));
        } catch {
          /* the thumbnail stands in */
        }
      }
      if (!pixels.current) {
        const { framesAt } = await import('../ai/track');
        const got = await framesAt(asset, spots.map((s) => s.rally.start + 0.05));
        if (!cancelled) pixels.current = { w: got.w, h: got.h, byId: new Map(spots.map((s, k) => [s.rally.id, got.frames[k].rgba])) };
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, spots.length]);

  /** After a tap (or a confirmed guess), guess the player in the plays not yet confirmed. */
  const guessFrom = async (fromId: string, at: { x: number; y: number }, list: Spot[]) => {
    const px = pixels.current;
    if (!px) return list;
    const { findLookalike } = await import('../ai/trackCore');
    const src = px.byId.get(fromId)!;
    return list.map((s) => {
      if (s.rally.id === fromId || (s.at && !s.guess) || s.skip) return s;
      const dst = px.byId.get(s.rally.id);
      if (!dst) return s;
      const g = findLookalike(src, dst, px.w, px.h, at);
      return { ...s, at: { x: g.x, y: g.y }, guess: true };
    });
  };

  const spot = spots[i];
  const tap = async (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const marked = spots.map((s, k) => (k === i ? { ...s, at, guess: false, skip: false } : s));
    setSpots(await guessFrom(spot.rally.id, at, marked));
  };
  const confirm = async () => {
    if (!spot?.at) return;
    const marked = spots.map((s, k) => (k === i ? { ...s, guess: false } : s));
    const next = await guessFrom(spot.rally.id, spot.at, marked);
    setSpots(next);
    if (i + 1 < spots.length) setI(i + 1);
    else void build(next);
  };
  const skip = () => {
    const next = spots.map((s, k) => (k === i ? { ...s, skip: true, at: undefined } : s));
    setSpots(next);
    if (i + 1 < spots.length) setI(i + 1);
    else void build(next);
  };
  const vars = { '--team1': info.colors[0], '--team2': info.colors[1] } as React.CSSProperties;
  const color = info.colors[1];
  const name = info.name.trim();

  return (
    <div className="modal-backdrop wiz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="wizard game-to-reel" role="dialog" aria-modal="true" aria-labelledby="g2r-title" style={vars}>
        <header className="wiz-head">
          <div className="wiz-brand">
            <Icon name="wand" size={22} />
            <h2 id="g2r-title">Game to reel</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>
        <div className="wiz-body">
          {phase === 'setup' && (
            <section className="wiz-step g2r-setup">
              <h3 className="wiz-title">Your game</h3>
              <div className="g2r-video">
                {videos.length > 0 && (
                  <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="Game video">
                    {videos.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({formatDuration(v.duration)})
                      </option>
                    ))}
                  </select>
                )}
                <label className={`btn ${videos.length ? '' : 'primary'}`}>
                  <Icon name="upload" /> {videos.length ? 'Another video' : 'Choose the game video'}
                  <input
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files?.length) return;
                      const [a] = await importFiles(files);
                      if (a) setAssetId(a.id);
                    }}
                  />
                </label>
              </div>
              <h3 className="wiz-title">Whose reel?</h3>
              <div className="segmented g2r-who" role="radiogroup" aria-label="Whose reel">
                {(['player', 'team'] as const).map((w) => (
                  <button key={w} role="radio" aria-checked={who === w} className={who === w ? 'on' : ''} onClick={() => (setWho(w), setStyle(STYLES[w][0]))}>
                    {w === 'player' ? 'A player' : 'The team'}
                  </button>
                ))}
              </div>
              <div className="wiz-grid">
                <label className="wiz-field span2">
                  <span>{who === 'player' ? 'Player name' : 'Team name'}</span>
                  <input className="big-input" value={info.name} placeholder={who === 'player' ? 'Jordan Lee' : 'Rockets 17 Elite'} onChange={(e) => set({ name: e.target.value })} />
                </label>
                {who === 'player' && (
                  <>
                    <label className="wiz-field">
                      <span>Jersey #</span>
                      <input value={info.number} inputMode="numeric" placeholder="12" onChange={(e) => set({ number: e.target.value })} />
                    </label>
                    <label className="wiz-field">
                      <span>Team</span>
                      <input value={info.club} placeholder="Rockets 17 Elite" onChange={(e) => set({ club: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
              <h4 className="wiz-sub">Template</h4>
              <div className="poster-kinds" role="radiogroup" aria-label="Template">
                {STYLES[who].map((id) => (
                  <button key={id} role="radio" aria-checked={style === id} className={`chip-btn ${style === id ? 'on' : ''}`} onClick={() => setStyle(id)}>
                    {REEL_STYLES.find((s) => s.id === id)!.title}
                  </button>
                ))}
              </div>
              <p className="wiz-lede">
                {who === 'player'
                  ? `ClipForge finds every rally, keeps the best ${COUNT.player}, then asks you to tap ${name || 'your player'} once. It finds them in the other plays for you to check, then builds the reel with titles, music and spotlights.`
                  : `ClipForge finds every rally, keeps the best ${COUNT.team} and builds the reel with titles and music. Colours, logos and the score come from your last reel; change them later in the editor.`}
              </p>
              {task?.label === 'Analysing the match' && (
                <div className="caption-progress">
                  <span>Finding every rally... {Math.round((task.progress ?? 0) * 100)}%</span>
                  <div className="bar">
                    <i style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}
            </section>
          )}

          {phase === 'spot' && spot && (
            <section className="wiz-step spot-step">
              <h3 className="wiz-title">{i === 0 && !spot.at ? `Tap ${name || 'your player'}` : spot.guess ? `Is this ${name || 'your player'}?` : `Play ${i + 1}`}</h3>
              <p className="wiz-lede">
                {spot.guess ? 'Tap them if the ring is on someone else.' : i === 0 && !spot.at ? 'Tap them once; ClipForge looks for them in the other plays.' : 'Looks right? Carry on.'} Play {i + 1} of {spots.length} ({formatDuration(spot.rally.start)}).
              </p>
              <div className="spot-stage" onPointerDown={(e) => void tap(e)} style={{ aspectRatio: asset?.width && asset.height ? `${asset.width} / ${asset.height}` : '16 / 9' }}>
                {(frames[spot.rally.id] ?? spot.rally.thumb) && <img src={frames[spot.rally.id] ?? spot.rally.thumb} alt="" draggable={false} />}
                {spot.at && (
                  <span
                    className={`spot-ring ${spot.guess ? 'guess' : ''}`}
                    style={{ left: `${spot.at.x * 100}%`, top: `${spot.at.y * 100}%`, borderColor: color, boxShadow: `0 0 0 9999px rgba(0,0,0,.45), 0 0 18px ${color}` }}
                  />
                )}
                {!spot.at && <span className="spot-hint">Tap {name || 'your player'}</span>}
              </div>
              <div className="spot-dots">
                {spots.map((s, k) => (
                  <button key={s.rally.id} className={`${k === i ? 'on' : ''} ${s.at && !s.guess ? 'set' : ''}`} onClick={() => setI(k)} aria-label={`Play ${k + 1}`} />
                ))}
              </div>
            </section>
          )}

          {phase === 'building' && (
            <section className="wiz-step g2r-building">
              <h3 className="wiz-title">Building your reel</h3>
              <p className="wiz-lede">Following {name || 'your player'} through each play, timing the cuts to the music and adding the titles...</p>
              <div className="caption-progress">
                <span>{task?.label ?? 'Getting ready'}</span>
                <div className="bar">
                  <i style={{ width: `${Math.round((task?.progress ?? 0) * 100)}%` }} />
                </div>
              </div>
            </section>
          )}
        </div>
        <footer className="wiz-foot">
          <span className="wiz-summary">{asset ? `${asset.name} · ${formatDuration(asset.duration)}` : 'No video yet'}</span>
          <div className="wiz-actions">
            {phase === 'setup' && (
              <button className="btn primary go" disabled={!asset || busy || !name} onClick={() => void start()}>
                <Icon name="wand" /> {!asset ? 'Choose a video' : !name ? `Add a ${who === 'player' ? 'player' : 'team'} name` : busy ? 'Finding rallies...' : 'Make my reel'}
              </button>
            )}
            {phase === 'spot' && (
              <>
                <button className="btn" onClick={skip}>
                  Not in this play
                </button>
                <button className="btn primary go" disabled={!spot?.at} onClick={() => void confirm()}>
                  <Icon name="check" /> {spot?.guess ? "That's them" : i + 1 < spots.length ? 'Next play' : 'Build my reel'}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
