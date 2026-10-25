import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphicLook } from '../model/types';
import { drawPoster, graphicsFonts, loadImage, renderPoster, shareImages } from '../engine/poster';
import { opponentColors } from '../templates/broadcast';
import { POSTER_FORMATS, POSTER_IMAGES, POSTER_KINDS, posterFileName, posterSpec, type PosterFormat, type PosterKind } from '../templates/posters';
import type { ReelInfo } from '../templates/reel';
import { SPORTS, sportOf, type Sport } from '../templates/sports';
import { toast, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { AWARDS, ColorPairs, HEADLINES, LOOKS, LogoDrop, loadInfo, parseRoster, positionsWith, STORE_KEY, withSport } from './ReelWizard';

/** Loads an image from a URL as state, for drawing. */
function useImg(url?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let live = true;
    void loadImage(url).then((i) => live && setImg(i));
    return () => {
      live = false;
    };
  }, [url]);
  return img;
}

/** Game-day graphics, final scores, spotlights and commitments as images to post. */
export function PosterStudio() {
  const [kind, setKind] = useState<PosterKind>(useEditor.getState().posters?.kind ?? 'gameday');
  const [format, setFormat] = useState<PosterFormat>('story');
  // Posters keep the team's name apart from the player's; it starts as the team last used.
  const [info, setInfo] = useState<ReelInfo>(() => {
    const i = loadInfo();
    return { ...i, team: i.team ?? i.club };
  });
  const [photo, setPhoto] = useState<{ url: string; blob: Blob; cut?: string; useCut: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rosterText, setRosterText] = useState('');
  const meta = POSTER_KINDS.find((k) => k.id === kind)!;
  const sport = sportOf(info.sport);
  const set = (patch: Partial<ReelInfo>) => setInfo((i) => ({ ...i, ...patch }));
  const close = () => useEditor.setState({ posters: null });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
  }, [info]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => () => {
    if (photo) {
      URL.revokeObjectURL(photo.url);
      if (photo.cut) URL.revokeObjectURL(photo.cut);
    }
  }, [photo]);

  const logo = useImg(info.logo);
  const opp = useImg(info.oppLogo);
  const college = useImg(info.collegeLogo);
  const photoImg = useImg(photo ? (photo.useCut && photo.cut ? photo.cut : photo.url) : undefined);
  const usesPhoto = meta.fields.includes('photo');
  const images = useMemo(() => ({ [POSTER_IMAGES.logo]: logo, [POSTER_IMAGES.opp]: opp, [POSTER_IMAGES.college]: college }), [logo, opp, college]);
  const spec = useMemo(
    () => posterSpec(kind, info, { logo: !!logo, opp: !!opp, college: !!college, photo: usesPhoto && !!photoImg, cutout: !!photo?.useCut && !!photo.cut }),
    [kind, info, logo, opp, college, photoImg, usesPhoto, photo],
  );
  const size = POSTER_FORMATS.find((f) => f.id === format)!.size;

  // Live preview of the finished poster.
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const [W, H] = size;
    const k = 720 / Math.max(W, H);
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    const ctx = c.getContext('2d')!;
    const draw = () => {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawPoster(ctx, spec, W, H, images, usesPhoto ? photoImg : null);
    };
    draw();
    let live = true;
    void graphicsFonts().then(() => live && draw());
    return () => {
      live = false;
    };
  }, [spec, size, images, photoImg, usesPhoto]);

  const save = async (all: boolean) => {
    setBusy(all ? 'all' : 'one');
    try {
      const formats = all ? POSTER_FORMATS : POSTER_FORMATS.filter((f) => f.id === format);
      const files: File[] = [];
      for (const f of formats) {
        const blob = await renderPoster(spec, f.size, images, usesPhoto ? photoImg : null);
        files.push(new File([blob], posterFileName(kind, f.id, info), { type: 'image/png' }));
      }
      const how = await shareImages(files);
      if (how === 'downloaded') toast(files.length > 1 ? `Saved ${files.length} images` : `Saved ${files[0].name}`);
    } catch (e) {
      toast(`Couldn't make the image: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = (file?: File) => {
    if (!file) return;
    setPhoto({ url: URL.createObjectURL(file), blob: file, useCut: false });
  };
  const cutOut = async (on: boolean) => {
    if (!photo) return;
    if (!on || photo.cut) return setPhoto({ ...photo, useCut: on });
    setBusy('cut');
    try {
      const { removeBackground } = await import('../ai/cutout');
      const png = await removeBackground(photo.blob);
      setPhoto((p) => (p ? { ...p, cut: URL.createObjectURL(png), useCut: true } : p));
    } catch {
      toast("Couldn't cut the photo out right now (it needs a one-time download).");
    } finally {
      setBusy(null);
    }
  };

  const field = (key: keyof ReelInfo, label: string, placeholder = '', wide = false) => (
    <label className={`wiz-field ${wide ? 'span2' : ''}`}>
      <span>{label}</span>
      <input value={(info[key] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<ReelInfo>)} />
    </label>
  );
  const vars = { '--team1': info.colors[0], '--team2': info.colors[1] } as React.CSSProperties;
  const player = meta.subject === 'player';

  return (
    <div className="modal-backdrop wiz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="wizard poster-studio" role="dialog" aria-modal="true" aria-labelledby="poster-title" style={vars}>
        <header className="wiz-head">
          <div className="wiz-brand">
            <Icon name="image" size={22} />
            <h2 id="poster-title">Graphics &amp; posters</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="close" />
          </button>
        </header>
        <div className="wiz-body poster-body">
          <div className="poster-form">
            <div className="poster-kinds" role="radiogroup" aria-label="Poster">
              {POSTER_KINDS.map((k) => (
                <button key={k.id} role="radio" aria-checked={kind === k.id} className={`chip-btn ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)} title={k.blurb}>
                  {k.title}
                </button>
              ))}
            </div>
            <p className="wiz-lede">{meta.blurb}</p>
            <div className="wiz-grid">
              <label className="wiz-field">
                <span>Sport</span>
                <select value={sport.id} onChange={(e) => setInfo((i) => withSport(i, e.target.value as Sport['id']))}>
                  {SPORTS.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wiz-field">
                <span>Look</span>
                <select value={info.look ?? 'broadcast'} onChange={(e) => set({ look: e.target.value as GraphicLook })}>
                  {LOOKS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              {player ? (
                <>
                  {field('name', 'Player name', 'Jordan Lee', true)}
                  {field('number', 'Jersey #', '12')}
                  <label className="wiz-field">
                    <span>Position</span>
                    <select value={info.position} onChange={(e) => set({ position: e.target.value })}>
                      {positionsWith(sport, info.position).map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  {kind === 'commit' && field('gradYear', 'Class of', '2027')}
                  {field('team', 'Team', 'Rockets 17 Elite')}
                  {kind === 'player' && (
                    <label className="wiz-field span2">
                      <span>Headline</span>
                      <input list="poster-headlines" value={info.headline} placeholder="Player of the Game" onChange={(e) => set({ headline: e.target.value })} />
                      <datalist id="poster-headlines">
                        {HEADLINES.map((h) => (
                          <option key={h} value={h} />
                        ))}
                      </datalist>
                    </label>
                  )}
                  {kind === 'award' && (
                    <>
                      <label className="wiz-field">
                        <span>Award</span>
                        <input list="poster-awards" value={info.award ?? ''} placeholder="Play of the Week" onChange={(e) => set({ award: e.target.value })} />
                        <datalist id="poster-awards">
                          {AWARDS.map((h) => (
                            <option key={h} value={h} />
                          ))}
                        </datalist>
                      </label>
                      {field('week', 'Week or game', 'Week 7')}
                    </>
                  )}
                  {kind === 'commit' && field('college', 'College', 'State University', true)}
                </>
              ) : (
                <>
                  {field('team', 'Team name', 'Rockets 17 Elite', true)}
                  {meta.fields.includes('opponent') && field('opponent', 'Opponent', 'Westside Storm', true)}
                  {meta.fields.includes('venue') && field('venue', 'When & where', 'Fri 7 PM · Lincoln Gym', true)}
                  {meta.fields.includes('records') && (
                    <>
                      {field('record', 'Our record', '24-6')}
                      {field('oppRecord', 'Their record', '19-9')}
                    </>
                  )}
                  {kind === 'stats' && field('statsTitle', 'Board title', 'Season stats', true)}
                  {kind === 'stats' && field('season', 'Season', '2026')}
                </>
              )}
            </div>

            {meta.fields.includes('sets') && (
              <>
                <h4 className="wiz-sub">Score</h4>
                <div className="set-scores">
                  {info.sets.map(([a, b], i) => (
                    <span key={i} className="set-score">
                      <small>
                        {sport.scoring.period} {i + 1}
                      </small>
                      <input aria-label={`${sport.scoring.period} ${i + 1} our score`} inputMode="numeric" value={a} placeholder="25" onChange={(e) => setInfo((x) => ({ ...x, sets: x.sets.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) }))} />
                      <b>–</b>
                      <input aria-label={`${sport.scoring.period} ${i + 1} their score`} inputMode="numeric" value={b} placeholder="21" onChange={(e) => setInfo((x) => ({ ...x, sets: x.sets.map((r, j) => (j === i ? [r[0], e.target.value] : r)) }))} />
                      <button className="mini" aria-label={`Remove ${sport.scoring.period.toLowerCase()} ${i + 1}`} onClick={() => setInfo((x) => ({ ...x, sets: x.sets.filter((_, j) => j !== i) }))}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                  <button className="link-btn" onClick={() => setInfo((x) => ({ ...x, sets: [...x.sets, ['', '']] }))}>
                    + Add {sport.scoring.period.toLowerCase()}
                  </button>
                </div>
              </>
            )}

            {kind === 'stats' && (
              <>
                <h4 className="wiz-sub">Stats</h4>
                <div className="stat-rows">
                  {info.stats.map(([k, v], i) => (
                    <div key={i} className="stat-row">
                      <input aria-label="Stat name" value={k} onChange={(e) => setInfo((s) => ({ ...s, stats: s.stats.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) }))} />
                      <input aria-label={`${k || 'Stat'} value`} inputMode="decimal" value={v} placeholder="0" onChange={(e) => setInfo((s) => ({ ...s, stats: s.stats.map((r, j) => (j === i ? [r[0], e.target.value] : r)) }))} />
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

            {kind === 'lineup' && (
              <>
                <h4 className="wiz-sub">
                  Starters <small>{info.roster.filter((r) => r.starter && (r.name.trim() || r.number.trim())).length} on the board</small>
                </h4>
                <div className="roster-paste">
                  <textarea rows={4} value={rosterText} placeholder={'One per line, e.g.\n12 Jordan Lee, Outside\n4 Sam Rivera, Setter'} onChange={(e) => setRosterText(e.target.value)} />
                  <button className="btn" disabled={!rosterText.trim()} onClick={() => (set({ roster: parseRoster(rosterText, sport) }), setRosterText(''))}>
                    Use these starters
                  </button>
                </div>
              </>
            )}

            {usesPhoto && (
              <>
                <h4 className="wiz-sub">
                  Photo <small>optional</small>
                </h4>
                <div className="logo-row">
                  <label className="logo-drop poster-photo" title={photo ? 'Change photo' : 'Add photo'}>
                    {photo ? <img src={photo.useCut && photo.cut ? photo.cut : photo.url} alt="Player" /> : <Icon name="upload" />}
                    <input type="file" accept="image/*" hidden onChange={(e) => (pickPhoto(e.target.files?.[0]), (e.target.value = ''))} />
                  </label>
                  {photo && (
                    <button className={`chip-btn ${photo.useCut ? 'on' : ''}`} aria-pressed={photo.useCut} disabled={busy === 'cut'} onClick={() => void cutOut(!photo.useCut)}>
                      {busy === 'cut' ? 'Cutting out...' : 'Cut out'}
                    </button>
                  )}
                  <small className="muted">A posed photo works best. Cut out removes the background.</small>
                </div>
              </>
            )}

            <h4 className="wiz-sub">Colours</h4>
            <ColorPairs value={info.colors} onChange={(colors) => set({ colors })} label="Team" />
            {kind === 'gameday' && (
              <>
                <h4 className="wiz-sub">Opponent colours</h4>
                <ColorPairs value={opponentColors(info)} onChange={(oppColors) => set({ oppColors })} label="Opponent" />
              </>
            )}
            <h4 className="wiz-sub">
              Logos <small>optional, remembered</small>
            </h4>
            <div className="logo-row">
              <LogoDrop value={info.logo} onChange={(v) => set({ logo: v })} label="team logo" />
              {(meta.fields.includes('opponent') || kind === 'victory') && <LogoDrop value={info.oppLogo} onChange={(v) => set({ oppLogo: v })} label="opponent logo" />}
              {kind === 'commit' && <LogoDrop value={info.collegeLogo} onChange={(v) => set({ collegeLogo: v })} label="college logo" />}
              <small className="muted">{kind === 'commit' ? 'Your team logo, then the college logo.' : 'PNGs with a transparent background look best.'}</small>
            </div>
          </div>

          <aside className="poster-preview">
            <div className="segmented poster-formats" role="radiogroup" aria-label="Size">
              {POSTER_FORMATS.map((f) => (
                <button key={f.id} role="radio" aria-checked={format === f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)} title={f.hint}>
                  {f.label}
                </button>
              ))}
            </div>
            <canvas ref={canvas} className={`poster-canvas ${format}`} aria-label={`${meta.title} poster preview`} />
            <small className="muted">{POSTER_FORMATS.find((f) => f.id === format)!.hint}</small>
          </aside>
        </div>
        <footer className="wiz-foot">
          <span className="wiz-summary">
            {meta.title} · {POSTER_FORMATS.find((f) => f.id === format)!.label} {size[0]}x{size[1]}
          </span>
          <div className="wiz-actions">
            <button className="btn" disabled={!!busy} onClick={() => void save(true)}>
              {busy === 'all' ? 'Making...' : 'All 3 sizes'}
            </button>
            <button className="btn primary go" disabled={!!busy} onClick={() => void save(false)}>
              <Icon name="share" /> {busy === 'one' ? 'Making...' : 'Save image'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
