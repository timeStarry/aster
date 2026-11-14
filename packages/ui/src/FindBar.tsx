import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import type { EditorView } from '@codemirror/view';
import {
  applyEditorSearch,
  clearEditorSearch,
  countEditorMatches,
  findNextMatch,
  findPrevMatch,
  replaceCurrentMatch,
  replaceAllMatches,
  type SearchStats,
} from '@aster/editor';
import { t } from './i18n';

export interface FindBarProps {
  open: boolean;
  showReplace: boolean;
  readOnly: boolean;
  initialQuery: string;
  /** Bumped when document or selection changes so match count stays live. */
  docRev: number;
  /** Bumped each time ⌘F / ⌘⌥F is invoked to re-focus the search input. */
  focusRev: number;
  view: () => EditorView | null;
  onToggleReplace: (show: boolean) => void;
  onClose: () => void;
}

export function FindBar(p: FindBarProps) {
  const [query, setQuery] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [regexp, setRegexp] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [stats, setStats] = createSignal<SearchStats>({ total: 0, current: 0, valid: true });

  let findInputRef!: HTMLInputElement;

  createEffect(() => {
    void p.focusRev;
    if (!p.open) return;
    if (p.initialQuery) setQuery(p.initialQuery);
    queueMicrotask(() => {
      findInputRef?.focus();
      findInputRef?.select();
    });
  });

  const syncSearchState = () => {
    const view = p.view();
    if (!view) return null;
    const nextStats = applyEditorSearch(view, {
      search: query(),
      replace: replacement(),
      caseSensitive: caseSensitive(),
      regexp: regexp(),
      wholeWord: wholeWord(),
    });
    setStats(nextStats);
    return view;
  };

  createEffect(() => {
    if (!p.open) {
      const view = p.view();
      if (view) clearEditorSearch(view);
      return;
    }
    syncSearchState();
  });

  // Update `current / total` when editor selection or document changes externally
  createEffect(() => {
    void p.docRev;
    if (!p.open) return;
    const view = p.view();
    if (!view) return;
    setStats(countEditorMatches(view.state));
  });

  const stepNext = () => {
    const view = syncSearchState();
    if (!view || !query()) return;
    findNextMatch(view);
    setStats(countEditorMatches(view.state));
  };

  const stepPrev = () => {
    const view = syncSearchState();
    if (!view || !query()) return;
    findPrevMatch(view);
    setStats(countEditorMatches(view.state));
  };

  const doReplace = () => {
    if (p.readOnly || !query()) return;
    const view = syncSearchState();
    if (!view) return;
    replaceCurrentMatch(view);
    setStats(countEditorMatches(view.state));
  };

  const doReplaceAll = () => {
    if (p.readOnly || !query()) return;
    const view = syncSearchState();
    if (!view) return;
    replaceAllMatches(view);
    setStats(countEditorMatches(view.state));
  };

  const closeBar = () => {
    const view = p.view();
    if (view) {
      clearEditorSearch(view);
      view.focus();
    }
    p.onClose();
  };

  // Close FindBar on Escape even when focus has returned to the editor
  createEffect(() => {
    if (!p.open) return;
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        closeBar();
      }
    };
    window.addEventListener('keydown', onWinKey);
    onCleanup(() => window.removeEventListener('keydown', onWinKey));
  });

  return (
    <Show when={p.open}>
      <div
        class="aster-find-bar"
        role="search"
        aria-label={t('find.title')}
        on:keydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeBar();
          }
        }}
      >
        <div class="aster-find-row">
          <Show when={!p.readOnly}>
            <button
              type="button"
              class="aster-find-icon"
              classList={{ 'is-on': p.showReplace }}
              aria-label={t('find.toggleReplace')}
              title={t('find.toggleReplace')}
              onClick={() => p.onToggleReplace(!p.showReplace)}
            >
              {p.showReplace ? '▾' : '▸'}
            </button>
          </Show>
          <div class="aster-find-field" classList={{ 'is-invalid': !stats().valid }}>
            <input
              ref={findInputRef}
              type="text"
              class="aster-find-input"
              placeholder={t('find.placeholder')}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              on:keydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) stepPrev();
                  else stepNext();
                }
              }}
            />
            <span class="aster-find-count">
              {!query()
                ? ''
                : !stats().valid
                  ? '!'
                  : `${stats().total === 0 ? 0 : stats().current}/${stats().total}`}
            </span>
            <button
              type="button"
              class="aster-find-opt"
              classList={{ 'is-on': caseSensitive() }}
              title={t('find.matchCase')}
              aria-pressed={caseSensitive()}
              onClick={() => setCaseSensitive((v) => !v)}
            >
              Aa
            </button>
            <button
              type="button"
              class="aster-find-opt"
              classList={{ 'is-on': wholeWord() }}
              title={t('find.wholeWord')}
              aria-pressed={wholeWord()}
              onClick={() => setWholeWord((v) => !v)}
            >
              ab
            </button>
            <button
              type="button"
              class="aster-find-opt"
              classList={{ 'is-on': regexp() }}
              title={t('find.regexp')}
              aria-pressed={regexp()}
              onClick={() => setRegexp((v) => !v)}
            >
              .*
            </button>
          </div>
          <button
            type="button"
            class="aster-find-icon"
            title={t('find.prev')}
            aria-label={t('find.prev')}
            disabled={!query() || stats().total === 0}
            onClick={stepPrev}
          >
            ↑
          </button>
          <button
            type="button"
            class="aster-find-icon"
            title={t('find.next')}
            aria-label={t('find.next')}
            disabled={!query() || stats().total === 0}
            onClick={stepNext}
          >
            ↓
          </button>
          <button
            type="button"
            class="aster-find-icon"
            title={t('find.close')}
            aria-label={t('find.close')}
            onClick={closeBar}
          >
            ✕
          </button>
        </div>

        <Show when={p.showReplace && !p.readOnly}>
          <div class="aster-find-row is-replace">
            <span class="aster-find-spacer" />
            <div class="aster-find-field">
              <input
                type="text"
                class="aster-find-input"
                placeholder={t('find.replacePlaceholder')}
                value={replacement()}
                onInput={(e) => setReplacement(e.currentTarget.value)}
                on:keydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.metaKey || e.ctrlKey) doReplaceAll();
                    else doReplace();
                  }
                }}
              />
            </div>
            <button
              type="button"
              class="aster-find-act"
              disabled={!query() || stats().total === 0}
              onClick={doReplace}
            >
              {t('find.replaceBtn')}
            </button>
            <button
              type="button"
              class="aster-find-act"
              disabled={!query() || stats().total === 0}
              onClick={doReplaceAll}
            >
              {t('find.replaceAllBtn')}
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
