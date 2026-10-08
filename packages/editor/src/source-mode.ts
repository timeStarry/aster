import { Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

/** Source mode: syntax highlighting only, no decorations. */
export function sourceModeExtension(): Extension {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(defaultHighlightStyle),
  ];
}
