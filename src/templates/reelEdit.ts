/**
 * Changing a reel after it's built: the team name, colours, logos, look or music. The reel is
 * built again from its recorded input, before and after the change; wherever a clip still holds
 * what the first build gave it, it takes the new value, and whatever was edited by hand stays.
 */
import type { Asset, Clip, GraphicSpec, Project, ReelRecord } from '../model/types';
import { buildReel, type ReelInput } from './reel';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A clip's place in a build: its kind (and graphic type, or sound), counted in build order. */
function keysOf(clips: Clip[], assets: Record<string, Asset>): string[] {
  const seen = new Map<string, number>();
  return clips.map((c) => {
    const what = c.graphic ? `g:${c.graphic.type}` : c.kind === 'audio' ? `a:${assets[c.assetId ?? '']?.name ?? ''}`.replace(/\.[^.]+$/, '') : c.kind;
    const n = seen.get(what) ?? 0;
    seen.set(what, n + 1);
    return `${what}#${n}`;
  });
}

/** A graphic, field by field: the new build's value where it still had the old build's. */
function mergeGraphic(cur: GraphicSpec, was: GraphicSpec, now: GraphicSpec): GraphicSpec {
  const out: Record<string, unknown> = { ...cur };
  const c = cur as unknown as Record<string, unknown>;
  const w = was as unknown as Record<string, unknown>;
  const n = now as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(w), ...Object.keys(n)])) {
    if (k === 'text') continue;
    if (same(c[k], w[k])) out[k] = n[k];
  }
  const text: Record<string, string> = { ...cur.text };
  for (const k of new Set([...Object.keys(was.text), ...Object.keys(now.text)])) {
    if (cur.text[k] !== was.text[k]) continue;
    if (now.text[k] === undefined) delete text[k];
    else text[k] = now.text[k];
  }
  out.text = text;
  return out as unknown as GraphicSpec;
}

/** `cur` with the change from `was` to `now` wherever `cur` still matches `was`. */
function mergeClip(cur: Clip, was: Clip, now: Clip, assets: Record<string, Asset>): Clip {
  if (cur.kind !== was.kind || was.kind !== now.kind) return cur;
  const out: Clip = { ...cur };
  if (cur.graphic && was.graphic && now.graphic && was.graphic.type === now.graphic.type) out.graphic = mergeGraphic(cur.graphic, was.graphic, now.graphic);
  if (cur.name === was.name) out.name = now.name;
  if (cur.text && was.text && now.text && same(cur.text, was.text)) out.text = now.text;
  if (cur.spotlight && was.spotlight && now.spotlight) {
    out.spotlight = { ...cur.spotlight };
    if (cur.spotlight.color === was.spotlight.color) out.spotlight.color = now.spotlight.color;
    if (cur.spotlight.label === was.spotlight.label) out.spotlight.label = now.spotlight.label;
  }
  if (cur.follow && was.follow && now.follow) {
    out.follow = { ...cur.follow };
    if (cur.follow.color === was.follow.color) out.follow.color = now.follow.color;
    if (cur.follow.label === was.follow.label) out.follow.label = now.follow.label;
  }
  // A new song in place of the old one, where the old one still plays: the cuts stay put.
  if (cur.kind === 'audio' && cur.assetId === was.assetId && now.assetId !== was.assetId && now.assetId && assets[now.assetId]) {
    out.assetId = now.assetId;
    out.duration = Math.max(0.1, Math.min(cur.duration, assets[now.assetId].duration - cur.inPoint));
  }
  return out;
}

/** Each built clip's counterparts in a build of the old input and of the new, by the clip's id. */
function pairs(rec: ReelRecord, was: Project, now: Project, assets: Record<string, Asset>) {
  const wasKeys = keysOf(was.clips, assets);
  const nowByKey = new Map(keysOf(now.clips, assets).map((k, i) => [k, now.clips[i]]));
  const out = new Map<string, { was: Clip; now: Clip }>();
  rec.built.forEach((id, i) => {
    const n = was.clips[i] && nowByKey.get(wasKeys[i]);
    if (n) out.set(id, { was: was.clips[i], now: n });
  });
  return out;
}

export interface ReelChange {
  project: Project;
  /** Built clips whose counterpart the change does away with (the layout itself would change). */
  unmatched: number;
}

