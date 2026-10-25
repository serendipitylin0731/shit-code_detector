import assert from 'node:assert/strict';
import test from 'node:test';
import { splitAiFile } from '../src/aiChunks';

test('代码分片完整覆盖跨行和超长单行，保留原始行号', () => {
  const content = 'ab\r\n' + 'x'.repeat(2500) + '\nlast\n';
  const chunks = splitAiFile({ path: 'large.ts', language: 'TypeScript', content }, 1000);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.chars, 0), content.length);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every(chunk => chunk.chars <= 1000));
  assert.ok(chunks.some(chunk => chunk.visibleLines.has(2) && chunk.code.includes('(续)')));
  assert.ok(chunks.at(-1)?.visibleLines.has(3));
});
