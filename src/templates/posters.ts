/**
 * Still graphics for social posts: the broadcast package's titles and boards, captured once
 * they've finished building, at the sizes Instagram, TikTok and X want.
 */
import type { GraphicSpec, MatchData } from '../model/types';
import { finalScore, gameLeaders, pct3, scoreMatch, volleyStats } from '../stats/matchStats';
import { opponentColors, titleGraphic } from './broadcast';
import { playedSets, sides } from './match';
import type { ReelInfo } from './reel';
import { upper } from './shared';
import { finalTotals, sportOf } from './sports';

export type PosterKind = 'gameday' | 'final' | 'victory' | 'player' | 'award' | 'commit' | 'stats' | 'lineup';

/** What a poster asks for, beyond the team's colours and logo. */
export type PosterField = 'opponent' | 'venue' | 'records' | 'sets' | 'player' | 'photo' | 'headline' | 'award' | 'college' | 'stats' | 'roster';

export const POSTER_KINDS: { id: PosterKind; title: string; blurb: string; subject: 'team' | 'player'; fields: PosterField[] }[] = [
  { id: 'gameday', title: 'Game day', blurb: 'Both teams, split screen, with when and where.', subject: 'team', fields: ['opponent', 'venue', 'records'] },
  { id: 'final', title: 'Final score', blurb: 'The scoreboard with every set or period.', subject: 'team', fields: ['opponent', 'sets'] },
  { id: 'victory', title: 'Victory', blurb: 'The win, with the score and confetti.', subject: 'team', fields: ['opponent', 'sets'] },
  { id: 'player', title: 'Player spotlight', blurb: 'Player of the Game, Senior Night, MVP: photo, number and name.', subject: 'player', fields: ['player', 'photo', 'headline'] },
  { id: 'award', title: 'Play of the Week', blurb: 'The award emblem with the player and the week.', subject: 'player', fields: ['player', 'award'] },
  { id: 'commit', title: 'Commitment', blurb: 'Announce a college commitment, with the college logo.', subject: 'player', fields: ['player', 'photo', 'college'] },
  { id: 'stats', title: 'Stats', blurb: 'A stats board for a player or the team.', subject: 'team', fields: ['stats'] },
  { id: 'lineup', title: 'Starting lineup', blurb: 'The starters on one board, for game day.', subject: 'team', fields: ['opponent', 'roster'] },
];

export type PosterFormat = 'story' | 'post' | 'wide';
export const POSTER_FORMATS: { id: PosterFormat; label: string; hint: string; size: [number, number] }[] = [
  { id: 'story', label: 'Story', hint: '9:16 for Stories, Reels and TikTok', size: [1080, 1920] },
  { id: 'post', label: 'Post', hint: '4:5 for the Instagram feed', size: [1080, 1350] },
  { id: 'wide', label: 'Wide', hint: '16:9 for X, Facebook and websites', size: [1920, 1080] },
];

/** A graphic is captured well after it has built and long before it leaves. */
export const POSTER_DURATION = 10;
export const POSTER_AT = 4.2;

/** Image ids the specs refer to; the caller supplies the images. */
export const POSTER_IMAGES = { logo: 'logo', opp: 'opp', photo: 'photo', college: 'college' } as const;

const splitName = (name: string): [string, string] => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? [parts.slice(0, -1).join(' '), parts[parts.length - 1]] : ['', parts[0] ?? ''];
};

/** The team's name: as typed for posters, or the club a player reel was made for. */
export const teamOf = (info: ReelInfo) => info.team?.trim() || info.club.trim();

