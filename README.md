# ClipForge

A CapCut-style video editor that runs entirely in the browser, with a built-in workflow for sports highlight reels (volleyball, basketball, soccer, football, baseball, softball, hockey and lacrosse). Media never leaves your machine: files are decoded, composited and exported locally, and drafts are kept in IndexedDB.

**Live app:** https://mgoodchild2025.github.io/Capcut/ (published by `.github/workflows/deploy-pages.yml`)

## Sports highlight reels

Every reel is built from a **broadcast graphics package** in your team colours, drawn as motion graphics frame by frame (the preview and the export draw the same frames):

- **Title open**: logo slam with a shockwave, masked title reveal, kicker plate and light sweep. The starting lineup opens **versus**, with both logos.
- **Player card**: the player's photo (a **living photo**: an on-device depth model splits it into layers and a virtual camera moves through them for 3D parallax), a cut-out (background removed) with a rim glow, or a short clip in an angled window, with a giant number, stacked name and position plate.
- **Player ID lower third**: number block, name bar and the play (Kill, Ace...), built out in sequence.
- **Score bug**: both teams' logos, scores and the set, quarter, half, inning or period.
- **Boards**: stats with count-up numbers, a roster wall of player tiles with photos, and a final scoreboard with every set or period (sets won for volleyball, total points, goals or runs elsewhere).
- **Stingers** in team colours cover section changes, and a **closer** with a logo lockup ends the reel.
- **Instant replay**: switch on **Replay** for a play and its decisive moment runs again at half speed behind a REPLAY wipe, with a corner bug. When your player is spotted, the replay opens on a freeze where the **telestrator** circles them and draws an arrow in, like a TV analyst.
- **Versus title**: the frame split on a diagonal, each team in its own colours with its logo (or a monogram crest), name and record, and VS slamming in where they meet.
- **Victory title**: VICTORY lands over light rays with a jolt and a flash, the final score sits between both logos, and confetti falls.
- **Award package**: an emblem with lettering round its ring and a star landing in the middle, the award word huge (Play of the **Week**), the week and the player, plus a corner badge that rides over the play and its replays.
- **Four graphics looks**: **Broadcast** (bold TV package), **Championship** (brushed gold, spotlights and sparks), **Neon** (glow and a racing grid) and **Classic** (clean and understated). Switch every graphic at once from the graphic inspector.

