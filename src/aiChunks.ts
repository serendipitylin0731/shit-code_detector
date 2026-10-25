import type { CodeFile } from './analysis';

export interface AiChunk {
  code: string;
  visibleLines: Set<number>;
  chars: number;
}

/** Partition every source character into ordered, line-numbered requests. */
export function splitAiFile(file: CodeFile, maxChars: number): AiChunk[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 16) throw new Error('AI 分片字符数必须至少为 16。');
  const chunks: AiChunk[] = [];
  const entries: string[] = [];
  const visibleLines = new Set<number>();
  let chars = 0;
  let payloadChars = 0;
  const flush = (): void => {
    if (!entries.length) return;
    chunks.push({ code: entries.join('\n'), visibleLines: new Set(visibleLines), chars });
    entries.length = 0;
    visibleLines.clear();
    chars = 0;
    payloadChars = 0;
  };
  const lines = file.content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const source = lines[index] + (index < lines.length - 1 ? '\n' : '');
    let offset = 0;
    if (!source.length) {
      const label = `${index + 1}: `;
      if (entries.length && payloadChars + label.length + 1 > maxChars) flush();
      entries.push(label);
      visibleLines.add(index + 1);
      payloadChars += label.length + (entries.length > 1 ? 1 : 0);
      continue;
    }
    while (offset < source.length) {
      const label = `${index + 1}${offset ? ' (续)' : ''}: `;
      if (entries.length && payloadChars + label.length + 2 > maxChars) flush();
      const separator = entries.length ? 1 : 0;
      const fragment = source.slice(offset, offset + maxChars - payloadChars - separator - label.length);
      entries.push(label + fragment);
      visibleLines.add(index + 1);
      chars += fragment.length;
      payloadChars += separator + label.length + fragment.length;
      offset += fragment.length;
    }
  }
  flush();
  return chunks.length ? chunks : [{ code: '1: ', visibleLines: new Set([1]), chars: 0 }];
}
