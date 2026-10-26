import { useEffect, useMemo, useState } from 'react';
import { applyLooseReelSettings, applyReelSettings } from '../actions';
import type { GraphicLook } from '../model/types';
import type { ReelInfo } from '../templates/reel';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { LeagueForm } from './LeagueForm';
import { ColorPairs, loadInfo, LOOKS, LogoDrop, MusicStep, styleOf } from './ReelWizard';

/**
 * A built reel's details, changed in one place: names, colours, look, logos and music, across
 * every title and card it made. Titles typed over by hand keep their words.
 */
export function ReelSettings() {
  const rec = useEditor((s) => s.project.reel);
  const busy = useEditor((s) => !!s.task);
  const close = () => useEditor.setState({ reelSettings: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useEditor.getState().task && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="modal-backdrop wiz-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="wizard reel-settings" role="dialog" aria-modal="true" aria-labelledby="rs-title">
        <header className="wiz-head">
          <div className="wiz-brand">
            <Icon name="wand" size={22} />
            <h2 id="rs-title">Reel settings</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>
        {rec ? <Recorded onDone={close} /> : <Loose onDone={close} />}
      </div>
    </div>
  );
}

/** A reel with its details on record: change them, and every title follows. */
function Recorded({ onDone }: { onDone: () => void }) {
  const rec = useEditor((s) => s.project.reel)!;
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const busy = useEditor((s) => !!s.task);
  const style = styleOf(rec.input.style);
  const team = style.subject === 'team';
  const [info, setInfo] = useState<ReelInfo>(rec.input.info);
  const [musicId, setMusicId] = useState<string | null>(rec.musicId);
  const [recut, setRecut] = useState(true);
  const [untouched, setUntouched] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void import('../templates/reelEdit').then((m) => live && setUntouched(m.cutsUntouched(project, assets)));
    return () => {
      live = false;
    };
  }, [project, assets]);
  const set = (patch: Partial<ReelInfo>) => setInfo((i) => ({ ...i, ...patch }));
  const songChanged = musicId !== rec.musicId;
  const changed = songChanged || JSON.stringify(info) !== JSON.stringify(rec.input.info);
  const field = (key: keyof ReelInfo, label: string, placeholder = '') => (
    <label className="wiz-field">
      <span>{label}</span>
      <input value={(info[key] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<ReelInfo>)} />
    </label>
  );
  const apply = async () => {
    if (await applyReelSettings({ info, musicId, recut: recut && !!untouched })) onDone();
  };
  return (
    <>
      <div className="wiz-body rs-body">
        <p className="wiz-lede">Changes go to every title and card in this {style.title.toLowerCase()} reel. Anything you've typed over by hand stays as you left it.</p>
        {style.subject === 'league' ? (
          <LeagueForm info={info} setInfo={setInfo} style={rec.input.style} format={false} />
        ) : (
          <>
            <div className="player-form">
              <label className="wiz-field span2">
                <span>{team ? 'Team name' : 'Player name'}</span>
                <input value={info.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              {!team && field('number', 'Number', '12')}
              {!team && field('position', 'Position', 'Outside Hitter')}
              {field('club', team ? 'Club' : 'Club or team', 'Rockets 17 Elite')}
              {!team && field('school', 'School', 'Lincoln High')}
              {field('opponent', 'Opponent', 'Westside Storm')}
              {team && field('record', 'Record', '24-6')}
              {!team && field('headline', 'Headline', 'Player of the Game')}
              <label className="wiz-field span2">
                <span>Graphics look</span>
                <select value={info.look ?? 'broadcast'} onChange={(e) => set({ look: e.target.value as GraphicLook })}>
                  {LOOKS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}: {l.hint}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h4 className="wiz-sub">Team colours</h4>
            <ColorPairs value={info.colors} onChange={(colors) => set({ colors })} label="Team" />
            <h4 className="wiz-sub">Logos</h4>
            <div className="rs-logos">
              <LogoDrop value={info.logo} onChange={(logo) => set({ logo })} label="team logo" />
              <LogoDrop value={info.oppLogo} onChange={(oppLogo) => set({ oppLogo })} label="opponent logo" />
              <small className="muted">Your team's logo, then the opponent's.</small>
            </div>
          </>
        )}
        <h4 className="wiz-sub">Music</h4>
        <MusicStep musicId={musicId} setMusicId={setMusicId} style={rec.input.style} heading={false} />
        {songChanged && musicId && (
          <label className={`check rs-recut ${untouched ? '' : 'muted'}`}>
            <input type="checkbox" checked={recut && !!untouched} disabled={!untouched} onChange={(e) => setRecut(e.target.checked)} />
            <span>
              <strong>Cut to the new song's beat</strong>
              <small>
                {untouched === false
                  ? "You've changed the cuts, so the song is swapped in place and your cuts stay. Edit reel can re-cut the whole reel."
                  : 'The plays and titles move to land on its beats.'}
              </small>
            </span>
          </label>
        )}
      </div>
      <footer className="wiz-foot">
        <button
          className="btn"
          disabled={busy}
          onClick={() => useEditor.setState({ reelSettings: false, wizard: { edit: true } })}
          title="Open the reel wizard with everything as you chose it: change the template, the plays, the spotlights"
        >
          <Icon name="edit" /> Edit reel
        </button>
        <div className="wiz-actions">
          <button className="btn" onClick={onDone} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary go" disabled={!changed || busy || !info.name.trim()} onClick={() => void apply()}>
            <Icon name="check" /> Apply
          </button>
        </div>
      </footer>
    </>
  );
}