/** Applies a change of the reel's input to the timeline in place: titles, colours, logos and the song, keeping every edit. */
export function changeReel(current: Project, assets: Record<string, Asset>, next: ReelInput): ReelChange {
  const rec = current.reel!;
  const was = buildReel(rec.input, assets);
  const now = buildReel(next, assets);
  const nowMusic = next.cards.music ? now.clips.find((c) => c.kind === 'audio' && c.assetId === next.cards.music) : undefined;
  const wasMusic = rec.input.cards.music ? was.clips.find((c) => c.kind === 'audio' && c.assetId === rec.input.cards.music) : undefined;
  const map = pairs(rec, was, now, assets);
  // Sounds are known by name, which changes with the song: the old song pairs with the new.
  if (wasMusic && nowMusic) {
    const i = was.clips.indexOf(wasMusic);
    if (rec.built[i]) map.set(rec.built[i], { was: wasMusic, now: nowMusic });
  }
  let unmatched = 0;
  // No music now: the song the build laid down goes.
  const dropped = !next.cards.music && wasMusic ? rec.built[was.clips.indexOf(wasMusic)] : undefined;
  const clips = current.clips.filter((c) => c.id !== dropped).map((c) => {
    if (!rec.built.includes(c.id)) return c;
    const m = map.get(c.id);
    if (!m) {
      unmatched++;
      return c;
    }
    return mergeClip(c, m.was, m.now, assets);
  });
  return {
    project: { ...current, clips, name: current.name === was.name ? now.name : current.name, reel: { ...rec, input: next } },
    unmatched,
  };
}

/** The cuts are as the reel was built: nothing added, removed, moved or trimmed (titles may be edited). */
export function cutsUntouched(current: Project, assets: Record<string, Asset>): boolean {
  const rec = current.reel;
  if (!rec) return false;
  const was = buildReel(rec.input, assets);
  if (was.clips.length !== rec.built.length) return false;
  const byId = new Map(current.clips.map((c) => [c.id, c]));
  if (current.clips.some((c) => !rec.built.includes(c.id))) return false;
  return rec.built.every((id, i) => {
    const c = byId.get(id);
    const w = was.clips[i];
    if (!c) return false;
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
    return near(c.start, w.start) && near(c.duration, w.duration) && near(c.inPoint, w.inPoint) && near(c.speed, w.speed);
  });
}

/**
 * Builds the reel again from the new input (cut to a new song's beat, say), carrying over every
 * edit made to its clips: titles typed over, colours changed, tracking fixed.
 */
export function rebuildReel(current: Project, assets: Record<string, Asset>, next: ReelInput): Project {
  const rec = current.reel!;
  const was = buildReel(rec.input, assets);
  // Players followed (and fixed) since: the new build pans and marks with those paths.
  const followed = current.clips.filter((c) => c.kind === 'video' && c.follow?.path.length);
  next = {
    ...next,
    clips: next.clips.map((rc) => {
      const c = followed.find((x) => x.assetId === rc.assetId && Math.abs(x.inPoint - rc.inPoint) < 0.05);
      return c ? { ...rc, path: c.follow!.path } : rc;
    }),
  };
  const now = buildReel(next, assets);
  const wasKeys = keysOf(was.clips, assets);
  const nowKeys = keysOf(now.clips, assets);
  const byId = new Map(current.clips.map((c) => [c.id, c]));
  const fromKey = new Map<string, { cur: Clip; was: Clip }>();
  rec.built.forEach((id, i) => {
    const c = byId.get(id);
    if (c && was.clips[i]) fromKey.set(wasKeys[i], { cur: c, was: was.clips[i] });
  });
  const clips = now.clips.map((n, i) => {
    const m = fromKey.get(nowKeys[i]);
    if (!m || n.kind === 'audio') return n;
    // The new clip, with every edit the old one had over its own build.
    const merged = mergeClip({ ...n, graphic: m.cur.graphic ?? n.graphic, name: m.cur.name, text: m.cur.text, spotlight: m.cur.spotlight && n.spotlight ? { ...n.spotlight, color: m.cur.spotlight.color, label: m.cur.spotlight.label } : n.spotlight }, m.was, n, assets);
    if (m.cur.follow?.fixes?.length && merged.follow) merged.follow = { ...merged.follow, fixes: m.cur.follow.fixes };
    return merged;
  });
  return {
    ...now,
    id: current.id,
    createdAt: current.createdAt,
    name: current.name === was.name ? now.name : current.name,
    // Your own settings stay, unless another template brings its own frame.
    settings: next.style === rec.input.style ? current.settings : now.settings,
    matches: current.matches,
    playlists: current.playlists,
    clips,
    reel: { ...rec, input: next, built: now.clips.map((c) => c.id) },
  };
}
