import { useState } from 'react';
import type { GraphicLook } from '../model/types';
import { blankLeague, DEFAULT_TAGLINE, isLeagueStyle } from '../templates/league';
import { TEAM_COLORS, type LeagueDetails, type LeagueGame, type LeagueTeam, type ReelInfo, type ReelStyle } from '../templates/reel';
import { Icon } from '../ui/Icon';
import { uid } from '../utils';
import { ColorPairs, LOOKS, LogoDrop } from './ReelWizard';

/**
 * A league promo's details: the league (name, logo, colours, look), what the spot says (slogan,
 * when, where, website, sponsor), and its teams. Also used by Reel settings (without `format`).
 */
export function LeagueForm({ info, setInfo, style, format = true }: { info: ReelInfo; setInfo: (f: (i: ReelInfo) => ReelInfo) => void; style: ReelStyle; format?: boolean }) {
  const L: LeagueDetails = { ...blankLeague(), ...info.league };
  const setL = (patch: Partial<LeagueDetails>) => setInfo((i) => ({ ...i, league: { ...blankLeague(), ...i.league, ...patch } }));
  const setTeam = (key: string, patch: Partial<LeagueTeam>) => setL({ teams: L.teams.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  const [paste, setPaste] = useState('');
  const tournament = ['tournament', 'final', 'champions'].includes(style);
  const teamsMatter = style !== 'signup' && style !== 'tournament';
  const ordered = style === 'playoffs' || style === 'standings' || style === 'champions';
  const records = style === 'gamenight' || style === 'final' || style === 'standings';
  const pair = style === 'gamenight' || style === 'final';
  const named = L.teams.filter((t) => t.name.trim());
  const games = L.games ?? [];
  const setGame = (key: string, patch: Partial<LeagueGame>) => setL({ games: games.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  const newTeam = (name: string, i: number): LeagueTeam => ({ key: uid('t_'), name, colors: TEAM_COLORS[i % TEAM_COLORS.length].colors });
  const addPasted = () => {
    const names = paste
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    setL({ teams: [...L.teams, ...names.map((n, i) => newTeam(n, L.teams.length + i))] });
    setPaste('');
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= L.teams.length) return;
    const next = L.teams.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setL({ teams: next });
  };
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, span = false) => (
    <label className={`wiz-field ${span ? 'span2' : ''}`}>
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <section className="wiz-step league-form">
      {format && (
        <>
          <h3 className="wiz-title">Where it will play</h3>
          <div className="segmented league-format" role="radiogroup" aria-label="Format">
            {(
              [
                ['tv', 'TV & YouTube', '16:9'],
                ['social', 'Stories & Reels', '9:16'],
              ] as const
            ).map(([id, label, hint]) => (
              <button
                key={id}
                role="radio"
                aria-checked={(info.format ?? 'tv') === id}
                className={(info.format ?? 'tv') === id ? 'on' : ''}
                onClick={() => setInfo((i) => ({ ...i, format: id }))}
              >
                {label} <small>{hint}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <h3 className="wiz-title">{tournament ? 'The tournament' : 'The league'}</h3>
      <div className="player-form">
        {field(
          tournament ? 'Tournament name' : 'League name',
          info.name,
          (name) => setInfo((i) => ({ ...i, name })),
          tournament ? 'Spring Showdown' : 'Metro Volleyball League',
          true,
        )}
        {field('Season', info.season, (season) => setInfo((i) => ({ ...i, season })), '2026')}
        <label className="wiz-field">
          <span>Graphics look</span>
          <select value={info.look ?? 'broadcast'} onChange={(e) => setInfo((i) => ({ ...i, look: e.target.value as GraphicLook }))}>
            {LOOKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rs-logos">
        <LogoDrop value={info.logo} onChange={(logo) => setInfo((i) => ({ ...i, logo }))} label={tournament ? 'tournament logo' : 'league logo'} />
        <small className="muted">{tournament ? "The tournament's" : "The league's"} logo lands on the sign-off. A PNG with a transparent background looks best.</small>
      </div>
      <ColorPairs value={info.colors} onChange={(colors) => setInfo((i) => ({ ...i, colors }))} label="League" />

      <h3 className="wiz-title">What it says</h3>
      <div className="player-form">
        {field('Slogan', L.tagline, (tagline) => setL({ tagline }), isLeagueStyle(style) ? DEFAULT_TAGLINE[style] : '', true)}
        <small className="league-hint span2">Short sentences: each one slams in on its own beat.</small>
        {style === 'signup' || style === 'tournament' ? (
          <>
            {style === 'tournament' && field('Dates', L.when, (when) => setL({ when }), 'May 16-17')}
            {style === 'tournament' && field('Venue', L.where, (where) => setL({ where }), 'Metro Sports Complex · Toronto')}
            {field('Divisions', L.divisions ?? '', (divisions) => setL({ divisions }), 'U14 · U16 · U18 · Open', true)}
            {style === 'signup' && field('Season dates', L.when, (when) => setL({ when }), 'Jan 10 to Apr 4')}
            {style === 'tournament' && field('Prize', L.prize ?? '', (prize) => setL({ prize }), '$2,000 prize pool')}
            {field(style === 'tournament' ? 'Entry fee' : 'Fee', L.fee ?? '', (fee) => setL({ fee }), style === 'tournament' ? '$400 per team' : '$250 per player')}
            {field(style === 'tournament' ? 'Enter by' : 'Register by', L.deadline ?? '', (deadline) => setL({ deadline }), 'Dec 15')}
          </>
        ) : style === 'champions' ? (
          <>
            {field('Final score', L.score ?? '', (score) => setL({ score }), '2-1')}
            {field('MVP', L.mvp ?? '', (mvp) => setL({ mvp }), 'Jordan Lee (optional)')}
          </>
        ) : style === 'schedule' ? null : (
          <>
            {field(
              ({ gamenight: 'When', playoffs: 'Playoffs start', final: 'The final', standings: 'Next games' } as Record<string, string>)[style] ?? 'Opening night',
              L.when,
              (when) => setL({ when }),
              'Sat Jan 10 · 7 PM',
            )}
            {field('Where to be or watch', L.where, (where) => setL({ where }), 'Metro Arena · Live on YouTube')}
            {style === 'final' && field('Prize', L.prize ?? '', (prize) => setL({ prize }), 'The Showdown Cup')}
          </>
        )}
        {field(
          style === 'signup' || style === 'tournament' ? `${style === 'tournament' ? 'Entry' : 'Sign-up'} page (for the QR code)` : 'Website',
          L.url,
          (url) => setL({ url }),
          style === 'signup' || style === 'tournament' ? 'https://metrovl.ca/register' : 'metrovl.ca',
        )}
        {field('Presented by', L.sponsor, (sponsor) => setL({ sponsor }), 'Sponsor (optional)')}
      </div>

      {teamsMatter && (
        <>
          <h3 className="wiz-title">Teams</h3>
          <p className="wiz-lede">
            {(
              {
                playoffs: 'In seed order, first seed at the top (up to eight make the bracket).',
                gamenight: "Add the league's teams, then pick tonight's two.",
                final: 'Add the teams, then pick the two finalists.',
                standings: 'In table order, the leader at the top, with each record and points.',
                champions: 'In finishing order: the champions first, then second and third for the podium.',
                schedule: "Add the league's teams, then this week's games below.",
              } as Record<string, string>
            )[style] ?? 'Every team in the league, for the logo wall.'}
          </p>
          <div className="league-teams">
            {L.teams.map((t, i) => (
              <div key={t.key} className="league-team">
                {ordered && <b className="seed">{i + 1}</b>}
                <LogoDrop value={t.logo} onChange={(logo) => setTeam(t.key, { logo })} label={`${t.name || 'team'} logo`} />
                <input className="text-input" aria-label="Team name" value={t.name} placeholder="Team name" onChange={(e) => setTeam(t.key, { name: e.target.value })} />
                <input type="color" aria-label={`${t.name} main colour`} value={t.colors[0]} onChange={(e) => setTeam(t.key, { colors: [e.target.value, t.colors[1]] })} />
                <input type="color" aria-label={`${t.name} accent colour`} value={t.colors[1]} onChange={(e) => setTeam(t.key, { colors: [t.colors[0], e.target.value] })} />
                {records && (
                  <input
                    className="text-input record"
                    aria-label={`${t.name} record`}
                    value={t.record ?? ''}
                    placeholder="8-2"
                    onChange={(e) => setTeam(t.key, { record: e.target.value })}
                  />
                )}
                {style === 'standings' && (
                  <input
                    className="text-input record"
                    aria-label={`${t.name} points`}
                    value={t.points ?? ''}
                    placeholder="Pts"
                    onChange={(e) => setTeam(t.key, { points: e.target.value })}
                  />
                )}
                {ordered && (
                  <>
                    <button className="mini" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button className="mini" aria-label="Move down" disabled={i === L.teams.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </>
                )}
                <button className="mini" aria-label={`Remove ${t.name || 'team'}`} onClick={() => setL({ teams: L.teams.filter((x) => x.key !== t.key) })}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="league-add">
            <button className="btn" onClick={() => setL({ teams: [...L.teams, newTeam('', L.teams.length)] })}>
              <Icon name="plus" /> Add a team
            </button>
            <textarea
              className="text-input"
              rows={2}
              value={paste}
              placeholder="Or paste team names, one per line"
              onChange={(e) => setPaste(e.target.value)}
              aria-label="Paste team names"
            />
            <button className="btn" disabled={!paste.trim()} onClick={addPasted}>
              Add these
            </button>
          </div>
          {pair && L.teams.length >= 2 && (
            <div className="player-form">
              <label className="wiz-field">
                <span>{style === 'final' ? 'Finalist' : 'Visitors'}</span>
                <select value={L.away ?? L.teams[0].key} onChange={(e) => setL({ away: e.target.value })}>
                  {L.teams.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name || 'Team'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wiz-field">
                <span>{style === 'final' ? 'Finalist' : 'Home'}</span>
                <select value={L.home ?? L.teams[1].key} onChange={(e) => setL({ home: e.target.value })}>
                  {L.teams.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name || 'Team'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {style === 'schedule' && (
            <>
              <h3 className="wiz-title">This week's games</h3>
              <div className="league-games">
                {games.map((x) => (
                  <div key={x.key} className="league-game">
                    <select aria-label="Visitors" value={x.away} onChange={(e) => setGame(x.key, { away: e.target.value })}>
                      {named.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <span className="at">at</span>
                    <select aria-label="Home" value={x.home} onChange={(e) => setGame(x.key, { home: e.target.value })}>
                      {named.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <input className="text-input" aria-label="When" placeholder="Fri 7 PM" value={x.when} onChange={(e) => setGame(x.key, { when: e.target.value })} />
                    <input className="text-input" aria-label="Where" placeholder="Court 1" value={x.where} onChange={(e) => setGame(x.key, { where: e.target.value })} />
                    <button className="mini" aria-label="Remove game" onClick={() => setL({ games: games.filter((y) => y.key !== x.key) })}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn"
                disabled={named.length < 2}
                onClick={() =>
                  setL({
                    games: [
                      ...games,
                      { key: uid('g_'), away: named[(games.length * 2) % named.length].key, home: named[(games.length * 2 + 1) % named.length].key, when: '', where: '' },
                    ],
                  })
                }
              >
                <Icon name="plus" /> Add a game
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