1. On the home screen, pick a sport, a look and a template. You can also open the **Sports** tab in the editor.

   | Template | Format | For |
   | --- | --- | --- |
   | Recruiting reel | 16:9 | College coaches: open, profile card, plays with player IDs, stats, contact details |
   | Hype reel | 9:16 | TikTok and Reels: beat-synced cuts, slow motion, stingers |
   | Player spotlight | 4:5 | Feed posts like Player of the Game or Senior Night |
   | Play of the Week | 9:16 | One play: award title, the play at full speed, then slow-motion replays of every angle (the first with the analyst's pen, a lone angle also in super slow-mo), then the player |
   | Team reel | 9:16 | The team account: roster wall, each play credited to a player, team stats |
   | Victory reel | 9:16 | After a win: the score slams in under confetti and the crowd, beat-cut plays credited to players, game stats, final score, a celebration send-off |
   | Starting lineup | 9:16 | Pre-game hype: a player card per starter with their photo, cut-out or clip |
   | Matchup lineup | 9:16 | Game day with both teams: a versus title, the visitors' starters in their colours with their logo, then yours, and a face-off (First serve, Tip-off, Kick-off...) |
   | Season recap | 16:9 | Team montage with stats, final score and a send-off |

2. Enter the player or team details, pick team colours and add your **team and opponent logos** (remembered for next time). Player reels take a **photo or short clip** of the player; turn on **Cut out** to remove a photo's background. Optionally enter the **match score**: set scores add the final scoreboard, and a score per play shows the score bug.
3. Team reels and the lineups have a **Roster** step; the matchup lineup has a second one for the opponent (pick their colours on the team step). Paste a list (one player per line, like `12 Jordan Lee, Outside`) or add players one by one, with a photo or clip for each.
4. Import game footage and press **Find highlights**. On-device analysis listens for referee whistles, measures how much louder the crowd gets after each point than during the rally, and tracks on-court motion. Pick plays, label them with the sport's plays (Kill, Three, Goal, Home run...) and credit them to players.
5. Vertical and 4:5 reels **auto-follow the action**, panning wide game footage to keep the play in frame. Tap your player in a play to place a **spotlight** instead: the reel freezes, dims the surroundings and rings them, then **follows them through the play**. An on-device tracker (template matching on small colour frames, run forwards and backwards from your tap) keeps a marker with their number above them, and narrower reels pan with them.
6. Choose a studio-recorded music track (each style recommends one), or **your own song** from your device (beat-cut reels find its beats and cut on them), and press **Build my reel**. Select any graphic in the editor to change its words and colours.
7. **A reel for every player**: a team reel can also make one reel per player credited with a play, as a hype reel, player spotlight or recruiting reel. Each gets their plays, their photo and a stats board counted from the play labels (2 Kills, 1 Ace), and is saved to your drafts. The drafts share the stored game video rather than copying it; the media is freed when the last draft using it is deleted.

In the editor, the **Sports** tab has the **analyst's pen**: **Freeze and draw** freezes the frame at the playhead and adds a telestrator; **Draw over video** draws on the moving picture. Pick circle, arrow, line or freehand and a colour from the bar under the preview; marks draw themselves in one after another on playback. A clip with a spotlight can also **Follow this player** from its spotlight panel. Tracking follows the player relative to the court (it allows for the camera panning) and keeps track of teammates in the same kit, so a crossing or a run past a teammate doesn't send the marker to the wrong player. If it ever does, pause where it goes astray, tap **Fix the tracking here** and tap the right player; each fix holds the tracking to them at that moment, and **Clear fixes** undoes them.

## Editor features

- **Projects and drafts**:
  - Canvases in 16:9, 9:16, 1:1, 4:5, 4:3 and 21:9.
  - Autosave to drafts.
  - Works on desktop and phones: touch layout with bottom sheets, pinch-zoom timeline, and pinch or twist on the preview.
- **Timeline**:
  - Magnetic main track, plus overlay, text and audio tracks.
  - Drag between tracks, trim, split, duplicate and ripple delete.
  - Snapping to edges, the playhead and markers.
  - Mute, hide and lock per track.
- **Clip tools**:
  - Keyframes for position, scale, rotation, opacity and volume.
  - Speed from 0.25x to 10x, and speed curves (Montage, Hero, Bullet, Flash in/out, Jump cut).
  - Crop and flip.
  - Freeze frame, reverse, extract audio, replace media, and copy/paste style.
- **Look**:
  - 14 filters, plus brightness, contrast, saturation, hue, blur and vignette.
  - Chroma key (green screen) with an eyedropper.
  - AI background removal for photos and freeze frames.
- **Motion**:
  - In and out animations.
  - Transitions: dissolve, dip to black, push, wipe, zoom, blur and flash. Both clips keep playing during a transition, with an audio crossfade.
- **Text**: templates, fonts, stroke, background and shadow, plus emoji stickers.
- **Automatic captions**: on-device Whisper, in Classic, Boxed, Karaoke or Pop styles with word highlighting.
- **Audio**:
  - Seventeen studio-recorded music tracks (electronic, rock, cinematic, hip-hop and funk, with a style filter) and recorded sound effects (whoosh, slam, crowd cheer, hit, boom, swish), all public domain (CC0), plus five generated tracks and twelve generated effects. Reels add the crowd under the final score, and start the song on a beat so every cut lands on the music.
  - Voiceover recording and AI text-to-speech.
  - Beat detection with bar markers, and **Sync cuts to the beat**.
- **Export**: 480p to 4K, 24 to 60 fps, MP4. Frame by frame with WebCodecs, usually faster than real time and fine in a background tab. Falls back to real-time recording where WebCodecs is missing. On phones, **Save to Photos** / **Share** hands the video to the share sheet.
- **Move projects between devices**: the share icon on a draft saves it as one `.clipforge` file with all its media (AirDrop or Files on iPhone). **Open a project file** on the home screen loads it on another device.
- **Install as an app**: Add to Home Screen (on iPhone: Share, then Add to Home Screen) for a full-screen app that also works offline.

## AI that runs on your device

| Feature | How |
| --- | --- |
| Highlight finder | Signal analysis of audio (whistle tones, crowd level) and video motion. No download. |
| Player tracking | Colour template matching from your tap, forwards and backwards, smoothed with a local line fit. No download. |
| Beat detection | Onset envelope plus tempo and phase grid search. No download. |
| Auto-follow reframing | Motion tracking on tiny frames, smoothed into a camera path. No download. |
| Captions | Whisper base (Transformers.js, WebGPU or WASM). Downloads about 80 to 150 MB on first use. |
| Living photos | Depth Anything V2 small (Transformers.js). Downloads about 25 MB on first use; falls back to an estimated depth map. |
| Background removal | MODNet (Transformers.js). Downloads about 25 MB on first use. |
| Text to speech | Supertonic or MMS-TTS (Transformers.js). Downloads a voice model on first use. |

Models are fetched from Hugging Face once and then cached by the browser. Nothing you edit is uploaded.

## Keyboard shortcuts

Press **?** in the editor for the full list. The most useful ones: Space (play), S (split), Delete, Ctrl/Cmd+Z (undo), M (marker), N (snapping), and arrow keys (frame step).

## Development

```bash
npm install      # install scripts are skipped via .npmrc (Node-only native deps aren't needed)
npm run dev      # http://localhost:5173
npm test         # unit tests (timeline, timing, beats, highlights, captions, reels, export planning)
npm run build    # type-check and production build into dist/
```

Use a recent Chrome or Edge for the widest codec support. Firefox and Safari work, with fewer export codecs.

**iPhone videos (HEVC `.mov`)** import in any browser. When the browser can play the clip, it is used as is. When it can't, ClipForge converts a copy on import, showing progress with a Cancel button: first with hardware decoding through WebCodecs, otherwise with ffmpeg compiled to WebAssembly (`@ffmpeg/core`, served from the app itself and loaded only when needed). The converted copy is what gets saved with the draft, so a clip is only converted once.

**Playback on phones** shows the main video directly instead of copying each frame onto the canvas. The video leads and the timeline clock follows it. Pieces of the same file share one video element, so a plain cut plays straight through without a seek or a restart; a jump cut is pre-rolled on one spare element. Panels that follow the playhead update a few times a second during playback rather than every frame. Transitions stay on the direct path too: both videos are shown by the page, stacked, with the transition's motion, fade and blur applied as CSS. While playing, phones draw graphics without soft shadows or light sweeps and the overlay canvas at 1x (full quality when paused, and always in exports), and timeline thumbnails and waveforms wait until playback pauses. On phones, real time is the master clock: the picture is kept in step by playing up to 15% faster or slower (invisible), and only waits at the very start of playback, so the music plays untouched. Sound that does drift (more than 0.06 s) is eased back by up to 8% with its pitch kept, until it is within 0.02 s, rather than by seeking, which phones hear as a skip; only a drift of over a second is fixed with a seek. Speed ramps update the playback rate only on changes of 3% or more, and on phones step through the ramp in half-second steps at each step's average speed (so the video still lands where it should). Directly shown videos are moved with a single compositor transform (position, rotation and scale) on a fixed-size box rather than by changing their layout every frame. The playback report counts video freezes (the leading video standing still for 150 ms or more while it should play) and speed changes.

**Playback stats**: press and hold the timecode under the preview (or switch on **Playback stats** in the project panel, or add `?stats` to the address) for a live overlay of frame rate, slow frames, seeks and restarts, time spent waiting for video, dropped frames and players in use. **Copy report** puts a summary with the device and media details on the clipboard.

## Architecture

```
src/
  model/       Data model, timeline operations, timing (speed curves, holds, keyframes)
  engine/      Playback engine, canvas compositor, chroma key, WebCodecs export, audio mix, frames, drafts
  audio/       Bundled sound library (files in public/audio), music and SFX synthesiser, WAV encoder, beat detection and cut-to-beat
  ai/          Highlight finder, background removal and TTS workers
  captions/    Caption grouping and styles, audio windowing, Whisper worker
  templates/   Reel builder and team-colour card artwork
  components/  React UI: Home, Editor, Library, Preview, Inspector, Timeline, ReelWizard, MobileWorkspace...
```

The preview, export and audio mix all read the same timing model (`model/timing.ts`) and compositor (`engine/render.ts`), so what you see is what you export.

## Game to reel

**Game to reel** on the home screen (or the Sports tab) turns a whole game video into a finished reel. Choose the video and whether it's a player's reel or the team's, and pick a template. ClipForge finds every rally and keeps the best (eight for a player, ten for a team). For a player reel, tap your player once; ClipForge looks for them in the other plays (by their look and where they were) and asks you to confirm each guess, or tap the right player, or skip a play they aren't in. Then it builds the reel: titles, music cut to the beat, and your player spotlighted and followed through each play.

## Match breakdown

Open **Break down a full match** in the Sports tab with a whole game video. ClipForge finds every rally: referee whistles mark each serve and the end of each point, and movement on court shows the play between them (points the camera barely saw move still count when two whistles frame them). Each rally gets a frame, its length and a rating (the crowd's reaction, rally length and the hardest action). Watch any rally, or **Play all** for the whole game without the pauses; nudge a rally's start or end, drop anything that isn't a rally, sort by best, pick the best eight, and add them to the timeline or **Make a reel** with them already picked. The breakdown is saved with the project (and in project files).

**Stats.** Tag each rally on the tag pad under the video: pick a player, tap what they did (kill, attack, hit error, blocked, ace, serve in or error, pass 3/2/1 or aced, assist, set error, block, block assist or error, dig or dig error), or the other team's error, kill, ace or block. A point-ending tag gives the point to the right side and moves on to the next rally. ClipForge keeps the score (sets to 25, the fifth to 15, won by two), works out who served and your rotation, and builds the box score: each player's kills, errors, attempts, hitting percentage, aces, serve errors, receptions and pass average, assists, blocks, digs and points; the team's totals, sideout and point-scoring percentages, and points won and lost in each rotation. Tap any number to watch the plays behind it. Every tag can be removed or the point changed. Other sports tag each player's plays and count them.

**Playlists.** Tick rallies, or tap a stat to watch its plays, then **Save to playlist**: a teaching reel of one skill, a player's best moments, the season's top plays. Saving under an existing name adds to that playlist, so one playlist can collect moments from every game you've analysed. The Playlists tab plays them back to back (crossing from game to game), reorders, renames and removes clips, and turns a playlist into a reel or adds it to the timeline.

**Game summary for families.** On the Stats tab, one image with the final score, set by set, and the team leaders (kills, aces, blocks, digs, assists) with a line of team numbers, saved or shared as a Story, Post or Wide image. A game tagged only partway is titled "Game summary" and names no winner.

## Graphics & posters

Make still images to post, in the same broadcast package: **Game day** (split-screen versus with when and where), **Final score**, **Victory**, **Player spotlight** (Player of the Game, Senior Night...), **Play of the Week**, **College commitment** (with the college logo), **Stats** and **Starting lineup**. Open it from the home screen or the Sports tab, fill in the details (remembered from your reels), add a photo (Cut out removes its background), and save as a Story (9:16), Post (4:5) or Wide (16:9) image, or all three at once. Any full-screen graphic in a reel also has **Save as image** in its inspector.

## Music and sound credits

Every bundled recording is dedicated to the public domain (CC0) by its creator, so reels can be posted anywhere. Credit isn't required, but here it is with thanks:

| Sound | Creator | Source |
| --- | --- | --- |
| Lucid Trigger | Liq_mmry | [OpenGameArt](https://opengameart.org/content/lucid-trigger) |
| Hyper Ultra-Racing | cynicmusic | [OpenGameArt](https://opengameart.org/content/hyper-ultra-racing) |
| Doomed, Warped, Great Mission | Alexander Ehlers | [OpenGameArt](https://opengameart.org/content/free-music-pack) |
| Determined Pursuit | Emma_MA | [OpenGameArt](https://opengameart.org/content/determined-pursuit-epic-orchestra-loop) |
| Rhythm Factory | Zane Little Music | [OpenGameArt](https://opengameart.org/content/rhythm-factory) |
| Funked Up, Black Diamond | Joth | [OpenGameArt](https://opengameart.org/content/funked-up), [OpenGameArt](https://opengameart.org/content/black-diamond) |
| Twists | Alexander Ehlers | [OpenGameArt](https://opengameart.org/content/free-music-pack) |
| Megasong | Emma_MA | [OpenGameArt](https://opengameart.org/content/megasong) |
| Let the Games Begin | section31 | [OpenGameArt](https://opengameart.org/content/let-the-games-begin-0) |
| Fever Stadium | MintoDog | [OpenGameArt](https://opengameart.org/content/fever-stadium) |
| Technomania | Fupi | [OpenGameArt](https://opengameart.org/content/technomania101-2000s-europop-electronic-dance-music) |
| Final Hour | isaiah658 | [OpenGameArt](https://opengameart.org/content/final-hour) |
| The Rush | tebruno99 | [OpenGameArt](https://opengameart.org/content/the-rush) |
| Try Me | iamoneabe | [OpenGameArt](https://opengameart.org/content/try-me) |
| Whoosh | bosslevelaudio | [OpenGameArt](https://opengameart.org/content/wierd-whooshes) |
| Slam, Hit, Boom | Kenney | [Impact Sounds](https://kenney.nl/assets/impact-sounds), [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) |
| Crowd cheer | eXpl0it3r | [OpenGameArt](https://opengameart.org/content/applause-in-a-large-hall-or-church) |
| Swish | artisticdude | [OpenGameArt](https://opengameart.org/content/swishes-sound-pack) |

Tracks are trimmed to at most 110 seconds and mastered to -12 LUFS (-1 dBTP); beat maps come from the app's beat detector, checked against each track's drum hits.
