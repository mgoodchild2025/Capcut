import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReelFromWizard, findHighlightsIn, importFiles, stopPreviewSound, togglePreviewSound } from '../actions';
import { highlightKey, useHighlights } from '../ai/highlightState';
import { LIBRARY_MUSIC } from '../audio/library';
import { MUSIC, trackLength } from '../audio/synth';
import { drawGraphic } from '../engine/graphics';
import type { Clip, GraphicLook, GraphicSpec } from '../model/types';
import { openText } from '../templates/broadcast';
import { REEL_STYLES, TEAM_COLORS, type ReelClip, type ReelInfo, type ReelStyle, type RosterPlayer } from '../templates/reel';
import { SPORTS, sportOf, type Sport } from '../templates/sports';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration, uid } from '../utils';

type Step = 'style' | 'player' | 'roster' | 'clips' | 'spotlight' | 'music';

export const HEADLINES = ['Player of the Game', 'Athlete of the Week', 'Senior Night', 'MVP', 'Player Spotlight', 'Happy Birthday'];

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
  headline: HEADLINES[0],
  opponent: '',
  roster: [],
  sets: [],
  sport: 'volleyball',
  look: 'broadcast',
};

/** Shrinks an uploaded logo to at most 512px and keeps its transparency. */
async function logoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 512 / Math.max(img.naturalWidth || 512, img.naturalHeight || 512));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || 512) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || 512) * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const styleOf = (id: ReelStyle) => REEL_STYLES.find((s) => s.id === id)!;

/** The wizard steps a style needs. */
function stepsFor(id: ReelStyle): Step[] {
  const s = styleOf(id);
  if (s.roster === 'intros') return ['style', 'player', 'roster', 'music'];
  if (s.roster === 'credits') return ['style', 'player', 'roster', 'clips', 'music'];
  return s.spotlight ? ['style', 'player', 'clips', 'spotlight', 'music'] : ['style', 'player', 'clips', 'music'];
}

const blankPlayer = (sport?: string): RosterPlayer => ({ key: uid('r_'), number: '', name: '', position: sportOf(sport).positions[0], starter: true });

/** The sport's positions, keeping one that was typed or chosen for another sport. */
const positionsWith = (sport: Sport, current: string) => (current && !sport.positions.includes(current) ? [current, ...sport.positions] : sport.positions);

/** Switches sport: untouched stat rows take the new sport's usual stats, and the position follows. */
function withSport(i: ReelInfo, id: Sport['id']): ReelInfo {
  const sport = sportOf(id);
  const blankStats = i.stats.every(([, v]) => !v.trim());
  return {
    ...i,
    sport: id,
    stats: blankStats ? sport.stats.map((k) => [k, ''] as [string, string]) : i.stats,
    position: sport.positions.includes(i.position) ? i.position : sport.positions[0],
  };
}

/** Most sports allow overtime periods or extra innings; volleyball is best of five. */
const maxPeriods = (sport: Sport) => (sport.scoring.result === 'sets' ? 5 : sport.scoring.count + 2);

