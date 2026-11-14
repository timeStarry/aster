import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { basename, type Tab } from './model';
import { t } from './i18n';

export type PaletteMode = 'files' | 'commands';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

export interface PaletteRow {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  shortcut?: string;
  score: number;
  select: () => void;
}

/** Fast substring + subsequence fuzzy scorer (higher is better; -1 means no match). */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const c = candidate.toLowerCase();
  if (c === q) return 1000;
  const subIdx = c.indexOf(q);
  if (subIdx === 0) return 800 - c.length;
  if (subIdx > 0) return 500 - subIdx * 2 - Math.min(80, c.length);

  // Subsequence match
  let qi = 0;
  let bonus = 0;
  let lastMatch = -2;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      if (ci === lastMatch + 1) bonus += 12;
      if (ci === 0 || '/\\-_ .'.includes(c[ci - 1])) bonus += 18;
      lastMatch = ci;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return 120 + bonus - Math.min(80, c.length);
}

export interface CommandPaletteProps {
  open: boolean;
  mode: PaletteMode;
  focusRev: number;
  tabs: Tab[];
  recentFiles: string[];
  workspaceRoot: string | null;
  workspaceFiles: string[];
  commands: PaletteCommand[];
  onSelectTab: (id: string) => void;
  onOpenPath: (path: string) => void;
  onClose: () => void;
}

