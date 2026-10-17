import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReelFromWizard, findHighlightsIn, importFiles, stopPreviewSound, togglePreviewSound } from '../actions';
import { highlightKey, useHighlights } from '../ai/highlightState';
import { MUSIC, trackLength } from '../audio/synth';
import { paintCard, TEAM_COLORS } from '../templates/cards';
import { POSITIONS, REEL_STYLES, SKILL_TAGS, type ReelClip, type ReelInfo, type ReelStyle } from '../templates/reel';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';

type Step = 'style' | 'player' | 'clips' | 'spotlight' | 'music';

const STORE_KEY = 'clipforge.reel.info';

const BLANK: ReelInfo = {
  name: '',
  number: '',
  position: 'Outside Hitter',
  gradYear: '',
  height: '',
  club: '',
  school: '',
  email: '',
  phone: '',
  season: String(new Date().getFullYear()),
  record: '',
  colors: TEAM_COLORS[0].colors,
  stats: [
    ['Kills', ''],
    ['Aces', ''],
    ['Blocks', ''],
    ['Digs', ''],
  ],
};

function loadInfo(): ReelInfo {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...BLANK, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return BLANK;
}

/** Wizard clip with an id so it can be reordered and keyed. */
interface WClip extends ReelClip {
  key: string;
  thumb?: string;
  label: string;
}

