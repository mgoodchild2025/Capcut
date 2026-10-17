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
- **Four graphics looks**: **Broadcast** (bold TV package), **Championship** (brushed gold, spotlights and sparks), **Neon** (glow and a racing grid) and **Classic** (clean and understated). Switch every graphic at once from the graphic inspector.

1. On the home screen, pick a sport, a look and a template. You can also open the **Sports** tab in the editor.

   | Template | Format | For |
   | --- | --- | --- |
   | Recruiting reel | 16:9 | College coaches: open, profile card, plays with player IDs, stats, contact details |
   | Hype reel | 9:16 | TikTok and Reels: beat-synced cuts, slow motion, stingers |
   | Player spotlight | 4:5 | Feed posts like Player of the Game or Senior Night |
   | Team reel | 9:16 | The team account: roster wall, each play credited to a player, team stats |
   | Starting lineup | 9:16 | Pre-game hype: a player card per starter with their photo, cut-out or clip |
   | Season recap | 16:9 | Team montage with stats, final score and a send-off |

2. Enter the player or team details, pick team colours and add your **team and opponent logos** (remembered for next time). Player reels take a **photo or short clip** of the player; turn on **Cut out** to remove a photo's background. Optionally enter the **match score**: set scores add the final scoreboard, and a score per play shows the score bug.
3. Team reels and the starting lineup have a **Roster** step. Paste a list (one player per line, like `12 Jordan Lee, Outside`) or add players one by one, with a photo or clip for each.
4. Import game footage and press **Find highlights**. On-device analysis listens for referee whistles, measures how much louder the crowd gets after each point than during the rally, and tracks on-court motion. Pick plays, label them with the sport's plays (Kill, Three, Goal, Home run...) and credit them to players.
5. Vertical and 4:5 reels **auto-follow the action**, panning wide game footage to keep the play in frame. Tap your player in a play to place a **spotlight** instead: the reel freezes, dims the surroundings and rings them.
6. Choose a music track and press **Build my reel**. Select any graphic in the editor to change its words and colours.

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
  - Five built-in royalty-free music tracks and twelve sound effects, synthesised in the browser.
  - Voiceover recording and AI text-to-speech.
  - Beat detection with bar markers, and **Sync cuts to the beat**.
- **Export**: 480p to 4K, 24 to 60 fps, MP4. Frame by frame with WebCodecs, usually faster than real time and fine in a background tab. Falls back to real-time recording where WebCodecs is missing. On phones, **Save to Photos** / **Share** hands the video to the share sheet.
- **Move projects between devices**: the share icon on a draft saves it as one `.clipforge` file with all its media (AirDrop or Files on iPhone). **Open a project file** on the home screen loads it on another device.
- **Install as an app**: Add to Home Screen (on iPhone: Share, then Add to Home Screen) for a full-screen app that also works offline.

## AI that runs on your device

| Feature | How |
| --- | --- |
| Highlight finder | Signal analysis of audio (whistle tones, crowd level) and video motion. No download. |
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

## Architecture

```
src/
  model/       Data model, timeline operations, timing (speed curves, holds, keyframes)
  engine/      Playback engine, canvas compositor, chroma key, WebCodecs export, audio mix, frames, drafts
  audio/       Music and SFX synthesiser, WAV encoder, beat detection and cut-to-beat
  ai/          Highlight finder, background removal and TTS workers
  captions/    Caption grouping and styles, audio windowing, Whisper worker
  templates/   Reel builder and team-colour card artwork
  components/  React UI: Home, Editor, Library, Preview, Inspector, Timeline, ReelWizard, MobileWorkspace...
```

The preview, export and audio mix all read the same timing model (`model/timing.ts`) and compositor (`engine/render.ts`), so what you see is what you export.
