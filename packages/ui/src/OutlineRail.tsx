import { For, Show, createMemo, createSignal } from 'solid-js';
import type { OutlineItem } from '@aster/editor';
import { t } from './i18n';

interface Props {
  items: OutlineItem[];
  /** Visible document range; dashes for headings whose section overlaps it are darker. */
  visFrom: number;
  visTo: number;
  /** Cursor position; the last heading at or before it is the current section. */
  cursor: number;
  /** Faded out (user is typing and the pointer is away from the rail). */
  hidden: boolean;
  onJump: (from: number) => void;
}

/** Dash length per heading level. */
const WIDTH: Record<number, number> = { 1: 22, 2: 15, 3: 9 };

/**
 * Heading navigator: H1–H3 as right-aligned dashes of different lengths.
 * Sections in view are darker; the current section is near-black. Hovering
 * magnifies the dash and its neighbours (fisheye) and shows the title, with
 * the adjacent titles in muted type. Click or Enter jumps to the heading.
 */
export function OutlineRail(props: Props) {
  const [hovered, setHovered] = createSignal(-1);
  const [tipTop, setTipTop] = createSignal(0);
  let track!: HTMLDivElement;

  const current = createMemo(() => {
    let i = -1;
    for (let k = 0; k < props.items.length; k++) {
      if (props.items[k].from <= props.cursor) i = k;
      else break;
    }
    return i;
  });

  const inView = (i: number) => {
    const from = props.items[i].from;
    const end = props.items[i + 1]?.from ?? Infinity;
    return from <= props.visTo && end > props.visFrom;
  };

  function hover(i: number, el: HTMLElement) {
    setHovered(i);
    setTipTop(el.offsetTop + el.offsetHeight / 2);
  }

  function onKey(e: KeyboardEvent, i: number) {
    const dashes = [...track.querySelectorAll<HTMLElement>('.aster-rail-dash')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      dashes[Math.max(0, Math.min(dashes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (e.key === 'Home') { e.preventDefault(); dashes[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); dashes[dashes.length - 1]?.focus(); }
  }

  const tip = () => {
    const i = hovered();
    if (i < 0 || !props.items[i]) return null;
    return { prev: props.items[i - 1], cur: props.items[i], next: props.items[i + 1] };
  };

  return (
    <nav
      class="aster-rail"
      classList={{ 'is-hidden': props.hidden && hovered() < 0 }}
      aria-label={t('rail.label')}
    >
      <div class="aster-rail-track" ref={track} onMouseLeave={() => setHovered(-1)}>
        <For each={props.items}>
          {(h, i) => {
            const dist = () => (hovered() < 0 ? 99 : Math.abs(i() - hovered()));
            return (
              <button
                type="button"
                class="aster-rail-dash"
                classList={{
                  'is-current': i() === current(),
                  'is-visible': i() !== current() && inView(i()),
                  'is-hover': dist() === 0,
                  'is-near': dist() === 1,
                  'is-near2': dist() === 2,
                }}
                style={{ '--w': `${WIDTH[h.level] ?? 9}px` }}
                aria-label={h.text}
                aria-current={i() === current() ? 'location' : undefined}
                onMouseEnter={(e) => hover(i(), e.currentTarget)}
                onFocus={(e) => hover(i(), e.currentTarget)}
                onBlur={() => setHovered(-1)}
                onClick={() => props.onJump(h.from)}
                onKeyDown={(e) => onKey(e, i())}
              >
                <span class="aster-rail-bar" />
              </button>
            );
          }}
        </For>
        <Show when={tip()}>
          {(tp) => (
            <div class="aster-rail-tip" style={{ top: `${tipTop()}px` }} aria-hidden="true">
              <Show when={tp().prev}><div class="aster-rail-nb">{tp().prev!.text}</div></Show>
              <div class="aster-rail-cur">{tp().cur.text}</div>
              <Show when={tp().next}><div class="aster-rail-nb">{tp().next!.text}</div></Show>
            </div>
          )}
        </Show>
      </div>
    </nav>
  );
}