export function CommandPalette(p: CommandPaletteProps) {
  const [rawQuery, setRawQuery] = createSignal('');
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  let inputRef!: HTMLInputElement;
  let listRef!: HTMLDivElement;

  createEffect(() => {
    void p.focusRev;
    if (!p.open) return;
    setRawQuery('');
    setSelectedIdx(0);
    queueMicrotask(() => inputRef?.focus());
  });

  // Typing `>` at start of Quick Open switches dynamically into Command mode
  const effectiveMode = createMemo<PaletteMode>(() => {
    if (p.mode === 'commands') return 'commands';
    return rawQuery().trimStart().startsWith('>') ? 'commands' : 'files';
  });

  const cleanQuery = createMemo(() => {
    const q = rawQuery().trimStart();
    if (p.mode === 'files' && q.startsWith('>')) return q.slice(1).trim();
    return q.trim();
  });

  const rows = createMemo<PaletteRow[]>(() => {
    const q = cleanQuery();

    if (effectiveMode() === 'commands') {
      const matched: PaletteRow[] = [];
      for (const cmd of p.commands) {
        const hay = [cmd.label, cmd.id, ...(cmd.keywords ?? [])].join(' ');
        const score = fuzzyScore(q, hay);
        if (score < 0) continue;
        matched.push({
          id: `cmd:${cmd.id}`,
          title: cmd.label,
          shortcut: cmd.shortcut,
          score,
          select: () => {
            p.onClose();
            cmd.run();
          },
        });
      }
      if (q) matched.sort((a, b) => b.score - a.score);
      return matched;
    }

    // Files mode (`⌘P`): Open Tabs -> Recent Files -> Workspace Files (deduped by path)
    const seenPaths = new Set<string>();
    const out: PaletteRow[] = [];

    const relToWorkspace = (fullPath: string): string => {
      if (p.workspaceRoot && fullPath.startsWith(p.workspaceRoot)) {
        return fullPath.slice(p.workspaceRoot.length).replace(/^[/\\]+/, '') || basename(fullPath);
      }
      return fullPath;
    };

    for (const tb of p.tabs) {
      if (tb.path) seenPaths.add(tb.path);
      const subtitle = tb.path ? relToWorkspace(tb.path) : undefined;
      const score = fuzzyScore(q, `${tb.title} ${subtitle ?? ''}`);
      if (score < 0) continue;
      out.push({
        id: `tab:${tb.id}`,
        title: tb.title,
        subtitle,
        badge: t('palette.badgeOpen'),
        score: score + 40,
        select: () => {
          p.onClose();
          p.onSelectTab(tb.id);
        },
      });
    }

    for (const rp of p.recentFiles) {
      if (seenPaths.has(rp)) continue;
      seenPaths.add(rp);
      const name = basename(rp);
      const sub = relToWorkspace(rp);
      const score = fuzzyScore(q, `${name} ${sub}`);
      if (score < 0) continue;
      out.push({
        id: `recent:${rp}`,
        title: name,
        subtitle: sub,
        badge: t('palette.badgeRecent'),
        score: score + 20,
        select: () => {
          p.onClose();
          p.onOpenPath(rp);
        },
      });
    }

    for (const wp of p.workspaceFiles) {
      if (seenPaths.has(wp)) continue;
      seenPaths.add(wp);
      const name = basename(wp);
      const sub = relToWorkspace(wp);
      const score = fuzzyScore(q, `${name} ${sub}`);
      if (score < 0) continue;
      out.push({
        id: `ws:${wp}`,
        title: name,
        subtitle: sub,
        score,
        select: () => {
          p.onClose();
          p.onOpenPath(wp);
        },
      });
    }

    if (q) out.sort((a, b) => b.score - a.score);
    return out.slice(0, 80);
  });

  createEffect(() => {
    void cleanQuery();
    void effectiveMode();
    setSelectedIdx(0);
  });

  createEffect(() => {
    if (!p.open) return;
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener('keydown', onWinKey, true);
    onCleanup(() => window.removeEventListener('keydown', onWinKey, true));
  });

  const scrollSelectedIntoView = (idx: number) => {
    queueMicrotask(() => {
      listRef?.querySelector<HTMLElement>(`[data-palette-idx="${idx}"]`)?.scrollIntoView?.({ block: 'nearest' });
    });
  };

  return (
    <Show when={p.open}>
      <div
        class="aster-palette-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={effectiveMode() === 'commands' ? t('palette.commandPlaceholder') : t('palette.quickOpenPlaceholder')}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) p.onClose();
        }}
      >
        <div class="aster-palette">
          <div class="aster-palette-head">
            <span class="aster-palette-prefix">{effectiveMode() === 'commands' ? '>' : '⌕'}</span>
            <input
              ref={inputRef}
              type="text"
              class="aster-palette-input"
              placeholder={
                p.mode === 'commands'
                  ? t('palette.commandPlaceholder')
                  : t('palette.quickOpenPlaceholder')
              }
              value={rawQuery()}
              onInput={(e) => setRawQuery(e.currentTarget.value)}
              on:keydown={(e) => {
                const list = rows();
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (list.length > 0) {
                    const next = (selectedIdx() + 1) % list.length;
                    setSelectedIdx(next);
                    scrollSelectedIntoView(next);
                  }
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (list.length > 0) {
                    const prev = (selectedIdx() - 1 + list.length) % list.length;
                    setSelectedIdx(prev);
                    scrollSelectedIntoView(prev);
                  }
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const chosen = list[selectedIdx()] ?? list[0];
                  chosen?.select();
                }
              }}
            />
          </div>

          <div class="aster-palette-list" ref={listRef} role="listbox">
            <Show
              when={rows().length > 0}
              fallback={<div class="aster-palette-empty">{t('palette.noResults')}</div>}
            >
              <For each={rows()}>
                {(row, idx) => (
                  <button
                    type="button"
                    role="option"
                    data-palette-idx={idx()}
                    aria-selected={idx() === selectedIdx()}
                    class="aster-palette-row"
                    classList={{ 'is-active': idx() === selectedIdx() }}
                    onMouseMove={() => setSelectedIdx(idx())}
                    onClick={() => row.select()}
                  >
                    <div class="aster-palette-main">
                      <span class="aster-palette-title">{row.title}</span>
                      <Show when={row.subtitle}>
                        <span class="aster-palette-sub">{row.subtitle}</span>
                      </Show>
                    </div>
                    <div class="aster-palette-meta">
                      <Show when={row.badge}>
                        <span class="aster-palette-badge">{row.badge}</span>
                      </Show>
                      <Show when={row.shortcut}>
                        <kbd class="aster-palette-kbd">{row.shortcut}</kbd>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
