export interface TocEntry { level: number; text: string; id: string; }

export function extractToc(html: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const re = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1], 10);
    const text = m[2].replace(/<[^>]+>/g, '');
    const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    entries.push({ level, text, id });
  }
  return entries;
}
