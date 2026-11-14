import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertTableCmd } from '@aster/editor';
import { t, lang } from './i18n';

export interface SlashItem {
  id: string;
  icon: string;
  labelEn: string;
  labelZh: string;
  hint: string;
  keywords: string[];
  insert: (view: EditorView, replaceFrom: number, replaceTo: number) => void;
}

function replaceSlashWith(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  cursorDelta = text.length,
) {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + cursorDelta),
    scrollIntoView: true,
    userEvent: 'input.slash',
  });
  view.focus();
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'h1',
    icon: 'H1',
    labelEn: 'Heading 1',
    labelZh: '一级标题',
    hint: '# ',
    keywords: ['h1', 'heading1', 'title', '标题', '一级'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '# '),
  },
  {
    id: 'h2',
    icon: 'H2',
    labelEn: 'Heading 2',
    labelZh: '二级标题',
    hint: '## ',
    keywords: ['h2', 'heading2', 'subtitle', '标题', '二级'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '## '),
  },
  {
    id: 'h3',
    icon: 'H3',
    labelEn: 'Heading 3',
    labelZh: '三级标题',
    hint: '### ',
    keywords: ['h3', 'heading3', '标题', '三级'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '### '),
  },
  {
    id: 'bullet',
    icon: '•',
    labelEn: 'Bullet list',
    labelZh: '无序列表',
    hint: '- ',
    keywords: ['bullet', 'ul', 'list', '列表', '无序'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '- '),
  },
  {
    id: 'ordered',
    icon: '1.',
    labelEn: 'Numbered list',
    labelZh: '有序列表',
    hint: '1. ',
    keywords: ['ordered', 'ol', 'number', '有序', '编号'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '1. '),
  },
  {
    id: 'task',
    icon: '☑',
    labelEn: 'Task list',
    labelZh: '任务列表',
    hint: '- [ ]',
    keywords: ['task', 'todo', 'check', '任务', '待办'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '- [ ] '),
  },
  {
    id: 'table',
    icon: '⊞',
    labelEn: 'Table',
    labelZh: '表格',
    hint: '3×2',
    keywords: ['table', 'grid', '表格'],
    insert: (v, f, to) => {
      v.dispatch({
        changes: { from: f, to, insert: '' },
        selection: EditorSelection.cursor(f),
      });
      insertTableCmd(3, 2)(v);
      v.focus();
    },
  },
  {
    id: 'code',
    icon: '</>',
    labelEn: 'Code block',
    labelZh: '代码块',
    hint: '```',
    keywords: ['code', 'fence', '代码块', '代码'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '```\n\n```', 3),
  },
  {
    id: 'math',
    icon: '∑',
    labelEn: 'Math block',
    labelZh: '数学公式块',
    hint: '$$',
    keywords: ['math', 'katex', 'latex', 'equation', '公式', '数学'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '$$\n\n$$', 3),
  },
  {
    id: 'mermaid',
    icon: '◇',
    labelEn: 'Mermaid diagram',
    labelZh: 'Mermaid 流程图',
    hint: 'mermaid',
    keywords: ['mermaid', 'diagram', 'chart', 'flow', '图表', '流程图'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '```mermaid\ngraph LR\n  A --> B\n```', 11),
  },
  {
    id: 'callout',
    icon: 'ℹ',
    labelEn: 'Callout',
    labelZh: '提示卡片',
    hint: '> [!NOTE]',
    keywords: ['callout', 'note', 'tip', 'warning', 'alert', '提示', '卡片'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '> [!NOTE]\n> '),
  },
  {
    id: 'quote',
    icon: '❝',
    labelEn: 'Quote',
    labelZh: '引用',
    hint: '> ',
    keywords: ['quote', 'blockquote', '引用'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '> '),
  },
  {
    id: 'hr',
    icon: '―',
    labelEn: 'Divider',
    labelZh: '分隔线',
    hint: '---',
    keywords: ['hr', 'divider', 'line', 'rule', '分隔线'],
    insert: (v, f, to) => replaceSlashWith(v, f, to, '---\n'),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.id.includes(q) ||
      item.labelEn.toLowerCase().includes(q) ||
      item.labelZh.includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}

export interface SlashTriggerState {
  lineFrom: number;
  lineTo: number;
  query: string;
}

export interface SlashMenuProps {
  view: () => EditorView | null;
  trigger: SlashTriggerState | null;
  onClose: () => void;
}

export function SlashMenu(p: SlashMenuProps) {
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null);

  const items = createMemo(() => (p.trigger ? filterSlashItems(p.trigger.query) : []));

  createEffect(() => {
    void p.trigger?.query;
    setSelectedIdx(0);
  });

  createEffect(() => {
    const trig = p.trigger;
    const view = p.view();
    if (!trig || !view || items().length === 0) {
      setPos(null);
      return;
    }
    const hostEl = view.dom.closest('.aster-main') as HTMLElement | null;
    if (!hostEl) return;
    const hostRect = hostEl.getBoundingClientRect();
    let c: { left: number; bottom: number } | null = null;
    try {
      c = view.coordsAtPos(trig.lineFrom);
    } catch {
      c = null;
    }
    if (!c) {
      setPos({ left: 32, top: 48 });
      return;
    }
    const left = Math.max(16, Math.min(Math.max(16, hostRect.width - 248), c.left - hostRect.left));
    const top = Math.min(Math.max(8, hostRect.height - 260), c.bottom - hostRect.top + 6);
    setPos({ left, top: Math.max(8, top) });
  });

  const pick = (item: SlashItem) => {
    const view = p.view();
    const trig = p.trigger;
    if (!view || !trig) return;
    item.insert(view, trig.lineFrom, trig.lineTo);
    p.onClose();
  };

  // Expose keyboard navigation to editor capture handler when menu has matches
  createEffect(() => {
    if (!p.trigger || items().length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (list.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => (i + 1) % list.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => (i - 1 + list.length) % list.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        pick(list[selectedIdx()] ?? list[0]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  return (
    <Show when={p.trigger && items().length > 0 && pos()}>
      {(coords) => (
        <div
          class="aster-slash-menu"
          role="listbox"
          aria-label={t('ctx.insert')}
          style={{ left: `${coords().left}px`, top: `${coords().top}px` }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <For each={items()}>
            {(item, idx) => (
              <button
                type="button"
                role="option"
                aria-selected={idx() === selectedIdx()}
                class="aster-slash-item"
                classList={{ 'is-active': idx() === selectedIdx() }}
                onMouseEnter={() => setSelectedIdx(idx())}
                onClick={() => pick(item)}
              >
                <span class="aster-slash-icon">{item.icon}</span>
                <span class="aster-slash-label">{lang() === 'zh' ? item.labelZh : item.labelEn}</span>
                <span class="aster-slash-hint">{item.hint}</span>
              </button>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
