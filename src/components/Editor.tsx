import { useEffect, useState } from 'react';
import {
  addAssetToTimeline,
  addMarkerAtPlayhead,
  copySelectedStyle,
  pasteSelectedStyle,
  deleteSelected,
  duplicateSelected,
  goHome,
  importFiles,
  renameProject,
  splitAtPlayhead,
} from '../actions';
import { engine } from '../engine/engine';
import { projectDuration } from '../model/ops';
import { redo, select, undo, useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { isTypingTarget } from '../utils';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { useIsMobile } from '../ui/useMediaQuery';
import { Library } from './Library';
import { MobileWorkspace } from './MobileWorkspace';
import { ReelWizard } from './ReelWizard';
import { HelpDialog } from './HelpDialog';
import { Preview } from './Preview';
import { GameToReel } from './GameToReel';
import { MatchView } from './MatchView';
import { Timeline } from './Timeline';

export function Editor() {
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState(false);
  const [fileDrag, setFileDrag] = useState(false);
  const name = useEditor((s) => s.project.name);
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const mobile = useIsMobile();
  const wizard = useEditor((s) => !!s.wizard);
  const match = useEditor((s) => !!s.match);
  const quick = useEditor((s) => !!s.quick);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || exporting || useEditor.getState().wizard || useEditor.getState().match || useEditor.getState().quick) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && e.altKey && key === 'c') {
        e.preventDefault();
        copySelectedStyle();
      } else if (mod && e.altKey && key === 'v') {
        e.preventDefault();
        pasteSelectedStyle();
      } else if (mod) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        engine.toggle();
      } else if (key === 's' || key === 'b') {
        splitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected(e.shiftKey);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine.stepFrames(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine.stepFrames(e.shiftKey ? 10 : 1);
      } else if (e.key === 'Home') {
        engine.seek(0);
      } else if (e.key === 'End') {
        engine.seek(projectDuration(useEditor.getState().project));
      } else if (e.key === 'Escape') {
        if (useEditor.getState().pick) useEditor.setState({ pick: null });
        else select(null);
      } else if (e.key === '?') {
        setHelp((h) => !h);
      } else if (key === 'm') {
        addMarkerAtPlayhead();
      } else if (key === 'n') {
        useEditor.setState((s) => ({ snapping: !s.snapping }));
      } else if (e.key === '=' || e.key === '+') {
        useEditor.setState((s) => ({ pxPerSec: Math.min(480, s.pxPerSec * 1.4) }));
      } else if (e.key === '-') {
        useEditor.setState((s) => ({ pxPerSec: Math.max(4, s.pxPerSec / 1.4) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exporting]);

  return (
    <div
      className={`editor ${mobile ? 'mobile' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setFileDrag(true);
        }
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFileDrag(false)}
      onDrop={async (e) => {
        setFileDrag(false);
        if (e.defaultPrevented || !e.dataTransfer.files.length) return;
        e.preventDefault();
        const assets = await importFiles(e.dataTransfer.files);
        if (!useEditor.getState().project.clips.length) for (const a of assets) addAssetToTimeline(a.id);
      }}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" title="Back to drafts" onClick={() => void goHome()}>
            <Icon name="home" />
          </button>
          <span className="brand small">
            <span className="brand-mark">
              <Icon name="play" size={11} />
            </span>
          </span>
          <input
            className="project-name"
            defaultValue={name}
            key={name}
            aria-label="Project name"
            onBlur={(e) => renameProject(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <SaveState />
        </div>
        <div className="topbar-right">
          <button className="icon-btn hide-mobile" title="Shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}>
            <Icon name="keyboard" />
          </button>
          <button className="btn primary" aria-label="Export" disabled={!hasClips} onClick={() => setExporting(true)}>
            <Icon name="export" /> <span className="hide-xs">Export</span>
          </button>
        </div>
      </header>
      {mobile ? (
        <MobileWorkspace />
      ) : (
        <>
          <div className="workspace">
            <Library />
            <Preview />
            <Inspector />
          </div>
          <Timeline />
        </>
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {wizard && <ReelWizard />}
      {match && <MatchView />}
      {quick && <GameToReel />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {fileDrag && <div className="drop-overlay">Drop to import</div>}
    </div>
  );
}

function SaveState() {
  const updatedAt = useEditor((s) => s.project.updatedAt);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => setSaved(true), 1500);
    return () => clearTimeout(t);
  }, [updatedAt]);
  return <span className="save-state">{saved ? 'Saved to drafts' : 'Saving...'}</span>;
}
