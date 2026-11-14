import { invoke } from '@tauri-apps/api/core';
import type { EditorState } from '@codemirror/state';
import { makeTab, type Tab } from './model';

export interface DocReadResult {
  content: string;
  hash: string;
  readOnly?: boolean;
  encodingLossy?: boolean;
}

export interface FileChangedPayload {
  path: string;
  content: string;
  hash: string;
}

export interface SessionTabPayload {
  id: string;
  title: string;
  path: string | null;
  draftId?: string | null;
  cursor?: number;
  scrollTop?: number;
  unsavedContent?: string | null;
  hash?: string | null;
}

export interface SessionStatePayload {
  version: number;
  savedAt: number;
  cleanExit?: boolean;
  activeId?: string | null;
  workspaceRoot?: string | null;
  tabs: SessionTabPayload[];
}

export async function saveDraftOnDisk(draftId: string, content: string): Promise<string> {
  return invoke<string>('draft_save', { draftId, content });
}

export async function deleteDraftOnDisk(draftId: string | null | undefined): Promise<void> {
  if (!draftId) return;
  try {
    await invoke('draft_delete', { draftId });
  } catch {
    /* best-effort cleanup */
  }
}

export function serializeSessionState(opts: {
  tabs: Tab[];
  activeId: string;
  workspaceRoot?: string | null;
  cleanExit: boolean;
  isPristine: (tb: Tab) => boolean;
  getState: (id: string) => EditorState | undefined;
  cursorOffsets: Map<string, number>;
  scrollTops: Map<string, number>;
}): SessionStatePayload {
  const serializedTabs: SessionTabPayload[] = opts.tabs
    .filter((tb) => tb.path || !opts.isPristine(tb) || opts.tabs.length > 1)
    .map((tb) => {
      const st = opts.getState(tb.id);
      const curOffset = st ? st.selection.main.head : (opts.cursorOffsets.get(tb.id) ?? 0);
      return {
        id: tb.id,
        title: tb.title,
        path: tb.path,
        draftId: tb.path ? null : (tb.draftId ?? `draft-${tb.id}`),
        cursor: curOffset,
        scrollTop: opts.scrollTops.get(tb.id) ?? 0,
        unsavedContent: tb.path && tb.dirty ? tb.content : null,
        hash: tb.path ? tb.hash : null,
      };
    });

  return {
    version: 2,
    savedAt: Date.now(),
    cleanExit: opts.cleanExit,
    activeId: opts.activeId,
    workspaceRoot: opts.workspaceRoot ?? null,
    tabs: serializedTabs,
  };
}

export interface RestoredSession {
  tabs: Tab[];
  activeId: string | null;
  workspaceRoot: string | null;
  cleanExit: boolean;
}

export async function loadRestoredSession(opts: {
  untitledBase: string;
  isWelcomeText: (s: string) => boolean;
  cursorOffsets: Map<string, number>;
  scrollTops: Map<string, number>;
}): Promise<RestoredSession | null> {
  const session = await invoke<SessionStatePayload | null>('session_load_v2');
  if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) return null;

  const restored: Tab[] = [];
  for (const item of session.tabs) {
    if (item.path) {
      try {
        const doc = await invoke<DocReadResult>('dispatch', { id: 'doc.read', params: { path: item.path } });
        const hasUnsaved = typeof item.unsavedContent === 'string' && item.unsavedContent !== doc.content;
        const nt = makeTab(
          {
            id: item.id,
            path: item.path,
            content: hasUnsaved ? item.unsavedContent! : doc.content,
            hash: doc.hash,
            encodingLossy: !!doc.encodingLossy,
          },
          restored,
          opts.untitledBase,
        );
        if (hasUnsaved) {
          nt.saved = doc.content;
          nt.dirty = true;
        }
        restored.push(nt);
        if (typeof item.cursor === 'number') opts.cursorOffsets.set(nt.id, item.cursor);
        if (typeof item.scrollTop === 'number') opts.scrollTops.set(nt.id, item.scrollTop);
      } catch {
        // File moved/deleted externally while closed — preserve unsaved buffer if present
        if (typeof item.unsavedContent === 'string') {
          const nt = makeTab({ id: item.id, content: item.unsavedContent }, restored, opts.untitledBase);
          nt.title = item.title || nt.title;
          nt.saved = '';
          nt.dirty = true;
          restored.push(nt);
        }
      }
    } else {
      const did = item.draftId ?? `draft-${item.id}`;
      const draftContent = await invoke<string | null>('draft_read', { draftId: did }).catch(() => null);
      const content = draftContent ?? item.unsavedContent ?? '';
      if (content === '' && session.tabs.length === 1) continue;
      const nt = makeTab(
        { id: item.id, draftId: did, content },
        restored,
        opts.untitledBase,
      );
      if (item.title) nt.title = item.title;
      if (!opts.isWelcomeText(content)) {
        nt.saved = '';
        nt.dirty = true;
      }
      restored.push(nt);
      if (typeof item.cursor === 'number') opts.cursorOffsets.set(nt.id, item.cursor);
      if (typeof item.scrollTop === 'number') opts.scrollTops.set(nt.id, item.scrollTop);
    }
  }

  if (restored.length === 0) return null;
  return {
    tabs: restored,
    activeId: session.activeId ?? null,
    workspaceRoot: session.workspaceRoot ?? null,
    cleanExit: session.cleanExit !== false,
  };
}
