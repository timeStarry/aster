import { expect, it } from 'vitest';
import { createEditor } from '../src/index';

it('preserves newlines and blank lines when syntax highlighting replaces plain code', async () => {
  const body = 'const greeting = "Hello";\n\nconsole.log(greeting);\n';
  const el = document.body.appendChild(document.createElement('div'));
  const editor = createEditor(el, { initialContent: `cursor\n\n\`\`\`javascript\n${body}\`\`\`\n` });
  try {
    await expect.poll(() => el.querySelector('.tok-keyword')?.textContent).toBe('const');
    expect(el.querySelector('.aster-lp-codeblock code')?.textContent).toBe(body.trimEnd());
  } finally {
    editor.destroy();
    el.remove();
  }
});
