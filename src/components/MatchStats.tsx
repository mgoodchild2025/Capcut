import { useState } from 'react';
import { setMatchInfo, tagRally } from '../actions';
import type { MatchData, MatchPlayer, MatchRally, RallyAction } from '../model/types';
import { OPP_TAGS, pct3, playCounts, VOLLEY_TAGS, volleyStats, type MatchScore, type QuickTag, type RallyScore } from '../stats/matchStats';
import { sportOf } from '../templates/sports';
import { Icon } from '../ui/Icon';
import { loadInfo, parseRoster } from './ReelWizard';

const label = (p?: MatchPlayer) => (p ? [p.number && `#${p.number.replace('#', '')}`, p.name.split(/\s+/).slice(-1)[0]].filter(Boolean).join(' ') : 'Team');
export const isVolley = (m: MatchData) => sportOf(m.sport).scoring.result === 'sets';

/** The teams and players of a match, filled in from the reel details the first time. */
function MatchSetup({ assetId, match }: { assetId: string; match: MatchData }) {
  const info = loadInfo();
  const [paste, setPaste] = useState('');
  const [us, setUs] = useState(match.us ?? (info.team || info.club || (info.roster.length ? info.name : '') || ''));
  const [them, setThem] = useState(match.them ?? info.opponent ?? '');
  const sport = sportOf(match.sport ?? info.sport);
  const roster = info.roster.filter((r) => r.name.trim() || r.number.trim());
  const use = (list: { key: string; number: string; name: string; position: string }[]) =>
    setMatchInfo(assetId, {
      players: list.map(({ key, number, name, position }) => ({
        key,
        number,
        name,
        position,
      })),
      us: us.trim() || 'Us',
      them: them.trim() || 'Them',
      sport: match.sport ?? sport.id,
    });
  return (
    <div className="tag-setup">
      <strong>Who's playing?</strong>
      <small className="muted">Tag who did what in each rally: ClipForge keeps the score and builds the box score.</small>
      <div className="wiz-grid">
        <label className="wiz-field">
          <span>Your team</span>
          <input value={us} placeholder="Rockets" onChange={(e) => setUs(e.target.value)} />
        </label>
        <label className="wiz-field">
          <span>Opponent</span>
          <input value={them} placeholder="Westside Storm" onChange={(e) => setThem(e.target.value)} />
        </label>
      </div>
      <small className="muted">Your players:</small>
      {roster.length > 0 && (
        <button className="btn primary" onClick={() => use(roster)}>
          Use my roster ({roster.length} players)
        </button>
      )}
      <textarea rows={4} value={paste} placeholder={'Or paste them, one per line:\n12 Jordan Lee, Outside\n4 Sam Rivera, Setter'} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn" disabled={!paste.trim()} onClick={() => use(parseRoster(paste, sport))}>
        Use these players
      </button>
    </div>
  );
}

/**
 * Tagging one rally: pick a player, tap what they did; point-ending tags (a kill, an ace, an error)
 * give the point to the right side. Everything can be undone or changed.
 */
