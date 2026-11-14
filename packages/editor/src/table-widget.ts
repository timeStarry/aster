import { EditorSelection } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import {
  parseTableSrc,
  renderTableModel,
  sanitizeCellInput,
  type Align,
  type TableModel,
} from './tables';

/** Minimal inline markdown for table cells: code, bold, italic, strike, highlight, links. Escapes everything else. */
export function inlineCellHtml(src: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const codes: string[] = [];
  let s = src
    .replace(/\\\|/g, '|')
    .replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/==(.+?)==/g, '<mark class="aster-lp-highlight">$1</mark>')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      /^(https?:|mailto:|#|\.{0,2}\/)/i.test(href) ? `<a href="${href}">${label}</a>` : label,
    );
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

interface TableHostState {
  src: string;
  pos: number;
  to: number;
  frozen: boolean;
  model: TableModel;
  activeRow: number;
  activeCol: number;
  editingCell: boolean;
  composing: boolean;
  pendingFocus: { row: number; col: number; selectAll?: boolean } | null;
}

interface TableDOMHost extends HTMLDivElement {
  __st?: TableHostState;
  __syncToolbar?: () => void;
  __rebuildGrid?: () => void;
}

function cloneModel(m: TableModel): TableModel {
  return {
    header: [...m.header],
    align: [...m.align],
    body: m.body.map((r) => [...r]),
  };
}

function getCellText(m: TableModel, row: number, col: number): string {
  return row === 0 ? (m.header[col] ?? '') : (m.body[row - 1]?.[col] ?? '');
}

function setCellText(m: TableModel, row: number, col: number, val: string): void {
  if (row === 0) m.header[col] = val;
  else if (m.body[row - 1]) m.body[row - 1][col] = val;
}

function sameStructure(a: TableModel, b: TableModel): boolean {
  return (
    a.header.length === b.header.length &&
    a.body.length === b.body.length &&
    a.align.every((al, i) => al === b.align[i])
  );
}