function loadInfo(): ReelInfo {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = { ...BLANK, ...JSON.parse(raw) } as ReelInfo;
      // Photos and clips belong to the project they were imported into.
      return { ...saved, photo: undefined, roster: (saved.roster ?? []).map((r) => ({ ...r, assetId: undefined })) };
    }
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
  const [follow, setFollow] = useState(true);
  const [followPlayer, setFollowPlayer] = useState(true);
  const [playerReels, setPlayerReels] = useState<ReelStyle | null>('hype');

  const meta = styleOf(style);
  const team = meta.subject === 'team';
  const steps = stepsFor(style);
  const starters = info.roster.filter((r) => r.starter && (r.name.trim() || r.number.trim())).length;
  const named = info.roster.filter((r) => r.name.trim() || r.number.trim()).length;
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
    step === 'player'
      ? info.name.trim().length > 0
      : step === 'roster'
        ? (meta.roster === 'intros' ? starters : named) > 0
        : step === 'clips'
          ? clips.length > 0
          : true;
  const ready = meta.roster === 'intros' ? starters > 0 : clips.length > 0;

  const build = async () => {
    setBuilding(true);
    stopPreviewSound();
    const ok = await buildReelFromWizard({
      style,
      info,
      clips: meta.roster === 'intros' ? [] : clips.map(({ assetId, inPoint, duration, tag, spotlight, player, score, set, replay }) => ({ assetId, inPoint, duration, tag, spotlight, player, score, set, replay })),
      musicId,
      follow,
      followPlayer,
      playerReels: meta.roster === 'credits' && playerReels ? playerReels : undefined,
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
                  <span>{s === 'player' && team ? 'team' : s}</span>
                </button>
              </li>
            ))}
          </ol>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={building}>
            <Icon name="close" />
          </button>
        </header>

        <div className="wiz-body">
          {step === 'style' && <StylePicker style={style} onPick={pickStyle} info={info} setInfo={setInfo} />}
          {step === 'player' && <PlayerForm info={info} setInfo={setInfo} style={style} />}
          {step === 'roster' && <RosterStep info={info} setInfo={setInfo} lineup={meta.roster === 'intros'} />}
          {step === 'clips' && (
            <ClipPicker
              clips={clips}
              setClips={setClips}
              assets={assets}
              roster={meta.roster === 'credits' ? info.roster : null}
              scoring={!!info.opponent.trim() || info.sets.length > 0}
              sport={sportOf(info.sport)}
              follow={meta.aspect[0] < meta.aspect[1] || meta.aspect[0] * 5 === meta.aspect[1] * 4 ? { on: follow, set: setFollow } : null}
            />
          )}
          {step === 'spotlight' && <SpotlightStep clips={clips} setClips={setClips} color={info.colors[1]} follow={{ on: followPlayer, set: setFollowPlayer }} />}
          {step === 'music' && <MusicStep musicId={musicId} setMusicId={setMusicId} style={style} />}
          {step === 'music' && meta.roster === 'credits' && <PlayerReelsOption clips={clips} roster={info.roster} value={playerReels} onChange={setPlayerReels} />}
        </div>

        <footer className="wiz-foot">
          <span className="wiz-summary">
            {meta.title} · {meta.roster === 'intros' ? `${starters} starter${starters === 1 ? '' : 's'}` : `${clips.length} clip${clips.length === 1 ? '' : 's'}`}
            {musicId ? ` · ${musicId.startsWith('asset:') ? (assets[musicId.slice(6)]?.name.replace(/\.[^.]+$/, '') ?? 'Your song') : (LIBRARY_MUSIC.find((m) => m.id === musicId) ?? MUSIC.find((m) => m.id === musicId))?.title}` : ''}
          </span>
          <div className="wiz-actions">
            {idx > 0 && (
              <button className="btn" onClick={() => setStep(steps[idx - 1])} disabled={building}>
                Back
              </button>
            )}
            {idx < steps.length - 1 ? (
              <button className="btn primary" disabled={!canNext} onClick={() => setStep(steps[idx + 1])}>
                {step === 'player' && !canNext
                  ? `Add a ${team ? 'team' : 'player'} name`
                  : step === 'roster' && !canNext
                    ? meta.roster === 'intros'
                      ? 'Add a starter'
                      : 'Add a player'
                    : step === 'clips' && !canNext
                      ? 'Pick at least one clip'
                      : 'Next'}
              </button>
            ) : (
              <button className="btn primary go" disabled={building || !ready} onClick={() => void build()}>
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

const aspectLabel = ([w, h]: [number, number]) => (w === h ? '1:1' : w * 5 === h * 4 ? '4:5' : h > w ? '9:16' : '16:9');

/** The signature graphic of each style, with sample words, for the style picker. */
function sampleSpec(id: ReelStyle, colors: [string, string], look?: GraphicLook): { spec: GraphicSpec; at: number; duration: number } {
  const base = { colors, logo: 'logo', oppLogo: 'opp', look };
  switch (id) {
    case 'spotlight':
      return { spec: { ...base, type: 'playerCard', text: { number: '12', first: 'Jordan', last: 'Lee', position: 'Outside hitter' } }, at: 2.2, duration: 4 };
    case 'team':
      return {
        spec: { ...base, type: 'roster', text: { title: 'The squad', sub: 'Rockets 17 Elite' }, players: ['12', '4', '9', '7', '15', '3'].map((n, i) => ({ number: n, name: ['Lee', 'Rivera', 'Chen', 'Ortiz', 'Brooks', 'Park'][i] })) },
        at: 3,
        duration: 4.5,
      };
    case 'lineup':
      return { spec: { ...base, type: 'open', text: { kicker: "TONIGHT'S", title: 'STARTING LINEUP', sub: 'Rockets vs Storm' } }, at: 2.2, duration: 4 };
    case 'recap':
      return { spec: { ...base, type: 'final', text: { usName: 'Rockets', themName: 'Storm', result: 'Rockets win 3-1' }, sets: [[25, 21], [23, 25], [25, 19], [25, 22]] }, at: 3, duration: 4.5 };
    default:
      return { spec: { ...base, type: 'open', text: { kicker: id === 'hype' ? '#12' : '#12 · OUTSIDE HITTER', title: 'JORDAN LEE', sub: 'Class of 2027' } }, at: 2.2, duration: 4 };
  }
}

function StylePicker({ style, onPick, info, setInfo }: { style: ReelStyle; onPick: (s: ReelStyle) => void; info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void }) {
  const [hover, setHover] = useState<ReelStyle | null>(null);
  const pickSport = (id: Sport['id']) => setInfo((i) => withSport(i, id));
  return (
    <section className="wiz-step">
      <h3 className="wiz-title">Your sport</h3>
      <div className="sport-chips" role="radiogroup" aria-label="Sport">
        {SPORTS.map((sp) => (
          <button key={sp.id} role="radio" aria-checked={sportOf(info.sport).id === sp.id} className={`chip-btn ${sportOf(info.sport).id === sp.id ? 'on' : ''}`} onClick={() => pickSport(sp.id)}>
            {sp.name}
          </button>
        ))}
      </div>
      <h3 className="wiz-title">Your look</h3>
      <LookPicker info={info} setInfo={setInfo} />
      <h3 className="wiz-title">Pick your play</h3>
      <p className="wiz-lede">Broadcast-style graphics in your team colours: animated titles, player cards, score bugs and stingers. Everything stays editable.</p>
      <div className="style-cards">
        {REEL_STYLES.map((s, i) => {
          const sample = sampleSpec(s.id, info.colors, info.look);
          return (
            <button
              key={s.id}
              className={`style-card ${style === s.id ? 'on' : ''}`}
              onClick={() => onPick(s.id)}
              onPointerEnter={() => setHover(s.id)}
              onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span className={`style-frame ${s.aspect[1] > s.aspect[0] ? 'tall' : 'wide'}`}>
                <GraphicPreview spec={sample.spec} width={s.aspect[0]} height={s.aspect[1]} at={sample.at} duration={sample.duration} animate={hover === s.id} logo={info.logo} oppLogo={info.oppLogo} />
                <em>{aspectLabel(s.aspect)}</em>
              </span>
              <strong>{s.title}</strong>
              <small>{s.blurb}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const LOOKS: { id: GraphicLook; name: string; hint: string }[] = [
  { id: 'broadcast', name: 'Broadcast', hint: 'Bold TV sports package' },
  { id: 'championship', name: 'Championship', hint: 'Gold, spotlights, sparks' },
  { id: 'neon', name: 'Neon', hint: 'Glow and a racing grid' },
  { id: 'classic', name: 'Classic', hint: 'Clean and understated' },
];

/** The graphics look, each previewed as a moving title in the team's colours. */
function LookPicker({ info, setInfo }: { info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void }) {
  const current = info.look ?? 'broadcast';
  const [hover, setHover] = useState<GraphicLook | null>(null);
  return (
    <div className="look-cards" role="radiogroup" aria-label="Graphics look">
      {LOOKS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={current === l.id}
          className={`look-card ${current === l.id ? 'on' : ''}`}
          onClick={() => setInfo((i) => ({ ...i, look: l.id }))}
          onPointerEnter={() => setHover(l.id)}
          onPointerLeave={() => setHover((h) => (h === l.id ? null : h))}
        >
          <GraphicPreview
            spec={{ type: 'open', colors: info.colors, look: l.id, logo: info.logo ? 'logo' : undefined, text: { kicker: '#12', title: 'JORDAN LEE', sub: '' } }}
            width={1920}
            height={1080}
            at={2.4}
            duration={4}
            animate={hover === l.id || current === l.id}
            logo={info.logo}
          />
          <strong>{l.name}</strong>
          <small>{l.hint}</small>
        </button>
      ))}
    </div>
  );
}

/** Loads an image from a data URL, for previews. */
function useImage(url?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return setImg(null);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

/**
 * Draws a broadcast graphic exactly as the reel will, at thumbnail size. With `animate` it plays
 * on a loop; otherwise it shows the moment `at`.
 */
function GraphicPreview({ spec, width, height, at, duration, animate, logo, oppLogo }: { spec: GraphicSpec; width: number; height: number; at: number; duration: number; animate?: boolean; logo?: string; oppLogo?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const logoImg = useImage(logo);
  const oppImg = useImage(oppLogo);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = 480 / Math.max(width, height);
    c.width = Math.round(width * k);
    c.height = Math.round(height * k);
    const ctx = c.getContext('2d')!;
    const clip = { graphic: spec, duration } as Clip;
    const lookup = (id: string) => (id === 'logo' ? logoImg : id === 'opp' ? oppImg : null);
    const draw = (t: number) => {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawGraphic(ctx, clip, t, width, height, lookup, null);
    };
    if (!animate) {
      draw(at);
      // Web fonts may land after the first draw.
      void document.fonts?.ready.then(() => draw(at));
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      // Play through, hold the finished frame for a moment, then go again.
      const t = ((performance.now() - t0) / 1000) % (duration + 0.8);
      draw(Math.min(t, duration - 0.5));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [spec, width, height, at, duration, animate, logoImg, oppImg]);
  return <canvas ref={ref} className="card-preview" aria-hidden="true" />;
}

/** Picks a photo or short clip from the project (or uploads one), with an optional background cut-out. */
function MediaPick({
  assetId,
  cutout,
  onPick,
  onCutout,
  label,
  fallback,
}: {
  assetId?: string;
  cutout?: boolean;
  onPick: (id: string | undefined) => void;
  onCutout?: (v: boolean) => void;
  label: string;
  fallback: React.ReactNode;
}) {
  const assets = useEditor((s) => s.assets);
  const [open, setOpen] = useState(false);
  const a = assetId ? assets[assetId] : undefined;
  const media = Object.values(assets).filter((m) => !m.internal && ((m.kind === 'image' && !/(logo| card|cutout)\.png$/i.test(m.name)) || (m.kind === 'video' && !/reversed/.test(m.name))));
  return (
    <div className="media-pick">
      <button type="button" className={`roster-media ${a ? 'has' : ''}`} onClick={() => setOpen((v) => !v)} aria-label={a ? `Change ${label}` : `Add ${label}`} aria-expanded={open}>
        {a?.thumbnail ? <img src={a.thumbnail} alt="" /> : fallback}
        {a?.kind === 'video' && <i className="media-kind">clip</i>}
      </button>
      {a?.kind === 'image' && onCutout && (
        <button type="button" className={`chip-btn ${cutout ? 'on' : ''}`} aria-pressed={!!cutout} onClick={() => onCutout(!cutout)} title="Cut the player out of the photo's background">
          Cut out
        </button>
      )}
      {open && (
        <div className="roster-pick">
          <label className="pick-tile upload">
            <Icon name="upload" size={18} />
            <span>Upload</span>
            <input
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={async (e) => {
                const files = e.target.files;
                if (!files?.length) return;
                const [added] = await importFiles(files);
                if (added) onPick(added.id);
                setOpen(false);
              }}
            />
          </label>
          <button type="button" className={`pick-tile ${!assetId ? 'on' : ''}`} onClick={() => (onPick(undefined), setOpen(false))}>
            {fallback}
            <span>None</span>
          </button>
          {media.map((m) => (
            <button type="button" key={m.id} className={`pick-tile ${assetId === m.id ? 'on' : ''}`} onClick={() => (onPick(m.id), setOpen(false))} title={m.name}>
              {m.thumbnail && <img src={m.thumbnail} alt="" />}
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Living photos: still photos get a 3D camera move through their depth. */
function LivePhotosToggle({ info, setInfo }: { info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void }) {
  return (
    <label className="check follow-toggle">
      <input type="checkbox" checked={info.livePhotos !== false} onChange={(e) => setInfo((i) => ({ ...i, livePhotos: e.target.checked }))} />
      <span>
        <strong>Living photos</strong>
        <small>Still photos get a 3D camera move: the player separates from the background, like a broadcast intro. Uses an on-device depth model (downloaded once).</small>
      </span>
    </label>
  );
}

/** Upload box for a logo (kept as a small PNG data URL). */
function LogoDrop({ value, onChange, label }: { value?: string; onChange: (v: string | undefined) => void; label: string }) {
  return (
    <label className="logo-drop" title={value ? `Change ${label}` : `Upload ${label}`}>
      {value ? <img src={value} alt={label} /> : <Icon name="upload" />}
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onChange(await logoDataUrl(f).catch(() => undefined));
        }}
      />
    </label>
  );
}

// ---------- step 2: player ----------

function PlayerForm({ info, setInfo, style }: { info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void; style: ReelStyle }) {
  const team = styleOf(style).subject === 'team';
  const sport = sportOf(info.sport);
  const period = sport.scoring.period;
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
          <label className="wiz-field span2 sport-field">
            <span>Sport</span>
            <select value={sport.id} onChange={(e) => setInfo((i) => withSport(i, e.target.value as Sport['id']))}>
              {SPORTS.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wiz-field span2 sport-field">
            <span>Graphics look</span>
            <select value={info.look ?? 'broadcast'} onChange={(e) => set({ look: e.target.value as GraphicLook })}>
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}: {l.hint}
                </option>
              ))}
            </select>
          </label>
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
              {style === 'lineup' && field('opponent', 'Opponent', 'Westside Storm')}
              {field('season', 'Season', '2026')}
              {style !== 'lineup' && field('record', 'Record', '24-6')}
              {field('club', 'Club / league', 'Region Open 17s')}
              {style !== 'lineup' && field('school', 'Tagline', 'One team. One dream.')}
            </>
          ) : (
            <>
              {style === 'spotlight' && (
                <label className="wiz-field span2">
                  <span>Headline</span>
                  <input list="headline-presets" value={info.headline} placeholder="Player of the Game" onChange={(e) => set({ headline: e.target.value })} />
                  <datalist id="headline-presets">
                    {HEADLINES.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </label>
              )}
              {field('number', 'Jersey #', '12')}
              <label className="wiz-field">
                <span>Position</span>
                <select value={info.position} onChange={(e) => set({ position: e.target.value })}>
                  {positionsWith(sport, info.position).map((p) => (
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

        <h4 className="wiz-sub">
          Logos <small>optional, remembered</small>
        </h4>
        <div className="logo-row">
          <LogoDrop value={info.logo} onChange={(v) => set({ logo: v })} label="team logo" />
          <LogoDrop value={info.oppLogo} onChange={(v) => set({ oppLogo: v })} label="opponent logo" />
          <small className="muted">
            Your logo goes on the title, player cards, lower thirds and score bug; the opponent's on the score bug, final score{style === 'lineup' ? ' and the versus title' : ''}. PNGs with a transparent background look best.
            {(info.logo || info.oppLogo) && (
              <>
                {' '}
                {info.logo && (
                  <button className="link-btn" onClick={() => set({ logo: undefined })}>
                    Remove team logo
                  </button>
                )}
                {info.oppLogo && (
                  <button className="link-btn" onClick={() => set({ oppLogo: undefined })}>
                    {' '}
                    Remove opponent logo
                  </button>
                )}
              </>
            )}
          </small>
        </div>

        {!team && (
          <>
            <h4 className="wiz-sub">
              Player photo or clip <small>optional</small>
            </h4>
            <div className="logo-row">
              <MediaPick
                assetId={info.photo}
                cutout={info.photoCutout}
                onPick={(id) => set({ photo: id })}
                onCutout={(v) => set({ photoCutout: v })}
                label="player photo"
                fallback={<b>{info.number ? `#${info.number.replace('#', '')}` : <Icon name="image" size={18} />}</b>}
              />
              <small className="muted">For the player card. A posed photo, or a 2-3 second clip of them (a celebration, a spike). Turn on Cut out to remove the photo's background.</small>
            </div>
            <LivePhotosToggle info={info} setInfo={setInfo} />
          </>
        )}

        {style !== 'lineup' && (
          <>
            <h4 className="wiz-sub">
              Match score <small>optional</small>
            </h4>
            <div className="match-row">
              <label className="wiz-field">
                <span>Opponent</span>
                <input value={info.opponent} placeholder="Westside Storm" onChange={(e) => set({ opponent: e.target.value })} />
              </label>
              <div className="set-scores">
                {info.sets.map(([a, b], i) => (
                  <span key={i} className="set-score">
                    <small>
                      {period} {i + 1}
                    </small>
                    <input aria-label={`${period} ${i + 1} our score`} inputMode="numeric" value={a} placeholder="25" onChange={(e) => setInfo((x) => ({ ...x, sets: x.sets.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) }))} />
                    <b>–</b>
                    <input aria-label={`${period} ${i + 1} their score`} inputMode="numeric" value={b} placeholder="21" onChange={(e) => setInfo((x) => ({ ...x, sets: x.sets.map((r, j) => (j === i ? [r[0], e.target.value] : r)) }))} />
                    <button className="mini" aria-label={`Remove ${period.toLowerCase()} ${i + 1}`} onClick={() => setInfo((x) => ({ ...x, sets: x.sets.filter((_, j) => j !== i) }))}>
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
                {info.sets.length < maxPeriods(sport) && (
                  <button className="link-btn" onClick={() => setInfo((x) => ({ ...x, sets: [...x.sets, ['', '']] }))}>
                    + Add {period.toLowerCase()}
                  </button>
                )}
              </div>
            </div>
            <small className="muted match-hint">
              {period} scores add a final scoreboard{sport.scoring.result === 'points' ? ` (total ${sport.scoring.unit})` : ' (sets won)'}. Add each play's score on the next step for a live score bug ({team ? info.name || 'your team' : info.club || 'your club'} vs {info.opponent || 'opponent'}).
            </small>
          </>
        )}

        {style !== 'lineup' && (
          <>
        <h4 className="wiz-sub">{team ? 'Team stats' : style === 'spotlight' ? 'Stats' : 'Season stats'} <small>optional</small></h4>
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
          </>
        )}
      </div>
      <aside className="player-preview">
        <span className="preview-label">Title</span>
        <GraphicPreview
          spec={{ type: 'open', colors: info.colors, look: info.look, text: openText(style, info), logo: info.logo ? 'logo' : undefined, oppLogo: style === 'lineup' && info.oppLogo ? 'opp' : undefined }}
          width={aspect[0]}
          height={aspect[1]}
          at={2.4}
          duration={4}
          animate
          logo={info.logo}
          oppLogo={info.oppLogo}
        />
      </aside>
    </section>
  );
}

// ---------- roster ----------

/** Turns "12 Jordan Lee, Setter" style lines into players. */
function parseRoster(textIn: string, sport: Sport): RosterPlayer[] {
  return textIn
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^#?(\d{1,3})\s*[-.:)]?\s*(.*)$/);
      const [num, rest] = m ? [m[1], m[2]] : ['', line];
      const [name, pos] = rest.split(/\s*[,|\t]\s*/);
      const position = sport.positions.find((p) => pos && p.toLowerCase().startsWith(pos.toLowerCase())) ?? sport.positions[0];
      return { ...blankPlayer(sport.id), number: num, name: name ?? '', position };
    });
}

function RosterStep({
  info,
  setInfo,
  lineup,
}: {
  info: ReelInfo;
  setInfo: (f: (i: ReelInfo) => ReelInfo) => void;
  lineup: boolean;
}) {
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const roster = info.roster;
  useEffect(() => {
    if (!info.roster.length) setInfo((i) => ({ ...i, roster: [blankPlayer(i.sport), blankPlayer(i.sport)] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: string, patch: Partial<RosterPlayer>) => setInfo((i) => ({ ...i, roster: i.roster.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const remove = (key: string) => setInfo((i) => ({ ...i, roster: i.roster.filter((r) => r.key !== key) }));
  const move = (idx: number, d: number) =>
    setInfo((i) => {
      const next = [...i.roster];
      const j = idx + d;
      if (j < 0 || j >= next.length) return i;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...i, roster: next };
    });
  const addPasted = () => {
    const players = parseRoster(pasteText, sportOf(info.sport));
    // Pasting the same list again (or an updated one) doesn't duplicate anyone already listed.
    const id = (r: RosterPlayer) => `${r.number.replace('#', '')}|${r.name.trim().toLowerCase()}`;
    if (players.length)
      setInfo((i) => {
        const kept = i.roster.filter((r) => r.name.trim() || r.number.trim());
        const have = new Set(kept.map(id));
        return { ...i, roster: [...kept, ...players.filter((r) => !have.has(id(r)))] };
      });
    setPasteText('');
    setPasting(false);
  };
  const starters = roster.filter((r) => r.starter).length;

  return (
    <section className="wiz-step roster-step">
      <div className="src-head">
        <h3 className="wiz-title">{lineup ? 'Starting lineup' : 'Roster'}</h3>
        <button className="btn" onClick={() => setPasting((v) => !v)}>
          <Icon name="paste" /> Paste list
        </button>
      </div>
      <p className="wiz-lede">
        {lineup
          ? 'Starters are introduced in this order. Add a photo or a short clip for each one (or leave it for a jersey-number card); Cut out removes a photo\'s background.'
          : 'Add your players (photos are optional, for the roster wall), then credit each play to whoever made it.'}
      </p>
      <LivePhotosToggle info={info} setInfo={setInfo} />
      {pasting && (
        <div className="roster-paste">
          <textarea
            autoFocus
            rows={5}
            value={pasteText}
            placeholder={'One player per line, e.g.\n12 Jordan Lee, Outside\n4 Sam Rivera, Setter'}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button className="btn primary" disabled={!pasteText.trim()} onClick={addPasted}>
            Add players
          </button>
        </div>
      )}
      <ol className="roster-rows">
        {roster.map((r, i) => {
          return (
            <li key={r.key} className={`roster-row ${lineup && !r.starter ? 'bench' : ''}`}>
              <MediaPick
                assetId={r.assetId}
                cutout={r.cutout}
                onPick={(id) => update(r.key, { assetId: id })}
                onCutout={(v) => update(r.key, { cutout: v })}
                label={`photo for ${r.name || 'player'}`}
                fallback={<b>{r.number ? `#${r.number.replace('#', '')}` : <Icon name="image" size={18} />}</b>}
              />
              <input className="roster-num" aria-label="Jersey number" inputMode="numeric" placeholder="#" value={r.number} onChange={(e) => update(r.key, { number: e.target.value.slice(0, 3) })} />
              <input className="roster-name" aria-label="Player name" placeholder="Player name" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
              <select className="roster-pos" aria-label="Position" value={r.position} onChange={(e) => update(r.key, { position: e.target.value })}>
                {positionsWith(sportOf(info.sport), r.position).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <span className="roster-btns">
                {lineup && (
                  <button className={`chip-btn ${r.starter ? 'on' : ''}`} aria-pressed={r.starter} onClick={() => update(r.key, { starter: !r.starter })}>
                    {r.starter ? 'Starter' : 'Bench'}
                  </button>
                )}
                <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <Icon name="chevronLeft" size={14} className="rot90" />
                </button>
                <button className="mini" onClick={() => move(i, 1)} disabled={i === roster.length - 1} aria-label="Move down">
                  <Icon name="chevronRight" size={14} className="rot90" />
                </button>
                <button className="mini" onClick={() => remove(r.key)} aria-label="Remove player">
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="roster-foot">
        <button className="link-btn" onClick={() => setInfo((i) => ({ ...i, roster: [...i.roster, blankPlayer(i.sport)] }))}>
          + Add player
        </button>
        {lineup && <small className="muted">{starters} starter{starters === 1 ? '' : 's'}</small>}
      </div>
    </section>
  );
}

// ---------- step 3: clips ----------

function ClipPicker({
  clips,
  setClips,
  assets,
  roster,
  scoring,
  sport,
  follow,
}: {
  clips: WClip[];
  setClips: (f: (c: WClip[]) => WClip[]) => void;
  assets: ReturnType<typeof useEditor.getState>['assets'];
  /** Credit plays to these players (team reels). */
  roster: RosterPlayer[] | null;
  /** Ask for each play's score. */
  scoring: boolean;
  sport: Sport;
  /** Auto-follow switch, for styles narrower than game footage. */
  follow: { on: boolean; set: (v: boolean) => void } | null;
}) {
  const named = roster?.filter((r) => r.name.trim() || r.number.trim()) ?? [];
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
        {follow && (
          <label className="check follow-toggle">
            <input type="checkbox" checked={follow.on} onChange={(e) => follow.set(e.target.checked)} />
            <span>
              <strong>Auto-follow the action</strong>
              <small>Pans wide game footage to keep the play in the frame. Plays where you spot your player stay centred on them.</small>
            </span>
          </label>
        )}
        <ol>
          {clips.map((c, i) => (
            <li key={c.key}>
              <span className="lineup-num">{i + 1}</span>
              {c.thumb ? <img src={c.thumb} alt="" /> : <span className="lineup-ph" />}
              <span className="lineup-body">
                <span className="lineup-name">{c.label}</span>
                <span className="lineup-selects">
                  {roster && (
                    <select value={c.player ?? ''} onChange={(e) => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, player: e.target.value || undefined } : x)))} aria-label="Player">
                      <option value="">Whole team</option>
                      {named.map((r) => (
                        <option key={r.key} value={r.key}>
                          {[r.number && `#${r.number.replace('#', '')}`, r.name].filter(Boolean).join(' ')}
                        </option>
                      ))}
                    </select>
                  )}
                  <select value={c.tag ?? ''} onChange={(e) => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, tag: e.target.value || undefined } : x)))} aria-label="Skill label">
                    <option value="">No label</option>
                    {sport.plays.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    className={`chip-btn replay-chip ${c.replay ? 'on' : ''}`}
                    aria-pressed={!!c.replay}
                    title="Show this play again in slow motion, with the analyst's pen on the player"
                    onClick={() => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, replay: !x.replay || undefined } : x)))}
                  >
                    <Icon name="replay" size={13} /> Replay
                  </button>
                </span>
                {scoring && (
                  <span className="lineup-selects score-inputs">
                    <select value={c.set ?? ''} onChange={(e) => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, set: e.target.value ? Number(e.target.value) : undefined } : x)))} aria-label={sport.scoring.period}>
                      <option value="">{sport.scoring.period}</option>
                      {Array.from({ length: maxPeriods(sport) }, (_, k) => k + 1).map((n) => (
                        <option key={n} value={n}>
                          {sport.scoring.period} {n}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Score after this play"
                      placeholder="Score, e.g. 18-21"
                      inputMode="numeric"
                      value={c.score ?? ''}
                      onChange={(e) => setClips((list) => list.map((x) => (x.key === c.key ? { ...x, score: e.target.value || undefined } : x)))}
                    />
                  </span>
                )}
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

function SpotlightStep({
  clips,
  setClips,
  color,
  follow,
}: {
  clips: WClip[];
  setClips: (f: (c: WClip[]) => WClip[]) => void;
  color: string;
  follow: { on: boolean; set: (v: boolean) => void };
}) {
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
      <p className="wiz-lede">Tap your player in each play. The reel freezes on this frame and rings them before the action, then follows them. Skip any you like.</p>
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
      <label className="check follow-toggle">
        <input type="checkbox" checked={follow.on} onChange={(e) => follow.set(e.target.checked)} />
        <span>
          <strong>Follow them through the play</strong>
          <small>After the freeze, a marker with their number stays over your player, and vertical reels pan to keep them in the frame.</small>
        </span>
      </label>
    </section>
  );
}

/** Team reels: also make a reel for every player credited with a play. */
function PlayerReelsOption({ clips, roster, value, onChange }: { clips: WClip[]; roster: RosterPlayer[]; value: ReelStyle | null; onChange: (v: ReelStyle | null) => void }) {
  const credited = roster.filter((r) => (r.name.trim() || r.number.trim()) && clips.some((c) => c.player === r.key));
  const names = credited.map((r) => r.name.trim().split(/\s+/)[0] || `#${r.number}`);
  return (
    <section className="player-reels">
      <label className="check">
        <input type="checkbox" checked={!!value && credited.length > 0} disabled={!credited.length} onChange={(e) => onChange(e.target.checked ? 'hype' : null)} />
        <span>
          <strong>Also make a reel for each player</strong>
          <small>
            {credited.length
              ? `${credited.length} player${credited.length === 1 ? '' : 's'} with plays (${names.slice(0, 4).join(', ')}${names.length > 4 ? '...' : ''}). Each gets their own reel with their plays, photo and stats from the play labels, saved to your drafts. The game video isn't copied.`
              : 'Credit plays to players on the clips step to make a reel for each of them.'}
          </small>
        </span>
      </label>
      {value && credited.length > 0 && (
        <div className="player-reels-style" role="radiogroup" aria-label="Player reel format">
          {(['hype', 'spotlight', 'recruiting'] as const).map((id) => {
            const st = styleOf(id);
            return (
              <button key={id} role="radio" aria-checked={value === id} className={`chip-btn ${value === id ? 'on' : ''}`} onClick={() => onChange(id)}>
                {st.title} <small>{aspectLabel(st.aspect)}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- step 5: music ----------

function MusicStep({ musicId, setMusicId, style }: { musicId: string | null; setMusicId: (id: string | null) => void; style: ReelStyle }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const recommended = REEL_STYLES.find((s) => s.id === style)!.music;
  useEffect(() => stopPreviewSound, []);
  const pick = (id: string, title: string, sub: string, colors: [string, string]) => (
    <div key={id} className={`music-pick ${musicId === id ? 'on' : ''}`}>
      <button
        className="music-art"
        style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}
        aria-label={playing === id ? `Stop ${title}` : `Preview ${title}`}
        onClick={async () => setPlaying((await togglePreviewSound('music', id)) ? id : null)}
      >
        <Icon name={playing === id ? 'pause' : 'play'} size={18} />
      </button>
      <button className="music-choose" onClick={() => setMusicId(id)}>
        <strong>
          {title} {id === recommended && <em>Recommended</em>}
        </strong>
        <small>{sub}</small>
      </button>
    </div>
  );
  const generated = MUSIC.some((m) => m.id === musicId);
  return (
    <section className="wiz-step">
      <h3 className="wiz-title">Set the tempo</h3>
      <p className="wiz-lede">{style === 'hype' || style === 'team' || style === 'lineup' ? 'Cuts lock to the beat of the track you pick. ' : ''}Studio recordings, free to post anywhere.</p>
      <div className="music-picks">
        {LIBRARY_MUSIC.map((m) => pick(m.id, m.title, `${m.mood} · ${m.bpm} BPM · ${m.artist}`, m.colors))}
        <button className={`music-none ${musicId === null ? 'on' : ''}`} onClick={() => setMusicId(null)}>
          No music
        </button>
      </div>
      <details className="more-music" open={generated}>
        <summary>Generated beats</summary>
        <div className="music-picks">{MUSIC.map((m) => pick(m.id, m.title, `${m.mood} · ${m.bpm} BPM · ${formatDuration(trackLength(m).seconds)}`, m.colors))}</div>
      </details>
      <OwnSongs musicId={musicId} setMusicId={setMusicId} />
    </section>
  );
}

/** Generated sound files the app made itself, which aren't the user's songs. */
const GENERATED = /^(Whoosh|Impact|Slam|Crowd cheer)\.(wav|mp3)$|\(\d+ BPM\)\.(wav|mp3)$/;

/** Your own music: any song on the device, cut to its beat. */
function OwnSongs({ musicId, setMusicId }: { musicId: string | null; setMusicId: (id: string | null) => void }) {
  const assets = useEditor((s) => s.assets);
  const songs = Object.values(assets).filter((a) => a.kind === 'audio' && !a.internal && !GENERATED.test(a.name));
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const preview = (id: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    stopPreviewSound();
    const el = new Audio(assets[id].url);
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
    audio.current = el;
    setPlaying(id);
  };
  const pick = async (files: FileList) => {
    const added = await importFiles(files);
    const song = added.find((a) => a.kind === 'audio');
    if (song) setMusicId(`asset:${song.id}`);
  };
  return (
    <div className="own-songs">
      <h4 className="wiz-sub">Your own song</h4>
      <p className="hint">Use a track from your device. Beat-cut reels find its beats and cut on them. Only post music you have the rights to.</p>
      <div className="music-picks">
        {songs.map((a) => {
          const id = `asset:${a.id}`;
          return (
            <div key={a.id} className={`music-pick ${musicId === id ? 'on' : ''}`}>
              <button className="music-art own" aria-label={playing === a.id ? `Stop ${a.name}` : `Preview ${a.name}`} onClick={() => preview(a.id)}>
                <Icon name={playing === a.id ? 'pause' : 'play'} size={18} />
              </button>
              <button className="music-choose" onClick={() => setMusicId(id)}>
                <strong>{a.name.replace(/\.[^.]+$/, '')}</strong>
                <small>
                  Your music{a.bpm ? ` · ${a.bpm} BPM` : ''} · {formatDuration(a.duration)}
                </small>
              </button>
            </div>
          );
        })}
        <label className="music-none own-import">
          <Icon name="upload" size={16} /> Choose a song
          <input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" hidden onChange={(e) => e.target.files?.length && void pick(e.target.files)} />
        </label>
      </div>
    </div>
  );
}