export function TagPad({
  assetId,
  match,
  rally,
  score,
  onNext,
  player,
  setPlayer,
}: {
  assetId: string;
  match: MatchData;
  rally: MatchRally;
  score?: RallyScore;
  onNext: () => void;
  /** The player being tagged (kept from rally to rally). */
  player: string | null;
  setPlayer: (key: string | null) => void;
}) {
  const [auto, setAuto] = useState(true);
  if (!match.players?.length) return <MatchSetup assetId={assetId} match={match} />;
  const volley = isVolley(match);
  const tags: QuickTag[] = volley
    ? VOLLEY_TAGS
    : sportOf(match.sport).plays.map((p) => ({
        id: p,
        label: p,
        skill: p,
        result: 'done',
      }));
  const byKey = new Map(match.players.map((p) => [p.key, p]));
  const after = (won?: 'us' | 'them') => {
    if (won && auto && !rally.won) setTimeout(onNext, 450);
  };
  const add = (t: QuickTag, who?: string) => {
    const action: Omit<RallyAction, 'id'> = {
      skill: t.skill,
      result: t.result,
      ...(who ? { player: who } : {}),
    };
    tagRally(assetId, rally.id, { add: action });
    after(t.point);
  };
  const point = (won: 'us' | 'them') => {
    tagRally(assetId, rally.id, { won: rally.won === won ? null : won });
    after(won);
  };
  const tagName = (a: RallyAction) => [...VOLLEY_TAGS, ...OPP_TAGS].find((t) => t.skill === a.skill && t.result === a.result)?.label ?? a.skill;
  const [us, them] = score?.before ?? [0, 0];
  return (
    <div className="tag-pad">
      <div className="tag-score">
        {volley && <span className="tag-set">Set {score?.set ?? 1}</span>}
        <span className={score?.serving === 'us' ? 'serving' : ''}>{match.us ?? 'Us'}</span>
        <b>
          {us}–{them}
        </b>
        <span className={score?.serving === 'them' ? 'serving' : ''}>{match.them ?? 'Them'}</span>
        {volley && !match.serveFirst && (
          <span className="tag-first">
            First serve:
            <button className="link-btn" onClick={() => setMatchInfo(assetId, { serveFirst: 'us' })}>
              us
            </button>
            /
            <button className="link-btn" onClick={() => setMatchInfo(assetId, { serveFirst: 'them' })}>
              them
            </button>
          </span>
        )}
        {score?.rotation && <span className="tag-rot">R{score.rotation}</span>}
      </div>
      <div className="tag-players" role="radiogroup" aria-label="Player">
        {match.players.map((p) => (
          <button key={p.key} role="radio" aria-checked={player === p.key} className={`chip-btn ${player === p.key ? 'on' : ''}`} onClick={() => setPlayer(p.key)}>
            {label(p)}
          </button>
        ))}
      </div>
      <div className={`tag-grid ${player ? '' : 'idle'}`}>
        {tags.map((t) => (
          <button key={t.id} className={`tag-btn ${t.point === 'us' ? 'good' : t.point === 'them' ? 'bad' : ''}`} disabled={!player} onClick={() => player && add(t, player)}>
            {t.label}
          </button>
        ))}
      </div>
      {volley && (
        <div className="tag-grid opp">
          {OPP_TAGS.map((t) => (
            <button key={t.id} className={`tag-btn ${t.point === 'us' ? 'good' : 'bad'}`} onClick={() => add(t)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="tag-point">
        <button className={`btn ${rally.won === 'us' ? 'primary' : ''}`} onClick={() => point('us')} aria-pressed={rally.won === 'us'}>
          {match.us ?? 'Our'} point
        </button>
        <button className={`btn ${rally.won === 'them' ? 'danger' : ''}`} onClick={() => point('them')} aria-pressed={rally.won === 'them'}>
          {match.them ?? 'Their'} point
        </button>
        <label className="check tag-auto">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Next rally after the point</span>
        </label>
      </div>
      {(rally.actions?.length ?? 0) > 0 && (
        <ol className="tag-list">
          {rally.actions!.map((a) => (
            <li key={a.id}>
              {a.player ? label(byKey.get(a.player)) : (match.them ?? 'Them')} · {tagName(a)}
              <button className="mini" aria-label="Remove tag" onClick={() => tagRally(assetId, rally.id, { remove: a.id })}>
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Watch = (title: string, test: (a: RallyAction) => boolean) => void;

/** A number that, when there's something behind it, plays the rallies it counts. */
function Cell({ v, title, test, watch, fmt }: { v: number | null; title: string; test: (a: RallyAction) => boolean; watch: Watch; fmt?: (v: number | null) => string }) {
  const text = fmt ? fmt(v) : v === null ? '–' : String(Math.round(v * 10) / 10);
  return (
    <td>
      {v ? (
        <button className="stat-link" title={`Watch: ${title}`} onClick={() => watch(title, test)}>
          {text}
        </button>
      ) : (
        text
      )}
    </td>
  );
}

const pctOf = ([a, b]: [number, number]) => (b ? `${Math.round((a / b) * 100)}% (${a}/${b})` : '–');

/** The box score: sets, team numbers, rotations and each player's line; tap a number to watch its plays. */
export function StatsPanel({ match, score, watch }: { match: MatchData; score: MatchScore; watch: Watch }) {
  const players = match.players ?? [];
  const tagged = match.rallies.filter((r) => r.won || r.actions?.length).length;
  if (!tagged) return <p className="wiz-lede">Tag a few rallies (who did what, who won the point) and the box score fills in here.</p>;
  if (!isVolley(match)) {
    const counts = playCounts(match);
    const plays = [...new Set([...counts.values()].flatMap((m) => [...m.keys()]))];
    return (
      <table className="box-score">
        <thead>
          <tr>
            <th>Player</th>
            {plays.map((p) => (
              <th key={p}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.key}>
              <th>{label(p)}</th>
              {plays.map((k) => (
                <Cell key={k} v={counts.get(p.key)?.get(k) ?? 0} title={`${label(p)} ${k}`} test={(a) => a.player === p.key && a.skill === k} watch={watch} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const st = volleyStats(match);
  const t = st.team;
  return (
    <div className="stats-panel">
      <div className="score-sets">
        <strong>
          {match.us ?? 'Us'} vs {match.them ?? 'Them'}
        </strong>
        <span>
          Sets {score.won[0]}–{score.won[1]} · {score.sets.map(([a, b], i) => `Set ${i + 1}: ${a}-${b}`).join(' · ')}
        </span>
      </div>
      <div className="team-numbers">
        <span>
          <b>{t.kills}</b> kills
        </span>
        <span>
          <b>{pct3(t.hitting)}</b> hitting
        </span>
        <span>
          <b>{t.aces}</b> aces · {t.serveErrors} serve errors
        </span>
        <span>
          <b>{t.passRating === null ? '–' : t.passRating.toFixed(2)}</b> pass avg
        </span>
        <span>
          <b>{t.blockSolos + t.blockAssists / 2}</b> blocks
        </span>
        <span>
          <b>{t.digs}</b> digs
        </span>
        <span>
          <b>{st.oppErrors}</b> their errors
        </span>
        <span>Sideout {pctOf(st.sideout)}</span>
        <span>Point scoring {pctOf(st.pointScoring)}</span>
      </div>
      <h4 className="wiz-sub">Rotations</h4>
      <div className="rotations">
        {st.rotations.map(([w, l], i) => (
          <span key={i} className={w > l ? 'up' : w < l ? 'down' : ''}>
            <b>R{i + 1}</b> +{w} −{l}
          </span>
        ))}
      </div>
      <h4 className="wiz-sub">Players</h4>
      <div className="box-wrap">
        <table className="box-score">
          <thead>
            <tr>
              <th>Player</th>
              <th title="Kills">K</th>
              <th title="Attack errors">E</th>
              <th title="Total attempts">TA</th>
              <th title="Hitting percentage">Hit</th>
              <th title="Aces">SA</th>
              <th title="Serve errors">SE</th>
              <th title="Receptions">Rec</th>
              <th title="Pass average (0-3)">Pass</th>
              <th title="Assists">Ast</th>
              <th title="Blocks (solo + half of assists)">Blk</th>
              <th title="Digs">Dig</th>
              <th title="Points">Pts</th>
            </tr>
          </thead>
          <tbody>
            {players
              .filter((p) => st.players.has(p.key))
              .map((p) => {
                const l = st.players.get(p.key)!;
                const who = label(p);
                const mine = (f: (a: RallyAction) => boolean) => (a: RallyAction) => a.player === p.key && f(a);
                return (
                  <tr key={p.key}>
                    <th>{who}</th>
                    <Cell v={l.kills} title={`${who} kills`} test={mine((a) => a.skill === 'attack' && a.result === 'kill')} watch={watch} />
                    <Cell
                      v={l.attackErrors}
                      title={`${who} attack errors`}
                      test={mine((a) => a.skill === 'attack' && (a.result === 'error' || a.result === 'blocked'))}
                      watch={watch}
                    />
                    <Cell v={l.attempts} title={`${who} attacks`} test={mine((a) => a.skill === 'attack')} watch={watch} />
                    <td>{pct3(l.hitting)}</td>
                    <Cell v={l.aces} title={`${who} aces`} test={mine((a) => a.skill === 'serve' && a.result === 'ace')} watch={watch} />
                    <Cell v={l.serveErrors} title={`${who} serve errors`} test={mine((a) => a.skill === 'serve' && a.result === 'error')} watch={watch} />
                    <Cell v={l.receptions} title={`${who} passes`} test={mine((a) => a.skill === 'pass')} watch={watch} />
                    <td>{l.passRating === null ? '–' : l.passRating.toFixed(2)}</td>
                    <Cell v={l.assists} title={`${who} assists`} test={mine((a) => a.skill === 'set' && a.result === 'assist')} watch={watch} />
                    <Cell v={l.blockSolos + l.blockAssists / 2} title={`${who} blocks`} test={mine((a) => a.skill === 'block' && a.result !== 'error')} watch={watch} />
                    <Cell v={l.digs} title={`${who} digs`} test={mine((a) => a.skill === 'dig' && a.result === 'dig')} watch={watch} />
                    <td>{l.points}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
