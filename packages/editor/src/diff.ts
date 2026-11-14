export interface MinimalChange {
  from: number;
  to: number;
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Compute the minimal contiguous `{ from, to, insert }` replacement between `oldText`
 * and `newText` without splitting UTF-16 surrogate pairs.
 *
 * Dispatching this single change into CodeMirror preserves cursor offsets outside the
 * edited span, avoids scroll resets, and records one clean `⌘Z`-undoable history step.
 */
export function computeMinimalChange(oldText: string, newText: string): MinimalChange | null {
  if (oldText === newText) return null;

  const minLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  // Never split a surrogate pair at the end of the common prefix
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) {
    prefix--;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  // Never split a surrogate pair at the start of the common suffix
  if (oldEnd < oldText.length && isLowSurrogate(oldText.charCodeAt(oldEnd))) {
    oldEnd++;
    newEnd++;
  }

  return {
    from: prefix,
    to: oldEnd,
    insert: newText.slice(prefix, newEnd),
  };
}
