import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import type { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import {
  toggleInline, insertLink, setHeading, toggleLinePrefix, insertCodeBlock,
  insertTableCmd, tableCommand, tableContext, type TableOp,
} from '@aster/editor';
import { t } from './i18n';

/**
 * Shortcut hints shown next to items. The editor keymap handles the keys
 * themselves; a context menu's accelerators only fire while it is open.
 */
const K = (k: string) => `CmdOrCtrl+${k}`;

type Run = (view: EditorView) => boolean;

function insertBlock(text: string, cursorOffset: number): Run {
  return (view) => {
    if (view.state.readOnly) return false;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const lead = line.text.trim() === '' ? '' : '\n\n';
    const at = line.text.trim() === '' ? line.from : line.to;
    view.dispatch({
      changes: { from: at, to: line.text.trim() === '' ? line.to : at, insert: lead + text },
      selection: EditorSelection.cursor(at + lead.length + cursorOffset),
      scrollIntoView: true,
      userEvent: 'input.insert',
    });
    return true;
  };
}

export interface ContextMenuOptions {
  view: EditorView;
  readOnly: boolean;
  /** Fenced languages a plugin can render, e.g. ['math', 'mermaid']. */
  renderable: string[];
  x: number;
  y: number;
}

/**
 * Editor right-click menu: clipboard, formatting, paragraph type, insert
 * (including sized tables), and table editing when the cursor is in a table.
 * Built as a native menu so it looks and behaves like the OS menus.
 */
export async function showEditorContextMenu(o: ContextMenuOptions): Promise<void> {
  const { view } = o;
  const run = (fn: Run) => () => { fn(view); view.focus(); };
  const ro = o.readOnly;
  const item = (text: string, fn: Run, accelerator?: string, enabled = !ro) =>
    MenuItem.new({ text, enabled, accelerator, action: run(fn) });
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' });

  const format = await Submenu.new({
    text: t('sc.formatting'),
    enabled: !ro,
    items: await Promise.all([
      item(t('sc.bold'), toggleInline('**'), K('B')),
      item(t('sc.italic'), toggleInline('*'), K('I')),
      item(t('sc.strike'), toggleInline('~~'), K('Shift+X')),
      item(t('sc.code'), toggleInline('`'), K('E')),
      item(t('sc.link'), insertLink, K('K')),
    ]),
  });

  const paragraph = await Submenu.new({
    text: t('ctx.paragraph'),
    enabled: !ro,
    items: await Promise.all([
      item(t('ctx.paragraph'), setHeading(0), K('0')),
      ...[1, 2, 3, 4, 5, 6].map((n) => item(t('ctx.heading', { n }), setHeading(n), K(String(n)))),
      sep(),
      item(t('ctx.bullet'), toggleLinePrefix('bullet'), K('Shift+8')),
      item(t('ctx.ordered'), toggleLinePrefix('ordered'), K('Shift+7')),
      item(t('ctx.task'), toggleLinePrefix('task'), K('Shift+9')),
      item(t('ctx.quote'), toggleLinePrefix('quote'), K('Shift+.')),
    ]),
  });

  // Table sizes as a short grid of common shapes: columns × body rows.
  const sizes: [number, number][] = [[2, 2], [3, 3], [4, 4], [3, 5], [5, 3], [6, 6]];
  const tableSub = await Submenu.new({
    text: t('ctx.insertTable'),
    enabled: !ro,
    items: await Promise.all(sizes.map(([c, r]) => item(`${c} × ${r}`, insertTableCmd(c, r)))),
  });
  const insertItems = [
    tableSub,
    await item(t('ctx.codeBlock'), insertCodeBlock, K('Alt+C')),
    await item(t('ctx.horizontalRule'), insertBlock('---\n', 4)),
  ];
  if (o.renderable.includes('math')) insertItems.push(await item(t('ctx.mathBlock'), insertBlock('```math\n\n```\n', 8)));
  if (o.renderable.includes('mermaid')) insertItems.push(await item(t('ctx.mermaidBlock'), insertBlock('```mermaid\ngraph LR\n  A --> B\n```\n', 11)));
  const insert = await Submenu.new({ text: t('ctx.insert'), enabled: !ro, items: insertItems });

  const top: (MenuItem | Submenu | PredefinedMenuItem)[] = [];
  const ctx = tableContext(view.state);
  if (ctx) {
    const op = (k: TableOp) => tableCommand(k);
    const table = await Submenu.new({
      text: t('ctx.table'),
      enabled: !ro,
      items: await Promise.all([
        item(t('ctx.rowAbove'), op('rowAbove')),
        item(t('ctx.rowBelow'), op('rowBelow')),
        item(t('ctx.colLeft'), op('colLeft')),
        item(t('ctx.colRight'), op('colRight')),
        sep(),
        item(t('ctx.deleteRow'), op('deleteRow'), undefined, !ro && ctx.row > 0),
        item(t('ctx.deleteCol'), op('deleteCol'), undefined, !ro && ctx.cols > 1),
        sep(),
        item(t('ctx.alignLeft'), op('alignLeft')),
        item(t('ctx.alignCenter'), op('alignCenter')),
        item(t('ctx.alignRight'), op('alignRight')),
        item(t('ctx.alignNone'), op('alignNone')),
        sep(),
        item(t('ctx.formatTable'), op('format')),
        item(t('ctx.deleteTable'), op('deleteTable')),
      ]),
    });
    top.push(table, await sep());
  }

  top.push(
    await PredefinedMenuItem.new({ item: 'Cut', text: t('ctx.cut') }),
    await PredefinedMenuItem.new({ item: 'Copy', text: t('ctx.copy') }),
    await PredefinedMenuItem.new({ item: 'Paste', text: t('ctx.paste') }),
    await sep(),
    format,
    paragraph,
    insert,
    await sep(),
    await PredefinedMenuItem.new({ item: 'SelectAll', text: t('ctx.selectAll') }),
  );

  const menu = await Menu.new({ items: top });
  await menu.popup();
}
