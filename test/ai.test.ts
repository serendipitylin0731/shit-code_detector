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
      { path: 'app.py', line: 2, category: 'architecture', severity: 3, reason: '无法确认这两个模块的依赖方向，因此可能存在设计问题。' },
      { path: 'app.py', line: 3, category: 'correctness', severity: 3, reason: '返回值与函数名不符，因此没有实际意义。' },
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

test('AI 项目架构不能仅凭无导入和文件名推断缺陷', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const architecture = String(request.messages?.[1]?.content).startsWith('审核项目架构');
    const issues = architecture ? [{ path: '<project>', category: 'architecture', severity: 4,
      reason: 'src/a.py 与 src/b.py 的 imports 为空，两个文件职责孤立，缺乏清晰分层。' }] : [];
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues }) } }] }), { status: 200 });
  };
  try {
    const base = analyze([{ path: 'src/a.py', language: 'Python', content: 'value = 1' },
      { path: 'src/b.py', language: 'Python', content: 'result = 2' }]);
    const result = await analyzeWithAi(base, { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test', maxFiles: 2, maxCharsPerFile: 1000 });
    assert.equal(result.findings.length, 0);
    assert.equal(result.errors.length, 0);
  } finally { globalThis.fetch = original; }
});
