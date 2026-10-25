import type { CodeFile } from './analysis';

export interface AiChunk {
  code: string;
  visibleLines: Set<number>;
  chars: number;
}

/** Partition every source character into ordered, line-numbered requests. */
export function splitAiFile(file: CodeFile, maxChars: number): AiChunk[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('AI 分片字符数必须是正整数。');
  const chunks: AiChunk[] = [];
  const entries: string[] = [];
  const visibleLines = new Set<number>();
  let chars = 0;
  const flush = (): void => {
    if (!entries.length) return;
    chunks.push({ code: entries.join('\n'), visibleLines: new Set(visibleLines), chars });
    entries.length = 0;
    visibleLines.clear();
    chars = 0;
  };
  const lines = file.content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const source = lines[index] + (index < lines.length - 1 ? '\n' : '');
    let offset = 0;
    if (!source.length) {
      entries.push(`${index + 1}: `);
      visibleLines.add(index + 1);
      continue;
    }
    while (offset < source.length) {
      if (chars === maxChars) flush();
      const fragment = source.slice(offset, offset + maxChars - chars);
      entries.push(`${index + 1}${offset ? ' (续)' : ''}: ${fragment}`);
      visibleLines.add(index + 1);
      chars += fragment.length;
      offset += fragment.length;
    }
  }
  flush();
  return chunks.length ? chunks : [{ code: '1: ', visibleLines: new Set([1]), chars: 0 }];
}
