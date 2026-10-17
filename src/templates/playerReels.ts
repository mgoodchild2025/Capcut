import type { ReelClip, ReelInput, ReelStyle, RosterPlayer } from './reel';

/** "Kill" -> "Kills", "Catch" -> "Catches"; initialisms ("RBI") and phrases ending in s stay as they are. */
export function plural(tag: string): string {
  if (/^[A-Z0-9]+$/.test(tag) || /s$/i.test(tag)) return tag;
  if (/(sh|ch|x|z)$/i.test(tag)) return `${tag}es`;
  return `${tag}s`;
}

/** Stat rows from a player's labelled plays, most frequent first: [["Kills", "3"], ["Aces", "1"]]. */
export function statsFromPlays(clips: ReelClip[]): [string, string][] {
  const counts = new Map<string, number>();
  for (const c of clips) if (c.tag) counts.set(c.tag, (counts.get(c.tag) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tag, n]) => [plural(tag), String(n)]);
}

/**
 * One reel per player from a team reel: each player who made at least one of the plays gets
 * their own reel in `style`, with their plays, their photo, their stats from the plays' labels,
 * and the team's colours, logos and score.
 */
export function playerReelInputs(team: ReelInput, style: ReelStyle): { player: RosterPlayer; input: ReelInput }[] {
  const { info } = team;
  const out: { player: RosterPlayer; input: ReelInput }[] = [];
  for (const player of info.roster) {
    if (!player.name.trim() && !player.number.trim()) continue;
    const clips = team.clips.filter((c) => c.player === player.key).map((c) => ({ ...c, player: undefined }));
    if (!clips.length) continue;
    const photo = team.cards.players?.[player.key];
    const stats = statsFromPlays(clips);
    out.push({
      player,
      input: {
        style,
        clips,
        info: {
          ...info,
          name: player.name.trim() || `#${player.number.replace('#', '')}`,
          number: player.number,
          position: player.position,
          // The team becomes the player's club line.
          club: info.name,
          headline: info.opponent.trim() ? `vs ${info.opponent.trim()}` : 'Game highlights',
          stats,
          statsTitle: info.opponent.trim() ? `vs ${info.opponent.trim()}` : 'This game',
          roster: [],
          photo,
          photoCutout: player.cutout,
        },
        cards: { ...team.cards, photo, players: {} },
      },
    });
  }
  return out;
}
