import { afterEach, expect, it } from 'vitest';
import { createEditor, type AsterEditor } from '../src/index';

const editors: AsterEditor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

it('opens mixed Markdown with heading gutters and retains the document across mode changes', () => {
  const doc = '# Windows **走测**\n\n正文\n\n## Markdown\n\n> 引用\n\n- [ ] 任务\n\n| 项目 | 值 |\n| --- | --- |\n| 平台 | Windows |\n\n```math\nE=mc^2\n```\n\n## 完成\n\n结束';
  const editor = createEditor(document.body.appendChild(document.createElement('div')), {
    initialContent: doc,
    settings: { lineNumbers: true },
  });
  editors.push(editor);
  expect(editor.getContent()).toBe(doc);
  expect(editor.view.dom.querySelectorAll('.aster-gutter-heading')).toHaveLength(3);
  editor.setMode('source');
  expect(editor.getContent()).toBe(doc);
  editor.setMode('live');
  expect(editor.getContent()).toBe(doc);
  expect(editor.view.dom.querySelectorAll('.aster-gutter-heading')).toHaveLength(3);
});
