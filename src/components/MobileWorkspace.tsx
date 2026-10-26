import { useEffect, useState, type ReactNode } from 'react';
import { deleteSelected, duplicateSelected, splitAtPlayhead } from '../actions';
import { select, selectedClip, useEditor, type LeftTab } from '../store';
import { Icon } from '../ui/Icon';
import { Inspector } from './Inspector';
import { LibraryTabBody, TABS } from './Library';
import { Preview } from './Preview';
import { Timeline } from './Timeline';

type Sheet = { kind: 'tab'; tab: LeftTab } | { kind: 'edit' } | null;

/**
 * Phone layout in the CapCut style: preview on top, timeline beneath, and a tool bar along the
 * bottom that opens tools as a bottom sheet. With a clip selected, the bar switches to clip actions.
 */
export function MobileWorkspace() {
  const clip = useEditor(selectedClip);
  const [sheet, setSheet] = useState<Sheet>(null);

  // An edit sheet belongs to the selected clip; close it when the selection goes away.
  useEffect(() => {
    if (!clip && sheet?.kind === 'edit') setSheet(null);
  }, [clip, sheet]);

  // Tapping something in the preview (a colour, the player): the sheet steps aside for the tap,
  // and the edit sheet comes back once it's done.
  const pick = useEditor((s) => s.pick);
  const [resume, setResume] = useState<Sheet>(null);
  useEffect(() => {
    if (pick && sheet) {
      setResume(sheet);
      setSheet(null);
    } else if (!pick && resume) {
      // After the tap's own click has landed, or it would close the sheet straight away.
      const t = setTimeout(() => {
        setSheet(resume);
        setResume(null);
      }, 350);
      return () => clearTimeout(t);
    }
  }, [pick, sheet, resume]);

  const openTab = (tab: LeftTab) => {
    useEditor.setState({ leftTab: tab });
    setSheet({ kind: 'tab', tab });
  };
  const visual = clip && (clip.kind === 'video' || clip.kind === 'image');
  const title = sheet?.kind === 'edit' ? 'Edit' : sheet ? TABS.find((t) => t.id === sheet.tab)?.label : '';

  return (
    <div className="m-workspace">
      <Preview />
      <Timeline />
      <nav className="m-toolbar" aria-label={clip ? 'Clip tools' : 'Add and style'}>
        {clip ? (
          <>
            <ToolButton icon="close" label="Done" onClick={() => select(null)} />
            <ToolButton icon="edit" label="Edit" active={sheet?.kind === 'edit'} onClick={() => setSheet({ kind: 'edit' })} />
            <ToolButton icon="split" label="Split" onClick={splitAtPlayhead} />
            <ToolButton icon="copy" label="Duplicate" onClick={duplicateSelected} />
            {visual && <ToolButton icon="filter" label="Filters" onClick={() => openTab('filters')} />}
            {visual && <ToolButton icon="transition" label="Transition" onClick={() => openTab('transitions')} />}
            <ToolButton icon="trash" label="Delete" danger onClick={() => deleteSelected()} />
          </>
        ) : (
          TABS.map((t) => (
            <ToolButton
              key={t.id}
              icon={t.icon}
              label={t.label}
              active={sheet?.kind === 'tab' && sheet.tab === t.id}
              onClick={() => openTab(t.id)}
            />
          ))
        )}
      </nav>
      {sheet && (
        <BottomSheet title={title ?? ''} onClose={() => setSheet(null)}>
          {sheet.kind === 'edit' ? <Inspector /> : <LibraryTabBody tab={sheet.tab} />}
        </BottomSheet>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button className={`m-tool ${active ? 'on' : ''} ${danger ? 'danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose} />
      <section className="m-sheet" role="dialog" aria-label={title}>
        <header>
          <button className="m-sheet-grip" aria-label="Close" onClick={onClose} />
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="check" />
          </button>
        </header>
        <div className="m-sheet-body">{children}</div>
      </section>
    </>
  );
}