/** A reel made before its details were kept: colours, look, logo, music and replacing words. */
function Loose({ onDone }: { onDone: () => void }) {
  const project = useEditor((s) => s.project);
  const busy = useEditor((s) => !!s.task);
  const first = project.clips.find((c) => c.graphic)?.graphic;
  const saved = useMemo(loadInfo, []);
  const [colors, setColors] = useState<[string, string]>(first?.colors ?? saved.colors);
  const [look, setLook] = useState<GraphicLook>(first?.look ?? 'broadcast');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [musicId, setMusicId] = useState<string | null | undefined>(undefined);
  const [replace, setReplace] = useState<[string, string][]>(() => {
    const words = project.clips
      .flatMap((c) => Object.values(c.graphic?.text ?? {}))
      .join(' ')
      .toLowerCase();
    // Start from the names last used in a reel, where the titles show them.
    return [saved.name, saved.club, saved.opponent]
      .map((w) => w?.trim())
      .filter((w): w is string => !!w && words.includes(w.toLowerCase()))
      .map((w) => [w, w] as [string, string])
      .concat([['', '']]);
  });
  const changed =
    colors !== (first?.colors ?? saved.colors) ||
    look !== (first?.look ?? 'broadcast') ||
    !!logo ||
    musicId !== undefined ||
    replace.some(([a, b]) => a.trim() && a.trim() !== b.trim());
  const apply = async () => {
    if (await applyLooseReelSettings({ colors, look, logo, musicId, replace })) onDone();
  };
  return (
    <>
      <div className="wiz-body rs-body">
        <p className="wiz-lede">This reel was made before its details were kept, so names are changed by replacing words. Colours, look, logo and music go to every title.</p>
        <h4 className="wiz-sub">Replace words</h4>
        <div className="rs-replace">
          {replace.map(([from, to], i) => (
            <div key={i} className="rs-replace-row">
              <input
                className="text-input"
                aria-label="Replace"
                placeholder="Old name"
                value={from}
                onChange={(e) =>
                  setReplace((r) => [
                    ...r.map((x, j): [string, string] => (j === i ? [e.target.value, x[1]] : x)),
                    ...(i === r.length - 1 && e.target.value ? [['', ''] as [string, string]] : []),
                  ])
                }
              />
              <Icon name="chevronRight" size={14} />
              <input
                className="text-input"
                aria-label="With"
                placeholder="New name"
                value={to}
                onChange={(e) => setReplace((r) => r.map((x, j): [string, string] => (j === i ? [x[0], e.target.value] : x)))}
              />
            </div>
          ))}
        </div>
        <label className="wiz-field">
          <span>Graphics look</span>
          <select value={look} onChange={(e) => setLook(e.target.value as GraphicLook)}>
            {LOOKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}: {l.hint}
              </option>
            ))}
          </select>
        </label>
        <h4 className="wiz-sub">Team colours</h4>
        <ColorPairs value={colors} onChange={setColors} label="Team" />
        <h4 className="wiz-sub">Logo</h4>
        <div className="rs-logos">
          <LogoDrop value={logo} onChange={setLogo} label="team logo" />
          <small className="muted">Replaces the logo on every title that shows one.</small>
        </div>
        <h4 className="wiz-sub">Music</h4>
        <MusicStep musicId={musicId ?? null} setMusicId={setMusicId} style="recap" heading={false} />
        <small className="muted">A new song is swapped in place; the cuts stay where they are.</small>
      </div>
      <footer className="wiz-foot">
        <span className="wiz-summary">Undo puts everything back.</span>
        <div className="wiz-actions">
          <button className="btn" onClick={onDone} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary go" disabled={!changed || busy} onClick={() => void apply()}>
            <Icon name="check" /> Apply
          </button>
        </div>
      </footer>
    </>
  );
}