export function ReelWizard() {
  const preset = useEditor((s) => s.wizard);
  const assets = useEditor((s) => s.assets);
  const [style, setStyle] = useState<ReelStyle>(preset?.style ?? 'recruiting');
  const [info, setInfo] = useState<ReelInfo>(loadInfo);
  const [clips, setClips] = useState<WClip[]>([]);
  const [musicId, setMusicId] = useState<string | null>(REEL_STYLES.find((s) => s.id === (preset?.style ?? 'recruiting'))!.music);
  const [step, setStep] = useState<Step>(preset?.style ? 'player' : 'style');
  const [building, setBuilding] = useState(false);

  const steps: Step[] = style === 'recap' ? ['style', 'player', 'clips', 'music'] : ['style', 'player', 'clips', 'spotlight', 'music'];
  const idx = steps.indexOf(step);
  const close = () => {
    stopPreviewSound();
    useEditor.setState({ wizard: null });
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
  }, [info]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !building && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickStyle = (s: ReelStyle) => {
    setStyle(s);
    setMusicId(REEL_STYLES.find((x) => x.id === s)!.music);
  };

  const canNext =
    step === 'player' ? info.name.trim().length > 0 : step === 'clips' ? clips.length > 0 : true;

  const build = async () => {
    setBuilding(true);
    stopPreviewSound();
    const ok = await buildReelFromWizard({
      style,
      info,
      clips: clips.map(({ assetId, inPoint, duration, tag, spotlight }) => ({ assetId, inPoint, duration, tag, spotlight })),
      musicId,
    });
    setBuilding(false);
    if (ok) close();
  };

  const vars = { '--team1': info.colors[0], '--team2': info.colors[1] } as React.CSSProperties;

  return (
    <div className="modal-backdrop wiz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !building && close()}>
      <div className="wizard" role="dialog" aria-modal="true" aria-labelledby="wiz-title" style={vars}>
        <header className="wiz-head">
          <div className="wiz-brand">
            <Icon name="volleyball" size={22} />
            <h2 id="wiz-title">Highlight Reel</h2>
          </div>
          <ol className="scorebug" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s} className={i === idx ? 'on' : i < idx ? 'done' : ''}>
                <button disabled={i > idx && !canNext} onClick={() => i <= idx + (canNext ? 1 : 0) && setStep(s)}>
                  <b>{i + 1}</b>
                  <span>{s === 'player' && style === 'recap' ? 'team' : s}</span>
                </button>
              </li>
            ))}
          </ol>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={building}>
            <Icon name="close" />
          </button>
        </header>

        <div className="wiz-body">
          {step === 'style' && <StylePicker style={style} onPick={pickStyle} colors={info.colors} />}
          {step === 'player' && <PlayerForm info={info} setInfo={setInfo} style={style} />}
          {step === 'clips' && <ClipPicker clips={clips} setClips={setClips} assets={assets} />}
          {step === 'spotlight' && <SpotlightStep clips={clips} setClips={setClips} color={info.colors[1]} />}
          {step === 'music' && <MusicStep musicId={musicId} setMusicId={setMusicId} style={style} />}
        </div>

        <footer className="wiz-foot">
          <span className="wiz-summary">
            {REEL_STYLES.find((s) => s.id === style)!.title} · {clips.length} clip{clips.length === 1 ? '' : 's'}
            {musicId ? ` · ${MUSIC.find((m) => m.id === musicId)?.title}` : ''}
          </span>
          <div className="wiz-actions">
            {idx > 0 && (
              <button className="btn" onClick={() => setStep(steps[idx - 1])} disabled={building}>
                Back
              </button>
            )}
            {idx < steps.length - 1 ? (
              <button className="btn primary" disabled={!canNext} onClick={() => setStep(steps[idx + 1])}>
                {step === 'player' && !canNext ? `Add a ${style === 'recap' ? 'team' : 'player'} name` : step === 'clips' && !canNext ? 'Pick at least one clip' : 'Next'}
              </button>
            ) : (
              <button className="btn primary go" disabled={building || !clips.length} onClick={() => void build()}>
                <Icon name="wand" /> {building ? 'Building...' : 'Build my reel'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------- step 1: style ----------

function StylePicker({ style, onPick, colors }: { style: ReelStyle; onPick: (s: ReelStyle) => void; colors: [string, string] }) {
  return (
    <section className="wiz-step">
      <h3 className="wiz-title">Pick your play</h3>
      <p className="wiz-lede">Every style builds a full edit you can keep tweaking: titles, music, transitions and all.</p>
      <div className="style-cards">
        {REEL_STYLES.map((s, i) => (
          <button key={s.id} className={`style-card ${style === s.id ? 'on' : ''}`} onClick={() => onPick(s.id)} style={{ animationDelay: `${i * 70}ms` }}>
            <span className={`style-frame ${s.aspect[1] > s.aspect[0] ? 'tall' : 'wide'}`}>
              <CardPreview colors={colors} variant={s.id === 'recap' ? 'outro' : 'intro'} width={s.aspect[0]} height={s.aspect[1]} />
              <em>{s.aspect[1] > s.aspect[0] ? '9:16' : '16:9'}</em>
            </span>
            <strong>{s.title}</strong>
            <small>{s.blurb}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Renders the real card artwork at thumbnail size, optionally with a name lockup. */
function CardPreview({
  colors,
  variant,
  width,
  height,
  name,
  sub,
  kicker,
}: {
  colors: [string, string];
  variant: 'intro' | 'outro';
  width: number;
  height: number;
  name?: string;
  sub?: string;
  kicker?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = 480 / Math.max(width, height);
    c.width = Math.round(width * k);
    c.height = Math.round(height * k);
    const ctx = c.getContext('2d')!;
    paintCard(ctx, c.width, c.height, colors, variant);
    if (name) {
      const S = Math.min(c.width, c.height);
      const portrait = c.height > c.width;
      const x = portrait ? c.width / 2 : c.width * 0.3;
      const y = c.height * (portrait ? 0.38 : 0.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (kicker) {
        ctx.fillStyle = colors[1];
        ctx.font = `900 ${S * 0.07}px "Big Shoulders Display", Impact, sans-serif`;
        ctx.fillText(kicker, x, y - S * 0.15);
      }
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.min(S * 0.17, (c.width * (portrait ? 0.9 : 0.5)) / Math.max(4, name.length) * 1.8)}px "Big Shoulders Display", Impact, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText(name.toUpperCase(), x, y);
      ctx.shadowBlur = 0;
      if (sub) {
        ctx.fillStyle = '#e5e7eb';
        ctx.font = `600 ${S * 0.045}px Inter, system-ui, sans-serif`;
        ctx.fillText(sub.toUpperCase(), x, y + S * 0.14);
      }
    }
  }, [colors, variant, width, height, name, sub, kicker]);
  return <canvas ref={ref} className="card-preview" aria-hidden="true" />;
}

// ---------- step 2: player ----------

function PlayerForm({ info, setInfo, style }: { info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void; style: ReelStyle }) {
  const team = style === 'recap';
  const set = (patch: Partial<ReelInfo>) => setInfo((i) => ({ ...i, ...patch }));
  const field = (key: keyof ReelInfo, label: string, placeholder = '', type = 'text') => (
    <label className="wiz-field">
      <span>{label}</span>
      <input type={type} value={info[key] as string} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<ReelInfo>)} />
    </label>
  );
  const aspect = REEL_STYLES.find((s) => s.id === style)!.aspect;
  return (
    <section className="wiz-step player-step">
      <div className="player-form">
        <h3 className="wiz-title">{team ? 'Your team' : 'Your player'}</h3>
        <div className="wiz-grid">
          <label className="wiz-field span2">
            <span>{team ? 'Team name' : 'Player name'}</span>
            <input
              autoFocus
              value={info.name}
              placeholder={team ? 'Rockets 17 Elite' : 'Jordan Lee'}
              onChange={(e) => set({ name: e.target.value })}
              className="big-input"
            />
          </label>
          {team ? (
            <>
              {field('season', 'Season', '2026')}
              {field('record', 'Record', '24-6')}
              {field('club', 'Club / league', 'Region Open 17s')}
              {field('school', 'Tagline', 'One team. One dream.')}
            </>
          ) : (
            <>
              {field('number', 'Jersey #', '12')}
              <label className="wiz-field">
                <span>Position</span>
                <select value={info.position} onChange={(e) => set({ position: e.target.value })}>
                  {POSITIONS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              {field('gradYear', 'Grad year', '2027')}
              {field('height', 'Height', `6'1"`)}
              {field('club', 'Club team', 'Rockets 17 Elite')}
              {field('school', 'High school', 'Lincoln High')}
              {style === 'recruiting' && field('email', 'Email', 'jordan@email.com', 'email')}
              {style === 'recruiting' && field('phone', 'Phone', '(555) 010-0100', 'tel')}
            </>
          )}
        </div>

        <h4 className="wiz-sub">Team colours</h4>
        <div className="team-colors">
          {TEAM_COLORS.map((t) => (
            <button
              key={t.label}
              className={`pair ${t.colors[0] === info.colors[0] && t.colors[1] === info.colors[1] ? 'on' : ''}`}
              title={t.label}
              aria-label={t.label}
              onClick={() => set({ colors: t.colors })}
            >
              <i style={{ background: t.colors[0] }} />
              <i style={{ background: t.colors[1] }} />
            </button>
          ))}
          <label className="pair custom" title="Primary colour">
            <input type="color" value={info.colors[0]} onChange={(e) => set({ colors: [e.target.value, info.colors[1]] })} />
          </label>
          <label className="pair custom" title="Accent colour">
            <input type="color" value={info.colors[1]} onChange={(e) => set({ colors: [info.colors[0], e.target.value] })} />
          </label>
        </div>

        <h4 className="wiz-sub">{team ? 'Team stats' : 'Season stats'} <small>optional</small></h4>
        <div className="stat-rows">
          {info.stats.map(([k, v], i) => (
            <div key={i} className="stat-row">
              <input
                aria-label="Stat name"
                value={k}
                onChange={(e) => setInfo((s) => ({ ...s, stats: s.stats.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) }))}
              />
              <input
                aria-label={`${k || 'Stat'} value`}
                inputMode="decimal"
                value={v}
                placeholder="0"
                onChange={(e) => setInfo((s) => ({ ...s, stats: s.stats.map((r, j) => (j === i ? [r[0], e.target.value] : r)) }))}
              />
            </div>
          ))}
          {info.stats.length < 6 && (
            <button className="link-btn" onClick={() => setInfo((s) => ({ ...s, stats: [...s.stats, ['', '']] }))}>
              + Add stat
            </button>
          )}
        </div>
      </div>
      <aside className="player-preview">
        <span className="preview-label">Title card</span>
        <CardPreview
          colors={info.colors}
          variant="intro"
          width={aspect[0]}
          height={aspect[1]}
          name={info.name || (team ? 'Team name' : 'Player name')}
          kicker={team ? `SEASON ${info.season}` : info.number ? `#${info.number.replace('#', '')}` : ''}
          sub={team ? info.record : [info.position, info.gradYear && `Class of ${info.gradYear}`].filter(Boolean).join(' · ')}
        />
      </aside>
    </section>
  );
}

// ---------- step 3: clips ----------

function ClipPicker({ clips, setClips, assets }: { clips: WClip[]; setClips: (f: (c: WClip[]) => WClip[]) => void; assets: ReturnType<typeof useEditor.getState>['assets'] }) {
  const byAsset = useHighlights((s) => s.byAsset);
  const task = useEditor((s) => s.task);
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && !/reversed/.test(a.name));
  const found = useMemo(() => Object.values(byAsset).flatMap((list) => list.map((h, i) => ({ h, key: highlightKey(h, i) }))), [byAsset]);
  const has = (key: string) => clips.some((c) => c.key === key);

  const toggle = (c: WClip) => setClips((list) => (list.some((x) => x.key === c.key) ? list.filter((x) => x.key !== c.key) : [...list, c]));
  const move = (i: number, d: number) =>
    setClips((list) => {
      const next = [...list];
      const j = i + d;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <section className="wiz-step clips-step">
      <div className="clip-sources">
        <div className="src-head">
          <h3 className="wiz-title">Your plays</h3>
          <label className="btn">
            <Icon name="upload" /> Import
            <input type="file" multiple accept="video/*" hidden onChange={(e) => e.target.files?.length && void importFiles(e.target.files)} />
          </label>
        </div>
        {!videos.length && <p className="wiz-lede">Import game footage or short clips of your best plays.</p>}
        {found.length > 0 && (
          <>
            <h4 className="wiz-sub">
              <Icon name="sparkle" size={14} /> AI highlights
            </h4>
            <div className="pick-grid">
              {found.map(({ h, key }) => {
                const a = assets[h.assetId];
                if (!a) return null;
                const c: WClip = { key, assetId: h.assetId, inPoint: h.start, duration: h.end - h.start, thumb: h.thumb, label: `${a.name} ${formatDuration(h.start)}` };
                return (
                  <button key={key} className={`pick ${has(key) ? 'on' : ''}`} onClick={() => toggle(c)}>
                    <span className="pick-thumb">
                      {h.thumb && <img src={h.thumb} alt="" />}
                      <span className="score" style={{ '--s': h.score } as React.CSSProperties}>
                        {h.score}
                      </span>
                      <span className="badge">{formatDuration(h.end - h.start)}</span>
                    </span>
                    <span className="pick-meta">{h.reasons[0] ?? 'Action'}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {videos.length > 0 && <h4 className="wiz-sub">Clips</h4>}
        <div className="pick-grid">
          {videos.map((a) => {
            const key = `whole:${a.id}`;
            const long = a.duration > 25;
            const c: WClip = { key, assetId: a.id, inPoint: 0, duration: Math.min(a.duration, 12), thumb: a.thumbnail, label: a.name };
            return (
              <div key={a.id} className={`pick ${has(key) ? 'on' : ''}`}>
                <button className="pick-thumb" onClick={() => toggle(c)} aria-pressed={has(key)} aria-label={`Use ${a.name}`}>
                  {a.thumbnail && <img src={a.thumbnail} alt="" />}
                  <span className="badge">{formatDuration(a.duration)}</span>
                </button>
                <span className="pick-meta" title={a.name}>
                  {a.name}
                </span>
                {long && (
                  <button className="find-btn" disabled={!!task} onClick={() => void findHighlightsIn(a.id)}>
                    <Icon name="sparkle" size={13} /> {byAsset[a.id] ? 'Find again' : 'Find highlights'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {task && <p className="hint">{task.label} {task.progress !== null ? `${Math.round(task.progress * 100)}%` : '...'}</p>}
      </div>

      <div className="lineup">
        <h4 className="wiz-sub">
          Lineup <small>{clips.length ? `${clips.length} · ${formatDuration(clips.reduce((s, c) => s + c.duration, 0))}` : 'tap plays to add'}</small>
        </h4>
        <ol>
          {clips.map((c, i) => (
            <li key={c.key}>
              <span className="lineup-num">{i + 1}</span>
              {c.thumb ? <img src={c.thumb} alt="" /> : <span className="lineup-ph" />}
              <span className="lineup-body">
                <span className="lineup-name">{c.label}</span>
                <select value={c.tag ?? ''} onChange={(e) => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, tag: e.target.value || undefined } : x)))} aria-label="Skill label">
                  <option value="">No label</option>
                  {SKILL_TAGS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </span>
              <span className="lineup-btns">
                <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <Icon name="chevronLeft" size={14} className="rot90" />
                </button>
                <button className="mini" onClick={() => move(i, 1)} disabled={i === clips.length - 1} aria-label="Move down">
                  <Icon name="chevronRight" size={14} className="rot90" />
                </button>
                <button className="mini" onClick={() => toggle(c)} aria-label="Remove">
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------- step 4: spotlight ----------

function SpotlightStep({ clips, setClips, color }: { clips: WClip[]; setClips: (f: (c: WClip[]) => WClip[]) => void; color: string }) {
  const assets = useEditor((s) => s.assets);
  const [i, setI] = useState(0);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const clip = clips[Math.min(i, clips.length - 1)];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { captureFrame } = await import('../engine/frames');
      for (const c of clips) {
        if (frames[c.key]) continue;
        try {
          const blob = await captureFrame(assets[c.assetId], c.inPoint + 0.05);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setFrames((f) => ({ ...f, [c.key]: url }));
        } catch {
          /* fall back to the thumbnail */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.map((c) => c.key).join()]);

  if (!clip) return null;
  const place = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setClips((list) => list.map((c) => (c.key === clip.key ? { ...c, spotlight: { x, y } } : c)));
  };
  const a = assets[clip.assetId];
  return (
    <section className="wiz-step spot-step">
      <h3 className="wiz-title">Spot your player</h3>
      <p className="wiz-lede">Tap your player in each play. The reel freezes on this frame and rings them before the action. Skip any you like.</p>
      <div className="spot-stage" onPointerDown={place} style={{ aspectRatio: a?.width && a.height ? `${a.width} / ${a.height}` : '16 / 9' }}>
        {(frames[clip.key] ?? clip.thumb) && <img src={frames[clip.key] ?? clip.thumb} alt="" draggable={false} />}
        {clip.spotlight && (
          <span className="spot-ring" style={{ left: `${clip.spotlight.x * 100}%`, top: `${clip.spotlight.y * 100}%`, borderColor: color, boxShadow: `0 0 0 9999px rgba(0,0,0,.45), 0 0 18px ${color}` }} />
        )}
        {!clip.spotlight && <span className="spot-hint">Tap your player</span>}
      </div>
      <div className="spot-nav">
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
          <Icon name="chevronLeft" size={16} /> Prev
        </button>
        <span>
          Play {Math.min(i, clips.length - 1) + 1} of {clips.length}
          {clip.spotlight && (
            <button className="link-btn" onClick={() => setClips((list) => list.map((c) => (c.key === clip.key ? { ...c, spotlight: undefined } : c)))}>
              {' '}
              · Clear
            </button>
          )}
        </span>
        <button className="btn" disabled={i >= clips.length - 1} onClick={() => setI(i + 1)}>
          Next <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <div className="spot-dots">
        {clips.map((c, k) => (
          <button key={c.key} className={`${k === i ? 'on' : ''} ${c.spotlight ? 'set' : ''}`} onClick={() => setI(k)} aria-label={`Play ${k + 1}`} />
        ))}
      </div>
    </section>
  );
}

// ---------- step 5: music ----------

function MusicStep({ musicId, setMusicId, style }: { musicId: string | null; setMusicId: (id: string | null) => void; style: ReelStyle }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const recommended = REEL_STYLES.find((s) => s.id === style)!.music;
  useEffect(() => stopPreviewSound, []);
  return (
    <section className="wiz-step">
      <h3 className="wiz-title">Set the tempo</h3>
      <p className="wiz-lede">{style === 'hype' ? 'Cuts lock to the beat of the track you pick.' : 'Royalty-free, safe to post anywhere.'}</p>
      <div className="music-picks">
        {MUSIC.map((m) => (
          <div key={m.id} className={`music-pick ${musicId === m.id ? 'on' : ''}`}>
            <button
              className="music-art"
              style={{ background: `linear-gradient(135deg, ${m.colors[0]}, ${m.colors[1]})` }}
              aria-label={playing === m.id ? `Stop ${m.title}` : `Preview ${m.title}`}
              onClick={async () => setPlaying((await togglePreviewSound('music', m.id)) ? m.id : null)}
            >
              <Icon name={playing === m.id ? 'pause' : 'play'} size={18} />
            </button>
            <button className="music-choose" onClick={() => setMusicId(m.id)}>
              <strong>
                {m.title} {m.id === recommended && <em>Recommended</em>}
              </strong>
              <small>
                {m.mood} · {m.bpm} BPM · {formatDuration(trackLength(m).seconds)}
              </small>
            </button>
          </div>
        ))}
        <button className={`music-none ${musicId === null ? 'on' : ''}`} onClick={() => setMusicId(null)}>
          No music
        </button>
      </div>
    </section>
  );
}
