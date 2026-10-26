import { useState } from 'react';
import type { GraphicLook } from '../model/types';
import { blankLeague, DEFAULT_TAGLINE, isLeagueStyle } from '../templates/league';
import { TEAM_COLORS, type LeagueDetails, type LeagueTeam, type ReelInfo, type ReelStyle } from '../templates/reel';
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
  const teamsMatter = style !== 'signup';
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
      <h3 className="wiz-title">The league</h3>
      <div className="player-form">
        {field('League name', info.name, (name) => setInfo((i) => ({ ...i, name })), 'Metro Volleyball League', true)}
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
        <LogoDrop value={info.logo} onChange={(logo) => setInfo((i) => ({ ...i, logo }))} label="league logo" />
        <small className="muted">The league's logo lands on the sign-off and over the teams. A PNG with a transparent background looks best.</small>
      </div>
      <ColorPairs value={info.colors} onChange={(colors) => setInfo((i) => ({ ...i, colors }))} label="League" />

      <h3 className="wiz-title">What it says</h3>
      <div className="player-form">
        {field('Slogan', L.tagline, (tagline) => setL({ tagline }), isLeagueStyle(style) ? DEFAULT_TAGLINE[style] : '', true)}
        <small className="league-hint span2">Short sentences: each one slams in on its own beat.</small>
        {style === 'signup' ? (
          <>
            {field('Divisions', L.divisions ?? '', (divisions) => setL({ divisions }), 'U14 · U16 · U18 · Open', true)}
            {field('Season dates', L.when, (when) => setL({ when }), 'Jan 10 to Apr 4')}
            {field('Fee', L.fee ?? '', (fee) => setL({ fee }), '$250 per player')}
            {field('Register by', L.deadline ?? '', (deadline) => setL({ deadline }), 'Dec 15')}
          </>
        ) : (
          <>
            {field(style === 'gamenight' ? 'When' : style === 'playoffs' ? 'Playoffs start' : 'Opening night', L.when, (when) => setL({ when }), 'Sat Jan 10 · 7 PM')}
            {field('Where to be or watch', L.where, (where) => setL({ where }), 'Metro Arena · Live on YouTube')}
          </>
        )}
        {field(style === 'signup' ? 'Sign-up page (for the QR code)' : 'Website', L.url, (url) => setL({ url }), style === 'signup' ? 'https://metrovl.ca/register' : 'metrovl.ca')}
        {field('Presented by', L.sponsor, (sponsor) => setL({ sponsor }), 'Sponsor (optional)')}
      </div>

      {teamsMatter && (
        <>
          <h3 className="wiz-title">Teams</h3>
          <p className="wiz-lede">
            {style === 'playoffs'
              ? 'In seed order, first seed at the top (up to eight make the bracket).'
              : style === 'gamenight'
                ? "Add the league's teams, then pick tonight's two."
                : 'Every team in the league, for the logo wall.'}
          </p>
          <div className="league-teams">
            {L.teams.map((t, i) => (
              <div key={t.key} className="league-team">
                {style === 'playoffs' && <b className="seed">{i + 1}</b>}
                <LogoDrop value={t.logo} onChange={(logo) => setTeam(t.key, { logo })} label={`${t.name || 'team'} logo`} />
                <input className="text-input" aria-label="Team name" value={t.name} placeholder="Team name" onChange={(e) => setTeam(t.key, { name: e.target.value })} />
                <input type="color" aria-label={`${t.name} main colour`} value={t.colors[0]} onChange={(e) => setTeam(t.key, { colors: [e.target.value, t.colors[1]] })} />
                <input type="color" aria-label={`${t.name} accent colour`} value={t.colors[1]} onChange={(e) => setTeam(t.key, { colors: [t.colors[0], e.target.value] })} />
                {style === 'gamenight' && (
                  <input
                    className="text-input record"
                    aria-label={`${t.name} record`}
                    value={t.record ?? ''}
                    placeholder="8-2"
                    onChange={(e) => setTeam(t.key, { record: e.target.value })}
                  />
                )}
                {style === 'playoffs' && (
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
          {style === 'gamenight' && L.teams.length >= 2 && (
            <div className="player-form">
              <label className="wiz-field">
                <span>Visitors</span>
                <select value={L.away ?? L.teams[0].key} onChange={(e) => setL({ away: e.target.value })}>
                  {L.teams.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name || 'Team'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wiz-field">
                <span>Home</span>
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
        </>
      )}
    </section>
  );
}
