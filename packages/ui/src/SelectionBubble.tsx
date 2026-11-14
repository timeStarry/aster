import { Show, createSignal, createEffect } from 'solid-js';
import type { EditorView } from '@codemirror/view';
import { toggleInline, insertLink } from '@aster/editor';
import { t } from './i18n';

export interface SelectionBubbleProps {
  view: () => EditorView | null;
  visible: boolean;
  /** Bumped whenever pointer selection finishes so bubble recalculates coordinates. */
  rev: number;
  onDismiss: () => void;
}

export function SelectionBubble(p: SelectionBubbleProps) {
  const [coords, setCoords] = createSignal<{ left: number; top: number; flipped: boolean } | null>(null);

  createEffect(() => {
    void p.rev;
    if (!p.visible) {
      setCoords(null);
      return;
    }
    const view = p.view();
    if (!view) {
      setCoords(null);
      return;
    }
    const sel = view.state.selection.main;
    if (sel.empty || view.state.selection.ranges.length > 1) {
      setCoords(null);
      return;
    }
    const hostEl = view.dom.closest('.aster-main') as HTMLElement | null;
    if (!hostEl) return;
    const hostRect = hostEl.getBoundingClientRect();
    let start: { left: number; right: number; top: number; bottom: number } | null = null;
    let end: { left: number; right: number; top: number; bottom: number } | null = null;
    try {
      start = view.coordsAtPos(sel.from);
      end = view.coordsAtPos(sel.to, -1);
    } catch {
      start = null;
      end = null;
    }
    if (!start || !end) {
      setCoords(null);
      return;
    }

    const minX = Math.min(start.left, end.left);
    const maxX = Math.max(start.right, end.right);
    const centerX = (minX + maxX) / 2 - hostRect.left;
    const clampedLeft = Math.max(132, Math.min(hostRect.width - 132, centerX));
    const topAnchor = Math.min(start.top, end.top) - hostRect.top;
    const bottomAnchor = Math.max(start.bottom, end.bottom) - hostRect.top;
    const flipped = topAnchor < 46;

    setCoords({
      left: clampedLeft,
      top: flipped ? bottomAnchor + 8 : topAnchor - 8,
      flipped,
    });
  });

  const apply = (fn: (v: EditorView) => boolean) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const view = p.view();
    if (!view) return;
    fn(view);
    view.focus();
    p.onDismiss();
  };

  return (
    <Show when={p.visible && coords()}>
      {(pos) => (
        <div
          class="aster-sel-bubble"
          classList={{ 'is-below': pos().flipped }}
          role="toolbar"
          aria-label={t('sc.formatting')}
          style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button type="button" class="aster-bub-btn is-bold" title={t('sc.bold')} onClick={apply(toggleInline('**'))}>
            B
          </button>
          <button type="button" class="aster-bub-btn is-italic" title={t('sc.italic')} onClick={apply(toggleInline('*'))}>
            I
          </button>
          <button type="button" class="aster-bub-btn is-strike" title={t('sc.strike')} onClick={apply(toggleInline('~~'))}>
            S
          </button>
          <button type="button" class="aster-bub-btn is-mark" title={t('sc.highlight')} onClick={apply(toggleInline('=='))}>
            H
          </button>
          <span class="aster-bub-sep" />
          <button type="button" class="aster-bub-btn is-mono" title={t('sc.code')} onClick={apply(toggleInline('`'))}>
            {'<>'}
          </button>
          <button type="button" class="aster-bub-btn is-math" title={t('sc.inlineMath')} onClick={apply(toggleInline('$'))}>
            ∑
          </button>
          <button type="button" class="aster-bub-btn" title={t('sc.link')} onClick={apply(insertLink)}>
            🔗
          </button>
        </div>
      )}
    </Show>
  );
}
