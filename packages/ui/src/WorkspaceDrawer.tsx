import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import type { OutlineItem } from '@aster/editor';
import { basename } from './model';
import { t } from './i18n';

export type DrawerTab = 'files' | 'outline' | 'search';

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  relPath: string;
  isDir: boolean;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceSearchHit {
  path: string;
  relPath: string;
  line: number;
  offset: number;
  snippet: string;
}

export interface WorkspaceDrawerProps {
  open: boolean;
  workspaceRoot: string | null;
  tree: WorkspaceTreeNode[];
  activePath: string | null;
  headings: OutlineItem[];
  cursorPos: number;
  onOpenFolder: () => void;
  onRefreshFolder: () => void;
  onCreateFile: (relPath: string) => Promise<void> | void;
  onSelectFile: (path: string, jumpOffset?: number) => void;
  onJumpHeading: (from: number) => void;
  onSearchWorkspace: (query: string) => Promise<WorkspaceSearchHit[]>;
}

export function WorkspaceDrawer(p: WorkspaceDrawerProps) {
  const [tab, setTab] = createSignal<DrawerTab>('files');
  const [collapsedDirs, setCollapsedDirs] = createSignal<Set<string>>(new Set());
  const [creating, setCreating] = createSignal(false);
  const [newFileName, setNewFileName] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchHits, setSearchHits] = createSignal<WorkspaceSearchHit[]>([]);
  const [searching, setSearching] = createSignal(false);

  let newFileInputRef!: HTMLInputElement;
  let searchTimer: number | undefined;
  onCleanup(() => clearTimeout(searchTimer));

  const minHeadingLevel = createMemo(() => {
    if (p.headings.length === 0) return 1;
    return Math.min(...p.headings.map((h) => h.level));
  });

  const activeHeadingIndex = createMemo(() => {
    let idx = -1;
    for (let i = 0; i < p.headings.length; i++) {
      if (p.headings[i].from <= p.cursorPos) idx = i;
      else break;
    }
    return idx >= 0 ? idx : 0;
  });

  const toggleDir = (relPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const startNewFile = () => {
    setCreating(true);
    setNewFileName('');
    queueMicrotask(() => newFileInputRef?.focus());
  };

  const submitNewFile = async () => {
    const name = newFileName().trim();
    if (!name) {
      setCreating(false);
      return;
    }
    setCreating(false);
    setNewFileName('');
    await p.onCreateFile(name);
  };

  // Debounced workspace search
  createEffect(() => {
    const q = searchQuery().trim();
    const root = p.workspaceRoot;
    clearTimeout(searchTimer);
    if (!root || !q) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    searchTimer = window.setTimeout(() => {
      void p.onSearchWorkspace(q).then(
        (hits) => {
          if (!cancelled) {
            setSearchHits(hits);
            setSearching(false);
          }
        },
        () => {
          if (!cancelled) {
            setSearchHits([]);
            setSearching(false);
          }
        },
      );
    }, 180);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(searchTimer);
    });
  });

  const groupedSearchHits = createMemo(() => {
    const groups = new Map<string, { path: string; relPath: string; hits: WorkspaceSearchHit[] }>();
    for (const h of searchHits()) {
      let g = groups.get(h.relPath);
      if (!g) {
        g = { path: h.path, relPath: h.relPath, hits: [] };
        groups.set(h.relPath, g);
      }
      g.hits.push(h);
    }
    return [...groups.values()];
  });

  const renderNodes = (nodes: WorkspaceTreeNode[], depth: number) => (
    <For each={nodes}>
      {(node) => {
        if (node.isDir) {
          const isCollapsed = () => collapsedDirs().has(node.relPath);
          return (
            <div class="aster-tree-group">
              <button
                type="button"
                class="aster-tree-row is-dir"
                style={{ 'padding-left': `${10 + depth * 13}px` }}
                onClick={() => toggleDir(node.relPath)}
              >
                <span class="aster-tree-chevron">{isCollapsed() ? '▸' : '▾'}</span>
                <span class="aster-tree-name">{node.name}</span>
              </button>
              <Show when={!isCollapsed() && node.children?.length}>
                {renderNodes(node.children!, depth + 1)}
              </Show>
            </div>
          );
        }
        return (
          <button
            type="button"
            class="aster-tree-row is-file"
            classList={{ 'is-active': p.activePath === node.path }}
            style={{ 'padding-left': `${22 + depth * 13}px` }}
            title={node.relPath}
            onClick={() => p.onSelectFile(node.path)}
          >
            <span class="aster-tree-name">{node.name.replace(/\.md$/i, '')}</span>
          </button>
        );
      }}
    </For>
  );

  return (
    <Show when={p.open}>
      <aside class="aster-drawer" aria-label="Workspace">
        <div class="aster-drawer-top">
          <div class="aster-drawer-seg" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab() === 'files'}
              classList={{ 'is-on': tab() === 'files' }}
              onClick={() => setTab('files')}
            >
              {t('drawer.files')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab() === 'outline'}
              classList={{ 'is-on': tab() === 'outline' }}
              onClick={() => setTab('outline')}
            >
              {t('drawer.outline')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab() === 'search'}
              classList={{ 'is-on': tab() === 'search' }}
              onClick={() => setTab('search')}
            >
              {t('drawer.search')}
            </button>
          </div>
        </div>

        <Show when={tab() === 'files'}>
          <Show
            when={p.workspaceRoot}
            fallback={
              <div class="aster-drawer-empty">
                <p>{t('drawer.emptyFolderHint')}</p>
                <button type="button" class="aster-drawer-primary" onClick={p.onOpenFolder}>
                  {t('drawer.openFolder')}
                </button>
              </div>
            }
          >
            {(root) => (
              <div class="aster-drawer-body">
                <div class="aster-drawer-subheader">
                  <button
                    type="button"
                    class="aster-drawer-folder-btn"
                    title={root()}
                    onClick={p.onOpenFolder}
                  >
                    {basename(root())}
                  </button>
                  <div class="aster-drawer-actions">
                    <button
                      type="button"
                      class="aster-drawer-icon"
                      title={t('drawer.newFile')}
                      aria-label={t('drawer.newFile')}
                      onClick={startNewFile}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      class="aster-drawer-icon"
                      title={t('drawer.refresh')}
                      aria-label={t('drawer.refresh')}
                      onClick={p.onRefreshFolder}
                    >
                      ↻
                    </button>
                  </div>
                </div>

                <Show when={creating()}>
                  <div class="aster-drawer-newfile">
                    <input
                      ref={newFileInputRef}
                      type="text"
                      class="aster-drawer-input"
                      placeholder={t('drawer.newFilePlaceholder')}
                      value={newFileName()}
                      onInput={(e) => setNewFileName(e.currentTarget.value)}
                      onBlur={() => setCreating(false)}
                      on:keydown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitNewFile();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setCreating(false);
                        }
                      }}
                    />
                  </div>
                </Show>

                <div class="aster-drawer-scroll">
                  <Show
                    when={p.tree.length > 0}
                    fallback={<div class="aster-drawer-hint">{t('drawer.noFiles')}</div>}
                  >
                    {renderNodes(p.tree, 0)}
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </Show>

        <Show when={tab() === 'outline'}>
          <div class="aster-drawer-body">
            <div class="aster-drawer-scroll">
              <Show
                when={p.headings.length > 0}
                fallback={<div class="aster-drawer-hint">{t('drawer.noOutline')}</div>}
              >
                <For each={p.headings}>
                  {(h, idx) => (
                    <button
                      type="button"
                      class="aster-outline-row"
                      classList={{
                        'is-active': idx() === activeHeadingIndex(),
                        'is-h1': h.level === 1,
                      }}
                      style={{ 'padding-left': `${12 + Math.max(0, h.level - minHeadingLevel()) * 12}px` }}
                      title={h.text}
                      onClick={() => p.onJumpHeading(h.from)}
                    >
                      <span class="aster-outline-lvl">H{h.level}</span>
                      <span class="aster-outline-txt">{h.text}</span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={tab() === 'search'}>
          <div class="aster-drawer-body">
            <Show
              when={p.workspaceRoot}
              fallback={
                <div class="aster-drawer-empty">
                  <p>{t('drawer.searchNoFolder')}</p>
                  <button type="button" class="aster-drawer-primary" onClick={p.onOpenFolder}>
                    {t('drawer.openFolder')}
                  </button>
                </div>
              }
            >
              <div class="aster-drawer-searchbox">
                <input
                  type="text"
                  class="aster-drawer-input"
                  placeholder={t('drawer.searchPlaceholder')}
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
              </div>
              <div class="aster-drawer-scroll">
                <Show when={searching()}>
                  <div class="aster-drawer-hint">{t('drawer.searching')}</div>
                </Show>
                <Show when={!searching() && searchQuery().trim() && groupedSearchHits().length === 0}>
                  <div class="aster-drawer-hint">{t('drawer.searchEmpty')}</div>
                </Show>
                <For each={groupedSearchHits()}>
                  {(group) => (
                    <div class="aster-search-group">
                      <div class="aster-search-file">
                        <span class="aster-search-filename">{group.relPath}</span>
                        <span class="aster-search-badge">{group.hits.length}</span>
                      </div>
                      <For each={group.hits}>
                        {(hit) => (
                          <button
                            type="button"
                            class="aster-search-hit"
                            onClick={() => p.onSelectFile(hit.path, hit.offset)}
                          >
                            <span class="aster-search-line">L{hit.line}</span>
                            <span class="aster-search-snip">{hit.snippet}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  );
}