function selectElementContents(el: HTMLElement, selectAll: boolean) {
  if (typeof window === 'undefined' || !window.getSelection) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!selectAll) range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export class VisualTableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly pos: number,
    readonly to: number,
    readonly frozen: boolean,
    readonly onEditSource?: (view: EditorView, from: number) => void,
  ) {
    super();
  }

  eq(o: VisualTableWidget): boolean {
    return o.src === this.src && o.pos === this.pos && o.to === this.to && o.frozen === this.frozen;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const host = dom as TableDOMHost;
    const st = host.__st;
    if (!st || st.frozen !== this.frozen) return false;

    const nextModel = parseTableSrc(this.src);
    const prevModel = st.model;
    st.src = this.src;
    st.pos = this.pos;
    st.to = this.to;
    st.model = nextModel;

    // When user is actively typing inside a cell and only that cell's text changed,
    // keep the DOM cell untouched so caret & IME composition never jump.
    const activeEl = document.activeElement as HTMLElement | null;
    if (
      !st.pendingFocus &&
      st.editingCell &&
      activeEl &&
      host.contains(activeEl) &&
      activeEl.dataset.cell === '1' &&
      sameStructure(prevModel, nextModel)
    ) {
      const ar = Number(activeEl.dataset.row ?? -1);
      const ac = Number(activeEl.dataset.col ?? -1);
      let otherChanged = false;
      const totalRows = 1 + nextModel.body.length;
      for (let r = 0; r < totalRows; r++) {
        for (let c = 0; c < nextModel.header.length; c++) {
          if (r === ar && c === ac) continue;
          if (getCellText(prevModel, r, c) !== getCellText(nextModel, r, c)) {
            otherChanged = true;
          }
        }
      }
      if (!otherChanged) {
        host.__syncToolbar?.();
        return true;
      }
    }

    if (host.__rebuildGrid) {
      host.__rebuildGrid();
      view.requestMeasure();
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div') as TableDOMHost;
    wrap.className = 'aster-lp-table';

    const st: TableHostState = {
      src: this.src,
      pos: this.pos,
      to: this.to,
      frozen: this.frozen,
      model: parseTableSrc(this.src),
      activeRow: 0,
      activeCol: 0,
      editingCell: false,
      composing: false,
      pendingFocus: null,
    };
    wrap.__st = st;

    const editable = () => !st.frozen && !view.state.readOnly;

    const dispatchModel = (
      next: TableModel,
      focusTarget?: { row: number; col: number; selectAll?: boolean } | null,
    ) => {
      const rendered = renderTableModel(next);
      const text = rendered.lines.join('\n');
      if (focusTarget !== undefined) st.pendingFocus = focusTarget;
      st.model = next;

      // Compute CodeMirror cursor inside target cell so context-menu tableContext also stays accurate.
      const trRow = Math.max(0, Math.min(focusTarget?.row ?? st.activeRow, next.body.length));
      const trCol = Math.max(0, Math.min(focusTarget?.col ?? st.activeCol, next.header.length - 1));
      const lineIdx = trRow === 0 ? 0 : trRow + 1;
      let base = st.pos;
      for (let i = 0; i < lineIdx; i++) base += rendered.lines[i].length + 1;
      const cellEnd = base + rendered.ends[trRow][trCol];

      if (text === st.src) {
        if (focusTarget) focusCellInDom(focusTarget.row, focusTarget.col, !!focusTarget.selectAll);
        return;
      }

      const prevPos = st.pos;
      const prevTo = st.to;
      st.src = text;
      st.to = prevPos + text.length;

      view.dispatch({
        changes: { from: prevPos, to: prevTo, insert: text },
        selection: EditorSelection.cursor(Math.min(cellEnd, prevPos + text.length)),
        userEvent: 'input.table',
      });
    };

    const toolbar = document.createElement('div');
    toolbar.className = 'aster-lp-table-bar';

    const mkBtn = (label: string, title: string, action: string, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `aster-lp-tbtn ${cls}`.trim();
      b.textContent = label;
      b.title = title;
      b.dataset.action = action;
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!editable()) return;
        runToolbarAction(action);
      });
      return b;
    };

    const btnAlignL = mkBtn('⇤', 'Align left', 'align-left');
    const btnAlignC = mkBtn('⇔', 'Align center', 'align-center');
    const btnAlignR = mkBtn('⇥', 'Align right', 'align-right');
    const btnAddRow = mkBtn('+行', 'Insert row below', 'add-row');
    const btnDelRow = mkBtn('−行', 'Delete row', 'del-row');
    const btnAddCol = mkBtn('+列', 'Insert column right', 'add-col');
    const btnDelCol = mkBtn('−列', 'Delete column', 'del-col');
    const btnSrc = mkBtn('</>', 'Edit Markdown source', 'edit-source', 'is-code');

    const sep1 = document.createElement('span');
    sep1.className = 'aster-lp-tsep';
    const sep2 = document.createElement('span');
    sep2.className = 'aster-lp-tsep';

    toolbar.append(btnAlignL, btnAlignC, btnAlignR, sep1, btnAddRow, btnDelRow, btnAddCol, btnDelCol, sep2, btnSrc);

    const syncToolbar = () => {
      toolbar.hidden = !editable();
      const curAlign: Align = st.model.align[st.activeCol] ?? null;
      btnAlignL.classList.toggle('is-on', curAlign === 'left');
      btnAlignC.classList.toggle('is-on', curAlign === 'center');
      btnAlignR.classList.toggle('is-on', curAlign === 'right');
      btnDelRow.disabled = st.activeRow === 0;
      btnDelCol.disabled = st.model.header.length <= 1;
    };
    wrap.__syncToolbar = syncToolbar;

    const commitFocusedCellIfAny = () => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && wrap.contains(activeEl) && activeEl.dataset.cell === '1') {
        const r = Number(activeEl.dataset.row ?? 0);
        const c = Number(activeEl.dataset.col ?? 0);
        const val = sanitizeCellInput(activeEl.textContent ?? '');
        setCellText(st.model, r, c, val);
      }
    };

    const runToolbarAction = (action: string) => {
      commitFocusedCellIfAny();
      const m = cloneModel(st.model);
      const r = Math.max(0, Math.min(st.activeRow, m.body.length));
      const c = Math.max(0, Math.min(st.activeCol, m.header.length - 1));

      switch (action) {
        case 'align-left':
        case 'align-center':
        case 'align-right': {
          const target: Align =
            action === 'align-left' ? 'left' : action === 'align-center' ? 'center' : 'right';
          m.align[c] = m.align[c] === target ? null : target;
          dispatchModel(m, { row: r, col: c, selectAll: false });
          rebuildGrid();
          break;
        }
        case 'add-row': {
          const insertIdx = r === 0 ? 0 : r;
          m.body.splice(insertIdx, 0, m.header.map(() => ''));
          dispatchModel(m, { row: insertIdx + 1, col: c, selectAll: true });
          rebuildGrid();
          break;
        }
        case 'del-row': {
          if (r === 0) return;
          m.body.splice(r - 1, 1);
          const nextRow = Math.min(r, m.body.length);
          dispatchModel(m, { row: nextRow, col: c, selectAll: false });
          rebuildGrid();
          break;
        }
        case 'add-col': {
          const idx = c + 1;
          m.header.splice(idx, 0, '');
          m.align.splice(idx, 0, null);
          m.body.forEach((row) => row.splice(idx, 0, ''));
          dispatchModel(m, { row: r, col: idx, selectAll: true });
          rebuildGrid();
          break;
        }
        case 'del-col': {
          if (m.header.length <= 1) return;
          m.header.splice(c, 1);
          m.align.splice(c, 1);
          m.body.forEach((row) => row.splice(c, 1));
          const nextCol = Math.min(c, m.header.length - 1);
          dispatchModel(m, { row: r, col: nextCol, selectAll: false });
          rebuildGrid();
          break;
        }
        case 'edit-source': {
          this.onEditSource?.(view, st.pos);
          break;
        }
      }
    };

    const gridShell = document.createElement('div');
    gridShell.className = 'aster-lp-table-shell';

    const tableEl = document.createElement('table');

    const addColHandle = document.createElement('button');
    addColHandle.type = 'button';
    addColHandle.className = 'aster-lp-table-add-col';
    addColHandle.title = 'Add column';
    addColHandle.textContent = '+';
    addColHandle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    addColHandle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editable()) return;
      commitFocusedCellIfAny();
      const m = cloneModel(st.model);
      const newCol = m.header.length;
      m.header.push('');
      m.align.push(null);
      m.body.forEach((row) => row.push(''));
      dispatchModel(m, { row: 0, col: newCol, selectAll: true });
      rebuildGrid();
    });

    const addRowHandle = document.createElement('button');
    addRowHandle.type = 'button';
    addRowHandle.className = 'aster-lp-table-add-row';
    addRowHandle.title = 'Add row';
    addRowHandle.textContent = '+';
    addRowHandle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    addRowHandle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editable()) return;
      commitFocusedCellIfAny();
      const m = cloneModel(st.model);
      m.body.push(m.header.map(() => ''));
      const newRow = m.body.length;
      dispatchModel(m, { row: newRow, col: 0, selectAll: true });
      rebuildGrid();
    });

    const activateCell = (cell: HTMLTableCellElement, row: number, col: number, selectAll = false) => {
      if (!editable()) return;
      st.activeRow = row;
      st.activeCol = col;
      wrap.classList.add('is-editing');
      syncToolbar();

      if (cell.contentEditable !== 'true') {
        st.editingCell = true;
        cell.contentEditable = 'true';
        cell.spellcheck = false;
        cell.textContent = getCellText(st.model, row, col);
      }
      cell.focus({ preventScroll: true });
      selectElementContents(cell, selectAll);
    };

    const focusCellInDom = (row: number, col: number, selectAll = false) => {
      const target = tableEl.querySelector<HTMLTableCellElement>(
        `[data-cell="1"][data-row="${row}"][data-col="${col}"]`,
      );
      if (target) activateCell(target, row, col, selectAll);
    };

    const rebuildGrid = () => {
      tableEl.replaceChildren();
      const m = st.model;
      const cols = m.header.length;
      const allRows = [m.header, ...m.body];

      allRows.forEach((cells, rowIdx) => {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
          const cell = document.createElement(rowIdx === 0 ? 'th' : 'td');
          cell.dataset.cell = '1';
          cell.dataset.row = String(rowIdx);
          cell.dataset.col = String(c);
          const raw = cells[c] ?? '';
          cell.innerHTML = inlineCellHtml(raw);
          if (m.align[c]) cell.style.textAlign = m.align[c]!;

          cell.addEventListener('mousedown', (e) => {
            const anchor = (e.target as HTMLElement).closest('a');
            if (anchor && (st.frozen || e.metaKey || e.ctrlKey)) return;
            if (!editable()) return;
            if (document.activeElement === cell && cell.contentEditable === 'true') return;
            e.preventDefault();
            e.stopPropagation();
            activateCell(cell, rowIdx, c, false);
          });

          cell.addEventListener('compositionstart', () => {
            st.composing = true;
          });
          cell.addEventListener('compositionend', () => {
            st.composing = false;
            const next = cloneModel(st.model);
            setCellText(next, rowIdx, c, sanitizeCellInput(cell.textContent ?? ''));
            dispatchModel(next, null);
          });

          cell.addEventListener('input', () => {
            if (st.composing || !editable()) return;
            st.editingCell = true;
            const next = cloneModel(st.model);
            setCellText(next, rowIdx, c, sanitizeCellInput(cell.textContent ?? ''));
            dispatchModel(next, null);
          });

          cell.addEventListener('blur', () => {
            if (cell.contentEditable === 'true') {
              const latest = sanitizeCellInput(cell.textContent ?? '');
              cell.contentEditable = 'false';
              cell.innerHTML = inlineCellHtml(latest);
            }
            // Defer check so tabbing between cells keeps `.is-editing` smooth
            queueMicrotask(() => {
              if (!wrap.contains(document.activeElement)) {
                st.editingCell = false;
                wrap.classList.remove('is-editing');
              }
            });
          });

          cell.addEventListener('keydown', (e) => {
            if (st.composing) return;
            if (e.key === 'Tab') {
              e.preventDefault();
              e.stopPropagation();
              const next = cloneModel(st.model);
              setCellText(next, rowIdx, c, sanitizeCellInput(cell.textContent ?? ''));
              const totalRows = 1 + next.body.length;
              if (!e.shiftKey) {
                if (c + 1 < cols) {
                  dispatchModel(next, null);
                  focusCellInDom(rowIdx, c + 1, true);
                } else if (rowIdx + 1 < totalRows) {
                  dispatchModel(next, null);
                  focusCellInDom(rowIdx + 1, 0, true);
                } else {
                  next.body.push(next.header.map(() => ''));
                  dispatchModel(next, { row: totalRows, col: 0, selectAll: true });
                  rebuildGrid();
                }
              } else {
                dispatchModel(next, null);
                if (c > 0) focusCellInDom(rowIdx, c - 1, true);
                else if (rowIdx > 0) focusCellInDom(rowIdx - 1, cols - 1, true);
              }
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              const next = cloneModel(st.model);
              setCellText(next, rowIdx, c, sanitizeCellInput(cell.textContent ?? ''));
              const totalRows = 1 + next.body.length;
              if (rowIdx + 1 < totalRows) {
                dispatchModel(next, null);
                focusCellInDom(rowIdx + 1, c, true);
              } else {
                next.body.push(next.header.map(() => ''));
                dispatchModel(next, { row: totalRows, col: c, selectAll: true });
                rebuildGrid();
              }
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cell.blur();
              view.dispatch({ selection: EditorSelection.cursor(Math.min(st.to, view.state.doc.length)) });
              view.focus();
            }
          });

          tr.appendChild(cell);
        }
        (rowIdx === 0 ? tableEl.createTHead() : (tableEl.tBodies[0] ?? tableEl.createTBody())).appendChild(tr);
      });

      addColHandle.hidden = !editable();
      addRowHandle.hidden = !editable();
      syncToolbar();

      if (st.pendingFocus) {
        const pf = st.pendingFocus;
        st.pendingFocus = null;
        focusCellInDom(pf.row, pf.col, !!pf.selectAll);
      }
    };

    wrap.__rebuildGrid = rebuildGrid;
    rebuildGrid();

    gridShell.append(tableEl, addColHandle);
    wrap.append(toolbar, gridShell, addRowHandle);
    return wrap;
  }

  ignoreEvent(e: Event): boolean {
    // Allow link click handler at EditorView level only when clicking an anchor in Read mode or with Mod key
    if (e.type === 'click') {
      const target = e.target as HTMLElement | null;
      if (target?.closest('a')) return false;
    }
    return true;
  }
}
