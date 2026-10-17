# ClipForge

A CapCut-style video editor that runs entirely in the browser. Media never leaves your machine: files are decoded, composited and exported locally, and drafts are kept in IndexedDB.

## Features

- **Projects and drafts**: 16:9, 9:16, 1:1, 4:5, 4:3 and 21:9 canvases. Every edit autosaves; reopen drafts from the home screen.
- **Media library**: import video, photos and audio by picker or drag and drop. Thumbnails, timeline filmstrips and audio waveforms are generated on import.
- **Multi-track timeline**: magnetic main track, overlay video tracks, text tracks and audio tracks. Drag clips between tracks, trim either edge, split, duplicate, ripple delete, snap to edges and the playhead, zoom (Ctrl + wheel), and mute, hide or lock tracks.
- **Preview canvas**: real-time compositing with on-canvas move, scale and rotate handles plus centre guides.
- **Text and stickers**: text templates, fonts, size, colour, stroke, background, alignment and shadow, plus an emoji sticker set.
- **Look**: 14 filter presets, plus brightness, contrast, saturation, hue, blur and vignette.
- **Motion**: in and out animations (fade, slide, zoom, spin, pop) and transitions between clips (dissolve, dip to black, push, wipe, zoom, blur).
- **Audio**: per-clip volume up to 200%, fade in and out, track mute, and speed changes from 0.25x to 10x.
- **Export**: 480p to 4K at 24 to 60 fps with three quality levels, as MP4 with mixed audio. Where the browser supports WebCodecs (Chrome, Edge, recent Firefox and Safari), export decodes, composites and encodes frame by frame: frame-accurate, usually faster than real time, and it keeps going in a background tab. Otherwise it falls back to recording playback in real time.
- **Undo and redo** for every edit. Each drag or slider gesture counts as one step.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| S or B | Split at playhead (the selected clip, or every clip under the playhead) |
| Delete / Backspace | Delete clip (Shift for ripple delete) |
| Ctrl/Cmd + D | Duplicate |
| Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z | Undo, redo |
| Left / Right | Step one frame (Shift steps 10) |
| Home / End | Jump to start / end |
| N | Toggle snapping (hold Alt while dragging to bypass) |
| + / - | Zoom the timeline |
| Esc | Deselect |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # timeline model unit tests
npm run build    # type-check and production build into dist/
```

**Live app:** https://mgoodchild2025.github.io/Capcut/ (rebuilt and published by `.github/workflows/deploy-pages.yml` on every push to `main`)

Use a recent Chromium-based browser (Chrome or Edge) for MP4 export and the widest codec support. Firefox works and exports WebM.

## Architecture

```
src/
  model/        Pure data model: types, presets, factories and timeline operations (unit tested)
  engine/
    engine.ts   Playback clock, one media element per clip, Web Audio mixing, render loop, export
    render.ts   Canvas compositor: layout, filters, animations, transitions, text, hit-testing
    media.ts    Import, metadata, thumbnails, filmstrips and waveforms
    persist.ts  IndexedDB drafts (projects, asset metadata and media blobs)
  components/   React UI: Home, Editor, Library, Preview, Inspector, Timeline, ExportDialog
  store.ts      Zustand store with undo/redo history and gesture grouping
  actions.ts    User-level commands that combine the store, engine and persistence
```

The timeline is a flat list of clips, each pointing at a track. `activeLayers(project, t)` resolves what is visible and audible at any moment, including the held outgoing frame during a transition. Both the preview and the export render from that one function, so what you see is what you export.

Export (`engine/exportFast.ts`) decodes each video clip with WebCodecs via [Mediabunny](https://mediabunny.dev), feeds the decoded frames to the same compositor, and encodes the result to MP4. The audio mix is rendered separately on an `OfflineAudioContext`. If a browser lacks WebCodecs, or a clip can't be decoded that way, the dialog falls back to recording the composited canvas and the Web Audio mix in real time with `MediaRecorder`. Speed changes shift pitch in both preview and export.
