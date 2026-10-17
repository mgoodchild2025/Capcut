/** Everything that changes between sports: positions, play labels, default stats and how a game is scored. */
export interface Sport {
  id: SportId;
  name: string;
  positions: string[];
  plays: string[];
  stats: string[];
  scoring: {
    /** Volleyball (and tennis-like) games are won on sets; everything else on total points. */
    result: 'sets' | 'points';
    /** What a period is called, in full and on the score bug. */
    period: string;
    short: string;
    /** Usual number of periods, for the score entry. */
    count: number;
    /** What the points are called on the final board. */
    unit: string;
  };
}

export type SportId = 'volleyball' | 'basketball' | 'soccer' | 'football' | 'baseball' | 'softball' | 'hockey' | 'lacrosse';

export const SPORTS: Sport[] = [
  {
    id: 'volleyball',
    name: 'Volleyball',
    positions: ['Outside Hitter', 'Opposite', 'Middle Blocker', 'Setter', 'Libero', 'Defensive Specialist', 'Right Side'],
    plays: ['Kill', 'Ace', 'Block', 'Dig', 'Set', 'Serve receive', 'Save'],
    stats: ['Kills', 'Aces', 'Blocks', 'Digs'],
    scoring: { result: 'sets', period: 'Set', short: 'SET', count: 3, unit: 'points' },
  },
  {
    id: 'basketball',
    name: 'Basketball',
    positions: ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center', 'Guard', 'Forward'],
    plays: ['Three', 'Dunk', 'Layup', 'Block', 'Steal', 'Assist', 'And-one', 'Buzzer beater'],
    stats: ['Points', 'Rebounds', 'Assists', 'Steals'],
    scoring: { result: 'points', period: 'Quarter', short: 'QTR', count: 4, unit: 'points' },
  },
  {
    id: 'soccer',
    name: 'Soccer',
    positions: ['Forward', 'Striker', 'Winger', 'Midfielder', 'Defender', 'Fullback', 'Goalkeeper'],
    plays: ['Goal', 'Assist', 'Save', 'Tackle', 'Free kick', 'Penalty', 'Header'],
    stats: ['Goals', 'Assists', 'Shots', 'Saves'],
    scoring: { result: 'points', period: 'Half', short: 'HALF', count: 2, unit: 'goals' },
  },
  {
    id: 'football',
    name: 'Football',
    positions: ['Quarterback', 'Running Back', 'Wide Receiver', 'Tight End', 'Linebacker', 'Cornerback', 'Safety', 'Defensive Line', 'Offensive Line', 'Kicker'],
    plays: ['Touchdown', 'Pass', 'Catch', 'Run', 'Sack', 'Interception', 'Tackle', 'Field goal'],
    stats: ['Yards', 'Touchdowns', 'Tackles', 'Interceptions'],
    scoring: { result: 'points', period: 'Quarter', short: 'QTR', count: 4, unit: 'points' },
  },
  {
    id: 'baseball',
    name: 'Baseball',
    positions: ['Pitcher', 'Catcher', 'First Base', 'Second Base', 'Shortstop', 'Third Base', 'Left Field', 'Center Field', 'Right Field', 'Designated Hitter'],
    plays: ['Home run', 'Hit', 'Double', 'Strikeout', 'Catch', 'Double play', 'Stolen base', 'RBI'],
    stats: ['Batting avg', 'Home runs', 'RBI', 'Strikeouts'],
    scoring: { result: 'points', period: 'Inning', short: 'INN', count: 9, unit: 'runs' },
  },
  {
    id: 'softball',
    name: 'Softball',
    positions: ['Pitcher', 'Catcher', 'First Base', 'Second Base', 'Shortstop', 'Third Base', 'Left Field', 'Center Field', 'Right Field', 'Designated Player'],
    plays: ['Home run', 'Hit', 'Double', 'Strikeout', 'Catch', 'Double play', 'Stolen base', 'RBI'],
    stats: ['Batting avg', 'Home runs', 'RBI', 'Strikeouts'],
    scoring: { result: 'points', period: 'Inning', short: 'INN', count: 7, unit: 'runs' },
  },
  {
    id: 'hockey',
    name: 'Hockey',
    positions: ['Center', 'Left Wing', 'Right Wing', 'Defense', 'Goalie'],
    plays: ['Goal', 'Assist', 'Save', 'Hit', 'Breakaway', 'Power play', 'Shootout'],
    stats: ['Goals', 'Assists', 'Points', 'Saves'],
    scoring: { result: 'points', period: 'Period', short: 'PER', count: 3, unit: 'goals' },
  },
  {
    id: 'lacrosse',
    name: 'Lacrosse',
    positions: ['Attack', 'Midfield', 'Defense', 'Goalie', 'Face-off', 'Long Stick Midfield'],
    plays: ['Goal', 'Assist', 'Save', 'Ground ball', 'Caused turnover', 'Face-off win'],
    stats: ['Goals', 'Assists', 'Ground balls', 'Saves'],
    scoring: { result: 'points', period: 'Quarter', short: 'QTR', count: 4, unit: 'goals' },
  },
];

export const sportOf = (id?: string): Sport => SPORTS.find((s) => s.id === id) ?? SPORTS[0];

/** Who won and by what: sets won for set-based sports, totals otherwise. */
export function finalTotals(sport: Sport, periods: [number, number][]): [number, number] {
  if (sport.scoring.result === 'sets') {
    const won = periods.filter(([a, b]) => a > b).length;
    return [won, periods.filter(([a, b]) => b > a).length];
  }
  return periods.reduce<[number, number]>(([x, y], [a, b]) => [x + a, y + b], [0, 0]);
}
