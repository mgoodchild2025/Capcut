import { describe, expect, it } from 'vitest';
import { POSTER_KINDS, posterFileName, posterSpec } from './posters';
import type { ReelInfo } from './reel';

const info: ReelInfo = {
  name: 'Rockets',
  team: 'Rockets',
  number: '12',
  position: 'Outside Hitter',
  gradYear: '2027',
  height: '',
  club: 'Rockets 17 Elite',
  school: 'Lincoln High',
  email: '',
  phone: '',
  season: '2026',
  record: '24-6',
  oppRecord: '19-9',
  colors: ['#1d4ed8', '#fbbf24'],
  stats: [
    ['Kills', '245'],
    ['Aces', ''],
  ],
  headline: 'Player of the Game',
  opponent: 'Westside Storm',
  venue: 'Fri 7 PM',
  roster: [
    { key: 'a', number: '12', name: 'Jordan Lee', position: 'Outside Hitter', starter: true },
    { key: 'b', number: '4', name: 'Sam Rivera', position: 'Setter', starter: false },
  ],
  sets: [
    ['25', '21'],
    ['23', '25'],
    ['25', '19'],
  ],
  award: 'Play of the Week',
  week: 'Week 7',
  college: 'State University',
};

describe('posters', () => {
  it('has a graphic for every kind', () => {
    const types = Object.fromEntries(POSTER_KINDS.map((k) => [k.id, posterSpec(k.id, info, { logo: true, opp: true, photo: true, college: true }).type]));
    expect(types).toEqual({ gameday: 'versus', final: 'final', victory: 'victory', player: 'playerCard', award: 'potw', commit: 'commit', stats: 'stats', lineup: 'roster' });
  });

  it('fills each one from the details', () => {
    const g = posterSpec('gameday', info, { logo: true, opp: true });
    expect(g).toMatchObject({ logo: 'logo', oppLogo: 'opp', text: { usName: 'ROCKETS', themName: 'WESTSIDE STORM', usSub: '24-6', themSub: '19-9', sub: 'Fri 7 PM  ·  Rockets 17 Elite' } });
    expect(g.oppColors).toBeDefined();
    expect(posterSpec('final', info, {})).toMatchObject({ sets: [[25, 21], [23, 25], [25, 19]], text: { result: 'ROCKETS win 2-1' } });
    expect(posterSpec('victory', info, {}).text).toMatchObject({ title: 'VICTORY', score: '2-1' });
    expect(posterSpec('commit', { ...info, name: 'Jordan Lee' }, { photo: true, college: true, cutout: true })).toMatchObject({
      oppLogo: 'college',
      cutout: true,
      media: 'image',
      text: { first: 'Jordan', last: 'Lee', college: 'State University', detail: '#12  ·  Outside Hitter  ·  Class of 2027  ·  Rockets' },
    });
    expect(posterSpec('player', { ...info, name: 'Jordan Lee' }, {}).text).toMatchObject({ kicker: 'PLAYER OF THE GAME', detail: 'Rockets  ·  Lincoln High' });
    expect(posterSpec('stats', info, {}).rows).toEqual([['Kills', '245']]);
    expect(posterSpec('lineup', info, {}).players).toEqual([{ number: '12', name: 'Jordan Lee' }]);
  });

  it('works with no logos or photo', () => {
    for (const k of POSTER_KINDS) {
      const g = posterSpec(k.id, { ...info, sets: [], stats: [] }, {});
      expect(g.logo, k.id).toBeUndefined();
      expect(g.media, k.id).toBeUndefined();
    }
  });

  it('keeps the team and the player apart', () => {
    const both = { ...info, name: 'Jordan Lee', team: 'Rockets 17 Elite' };
    expect(posterSpec('gameday', both, {}).text.usName).toBe('ROCKETS 17 ELITE');
    expect(posterSpec('award', both, {}).text.name).toBe('JORDAN LEE');
    // Without a team typed for posters, the club from a player reel stands in.
    expect(posterSpec('final', { ...info, team: undefined, name: 'Jordan Lee', club: 'Rockets 17 Elite' }, {}).text.usName).toBe('ROCKETS 17 ELITE');
  });

  it('names files after who and what', () => {
    expect(posterFileName('final', 'story', info)).toBe('rockets-final-score-story.png');
    expect(posterFileName('commit', 'post', { ...info, name: 'Jordan Lee' })).toBe('jordan-lee-commitment-post.png');
  });
});