/** The graphic for a poster, in words and ids (`has` says which images there are). */
export function posterSpec(kind: PosterKind, raw: ReelInfo, has: { logo?: boolean; opp?: boolean; photo?: boolean; college?: boolean; cutout?: boolean }): GraphicSpec {
  const team = teamOf(raw);
  // Team posters are about the team; player posters keep the player's name and use the team as their club line.
  const info: ReelInfo = POSTER_KINDS.find((k) => k.id === kind)!.subject === 'team' ? { ...raw, name: team || raw.name } : { ...raw, club: team };
  const base = { colors: info.colors, look: info.look, logo: has.logo ? POSTER_IMAGES.logo : undefined };
  const opp = has.opp ? POSTER_IMAGES.opp : undefined;
  const name = info.name.trim();
  const num = info.number.trim().replace('#', '');
  const [first, last] = splitName(name || 'Player Name');
  const sport = sportOf(info.sport);
  const input = { style: 'team' as const, info, clips: [], cards: {} };
  switch (kind) {
    case 'gameday': {
      const g = titleGraphic('matchup', info);
      return { ...base, type: 'versus', text: g.text, oppLogo: opp, oppColors: opponentColors(info) };
    }
    case 'victory': {
      const g = titleGraphic('victory', info);
      return { ...base, type: 'victory', text: g.text, oppLogo: opp };
    }
    case 'final': {
      const sets = playedSets(info);
      const [usName, themName] = sides(input, true);
      const [ours, theirs] = finalTotals(sport, sets);
      const result = !sets.length ? '' : ours > theirs ? `${usName} win ${ours}-${theirs}` : ours < theirs ? `${themName} win ${theirs}-${ours}` : `Tied ${ours}-${theirs}`;
      return {
        ...base,
        type: 'final',
        oppLogo: opp,
        sets,
        scoring: sport.scoring.result,
        text: { usName, themName, result, periodPrefix: sport.scoring.result === 'sets' ? 'S' : sport.scoring.short === 'INN' ? '' : sport.scoring.short[0], periodLabel: sport.scoring.short },
      };
    }
    case 'player':
      return {
        ...base,
        type: 'playerCard',
        cutout: !!has.photo && !!has.cutout,
        media: has.photo ? 'image' : undefined,
        text: { kicker: upper(info.headline || ''), number: num, first, last, position: info.position, detail: [info.club, info.school].filter(Boolean).join('  ·  ') },
      };
    case 'award': {
      const g = titleGraphic('potw', info);
      return { ...base, type: 'potw', text: g.text };
    }
    case 'commit':
      return {
        ...base,
        type: 'commit',
        oppLogo: has.college ? POSTER_IMAGES.college : undefined,
        cutout: !!has.photo && !!has.cutout,
        media: has.photo ? 'image' : undefined,
        text: {
          title: 'Committed',
          first,
          last,
          detail: [num && `#${num}`, info.position, info.gradYear && `Class of ${info.gradYear}`, info.club || info.school].filter(Boolean).join('  ·  '),
          college: info.college?.trim() ?? '',
        },
      };
    case 'stats': {
      const rows = info.stats.filter(([k, v]) => k.trim() && v.trim());
      return { ...base, type: 'stats', rows, text: { title: info.statsTitle?.trim() || 'Season stats', sub: [name, info.season].filter(Boolean).join(' · ') } };
    }
    case 'lineup': {
      const starters = info.roster.filter((r) => r.starter && (r.name.trim() || r.number.trim()));
      return {
        ...base,
        type: 'roster',
        players: starters.map((r) => ({ number: r.number.replace('#', ''), name: r.name })),
        text: { title: 'Starting lineup', sub: [upper(name), info.opponent.trim() && `vs ${upper(info.opponent)}`].filter(Boolean).join('  ') },
      };
    }
  }
}

/** A file name for a poster: "rockets-final-score-story.png". */
export function posterFileName(kind: PosterKind, format: PosterFormat, info: ReelInfo): string {
  const who = (POSTER_KINDS.find((k) => k.id === kind)!.subject === 'player' ? info.name : teamOf(info) || info.name).trim() || 'poster';
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(who)}-${slug(POSTER_KINDS.find((k) => k.id === kind)!.title)}-${format}.png`;
}

/** The one-image game summary for families: final score, set by set, and the team's leaders. */
export function summarySpec(m: MatchData, volley: boolean, info: ReelInfo, has: { logo?: boolean; opp?: boolean }, sub = ''): GraphicSpec {
  const usName = m.us?.trim() || teamOf(info) || 'Us';
  const themName = m.them?.trim() || info.opponent?.trim() || 'Them';
  const fs = finalScore(scoreMatch(m, volley), volley);
  const result = fs.partial ? '' : fs.us > fs.them ? `${usName} win` : fs.us < fs.them ? `${themName} win` : '';
  const leaders = gameLeaders(m, volley);
  const who = new Map((m.players ?? []).map((p) => [p.key, p]));
  let footer = '';
  if (volley) {
    const st = volleyStats(m);
    const pct = ([w, n]: [number, number]) => (n ? `${Math.round((w / n) * 100)}%` : '');
    const n = (v: number, one: string) => `${v} ${one}${v === 1 ? '' : 's'}`;
    footer = [st.team.attempts && `Hitting ${pct3(st.team.hitting)}`, n(st.team.aces, 'ace'), n(st.team.digs, 'dig'), pct(st.sideout) && `Sideout ${pct(st.sideout)}`].filter(Boolean).join('   ·   ');
  }
  return {
    type: 'summary',
    colors: info.colors,
    look: info.look,
    logo: has.logo ? POSTER_IMAGES.logo : undefined,
    oppLogo: has.opp ? POSTER_IMAGES.opp : undefined,
    sets: fs.sets,
    rows: leaders.map((l) => [l.label, l.value]),
    players: leaders.map((l) => {
      const p = who.get(l.player);
      return { number: p?.number.replace('#', '') ?? '', name: p?.name ?? l.player };
    }),
    text: { usName, themName, usScore: String(fs.us), themScore: String(fs.them), result, sub, footer, kicker: fs.partial ? 'Game summary' : 'Final' },
  };
}
