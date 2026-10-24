import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze } from '../src/analysis';
import { analyzeWithAi } from '../src/ai';

test('AI 仅接受合法证据、严重度和选定文件路径', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues: [
      { path: 'app.py', line: 1, category: 'readability', severity: 3, reason: '函数把网络请求与文件写入耦合在一起，难以独立测试。' },
      { path: 'other.py', line: 1, category: 'readability', severity: 5, reason: '不存在的文件不应被评分。' },
      { path: 'app.py', line: 1, category: 'readability', severity: 9, reason: '严重度超出范围，不应计分。' }
    ] }) } }]
    }), { status: 200 });
  };
  try {
    const base = analyze([{ path: 'app.py', language: 'Python', content: 'def run():\n    pass' }], [], false);
    const result = await analyzeWithAi(base, { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test', maxFiles: 1, maxCharsPerFile: 1000 }, false);
    assert.equal(result.reviewedFiles, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].points, 6);
    assert.equal(analyze(base.files, result.findings, false).score, 6);
  } finally {
    globalThis.fetch = original;
  }
});

test('AI 不重复计入本地已发现的缩进问题', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues: [
      { path: 'main.py', line: 2, category: 'consistency', severity: 4, reason: '第 2 行混用 Tab 和空格缩进，会造成阅读与运行问题。' }
    ] }) } }]
  }), { status: 200 });
  try {
    const base = analyze([{ path: 'main.py', language: 'Python', content: 'if True:\n \tpass' }], [], false);
    const ai = await analyzeWithAi(base, { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test', maxFiles: 1, maxCharsPerFile: 1000 }, false);
    assert.equal(ai.findings.length, 0);
  } finally { globalThis.fetch = original; }
});
