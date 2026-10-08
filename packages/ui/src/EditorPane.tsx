import { onMount, onCleanup, createEffect } from 'solid-js';
import { createEditor, AsterEditor } from '@aster/editor';
import type { EditorMode } from '@aster/editor';
import { createDefaultPipeline } from '@aster/renderer';

interface Props {
  content: string;
  mode: EditorMode;
  onContentChange: (c: string) => void;
}

const pipeline = createDefaultPipeline();

export function EditorPane(props: Props) {
  let editorContainer!: HTMLDivElement;
  let readingContainer!: HTMLDivElement;
  let editor: AsterEditor | null = null;

  onMount(() => {
    editor = createEditor(editorContainer, {
      initialContent: props.content,
      mode: props.mode === 'reading' ? 'source' : props.mode,
      onContentChange: props.onContentChange,
    });
  });

  createEffect(() => {
    if (!editor) return;
    if (props.mode === 'reading') {
      editor.view.dom.style.display = 'none';
      readingContainer.style.display = 'block';
      readingContainer.innerHTML = pipeline.render(props.content);
    } else {
      editor.view.dom.style.display = '';
      readingContainer.style.display = 'none';
      editor.setMode(props.mode);
    }
  });

  onCleanup(() => editor?.destroy());

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <div
        ref={editorContainer}
        style={{ height: '100%', 'font-family': 'var(--font-editor)', 'font-size': '15px', padding: '16px' }}
      />
      <div
        ref={readingContainer}
        style={{
          display: 'none',
          height: '100%',
          overflow: 'auto',
          padding: '32px 16px',
          'max-width': 'var(--prose-width)',
          margin: '0 auto',
          'font-family': 'var(--font-prose)',
          'line-height': '1.7',
        }}
      />
    </div>
  );
}
