# ClipForge

A CapCut-style video editor that runs entirely in the browser, with a built-in workflow for volleyball highlight reels. Media never leaves your machine: files are decoded, composited and exported locally, and drafts are kept in IndexedDB.

**Live app:** https://mgoodchild2025.github.io/Capcut/ (published by `.github/workflows/deploy-pages.yml`)

## Volleyball highlight reels

1. On the home screen, pick a template. You can also open the **Volleyball** tab in the editor.

   | Template | Format | For |
   | --- | --- | --- |
   | Recruiting reel | 16:9 | College coaches: profile card, spotlights, stats, contact details |
   | Hype reel | 9:16 | TikTok and Reels: beat-synced cuts, slow motion, flashes |
   | Player spotlight | 4:5 | Feed posts like Player of the Game or Senior Night: jersey-number art, every play rings the player |
   | Team reel | 9:16 | The team account: roster card, each play credited to a player, team stats |
   | Starting lineup | 9:16 | Pre-game hype: each starter's number, name and position over their photo, clip or a number card |
   | Season recap | 16:9 | Team montage with record, stats and a send-off |

   Add your **team logo** once (it's remembered): it goes on title and closing cards, and as a corner badge during plays.
   Optionally enter the **match score**: the opponent and set scores add a **Final** card, and a score per play (e.g. `18-21`, set 2) shows a live score bug.

   Team reels and the starting lineup have a **Roster** step. Paste a list (one player per line, like `12 Jordan Lee, Outside`) or add players one by one. The roster is remembered for next time.
2. Enter the player or team details and pick team colours. The title card previews live, and details are remembered for next time.
3. Import game footage and press **Find highlights**. On-device analysis listens for referee whistles, measures how much louder the crowd gets after each point than during the rally, and tracks on-court motion. It then ranks the best rallies, each framed from serve to end whistle. Pick plays from the AI results or use whole clips, then add skill labels (Kill, Ace, Block...) and reorder them.
4. Vertical and 4:5 reels **auto-follow the action**: on-device motion tracking pans wide game footage to keep the play in frame. **Auto reframe** in the clip tools does the same for any clip in the editor.
5. Tap your player in each play to place a **spotlight**. The reel freezes that frame, dims the surroundings and rings the player.
6. Choose a music track and press **Build my reel**. You get a complete, editable timeline:
   - Title, profile, stats and outro cards painted in your team colours.
   - Spotlights, skill labels and a corner name tag.
   - Transitions and music.
   - Hype reels add slow-motion on the hit, cuts locked to the beat, flashes and whooshes, and reframe landscape footage to 9:16 around your player.

The Volleyball tab also has text presets (KILL!, ACE!, BLOCK!, DIG!, name and score bugs) and stickers.

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
