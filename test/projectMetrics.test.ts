import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, CodeFile, languageOf } from '../src/analysis';
import { analyzeInWorker } from '../src/analyzeAsync';
import { fileScores } from '../src/dashboardData';

const file = (name: string, content: string): CodeFile => ({ path: name, language: languageOf(name)!, content });

test('JS/TS 与 Python 复杂度和明确吞错计分，不因参数数量或宽泛捕获误判', () => {
  const js = file('src/branch.ts', `function calculate(a,b,c,d,e,f,g) {
${Array.from({ length: 11 }, (_, index) => `  if (a > ${index}) a += ${index};`).join('\n')}
  try { return a; } catch (error) {}
}`);
  const py = file('src/branch.py', `def calculate(a, b, c, d, e, f, g):
${Array.from({ length: 11 }, (_, index) => `    if a > ${index}: a += ${index}`).join('\n')}
    try:
        return a
    except:
        pass
`);
  const result = analyze([js, py], [], false);
  for (const name of ['src/branch.ts', 'src/branch.py']) {
    const rules = new Set(result.findings.filter(item => item.path === name).map(item => item.rule));
    assert.ok(!rules.has('many-parameters'), name);
    assert.ok(rules.has('cyclomatic-complexity') || rules.has('cognitive-complexity'), name);
    assert.ok(rules.has('swallowed-error'), name);
  }
  assert.ok(!result.findings.some(item => item.rule === 'broad-except'), '单个异常处理缺陷不重复计分');
  const broad = analyze([file('src/broad.py', 'try:\n    work()\nexcept Exception:\n    recover()\n')], [], false);
  assert.ok(!broad.findings.some(item => item.rule === 'broad-except'));
  const nested = analyze([file('src/deep.py', 'def f(x):\n    if x:\n        if x:\n            if x:\n                if x:\n                    if x:\n                        return x\n')], [], false);
  assert.ok(nested.findings.some(item => item.rule === 'control-nesting' || item.rule === 'cognitive-complexity'));
});

test('重复块跨文件查找，导入环仅在项目模式计分', () => {
  const block = ['const apple = calculatePrice(orders, tax);', 'const banana = normalizeItem(apple, locale);',
    'const cherry = serializeItem(banana, options);', 'const delta = sendRequest(cherry, client);',
    'const echo = parseResponse(delta, decoder);', 'const result = validateOutput(echo, schema);'].join('\n');
  const files = [file('src/a.ts', `import { b } from './b';\n${block}\nexport const a = b;`),
    file('src/b.ts', `import { a } from './a';\n${block}\nexport const b = a;`)];
  const project = analyze(files);
  assert.equal(project.findings.filter(item => item.rule === 'duplicate-block').length, 1);
  assert.equal(project.findings.filter(item => item.rule === 'import-cycle').length, 1);
  assert.ok(project.findings.find(item => item.rule === 'import-cycle')!.message.includes('src/a.ts'));
  const selected = analyze(files, [], false);
  assert.equal(selected.findings.filter(item => item.rule === 'import-cycle').length, 0);
  assert.equal(selected.findings.filter(item => item.rule === 'duplicate-block').length, 1);
  const ranking = fileScores(project.findings, files);
  assert.ok(ranking[0].score >= ranking[1].score);
  assert.ok(ranking.reduce((sum, item) => sum + item.score, 0) >= project.score, '文件排序使用未聚合的问题权重');
  const typeOnly = [file('src/a.ts', "import type { B } from './b';\nexport type A = B;"),
    file('src/b.ts', "import type { A } from './a';\nexport type B = A;")];
  assert.equal(analyze(typeOnly).findings.filter(item => item.rule === 'import-cycle').length, 0);
});

test('短片段和测试文件不产生重复块误报', () => {
  const repeated = 'const result = true;\nreturn result;';
  const result = analyze([file('src/a.ts', repeated), file('src/b.ts', repeated), file('test/a.test.ts', repeated)]);
  assert.ok(!result.findings.some(item => item.rule === 'duplicate-block'));
});

test('Python 导入环忽略 TYPE_CHECKING 与包入口转发', () => {
  const files = [file('pkg/a.py', 'from .b import value\n'), file('pkg/b.py', 'from .a import value\n')];
  assert.equal(analyze(files).findings.filter(item => item.rule === 'import-cycle').length, 1);
  const conditional = [file('pkg/a.py', 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from .b import value\n'), files[1]];
  assert.equal(analyze(conditional).findings.filter(item => item.rule === 'import-cycle').length, 0);
  const facade = [file('pkg/__init__.py', 'from .a import value\n'), file('pkg/a.py', 'from . import b\n'), file('pkg/b.py', 'from .a import value\n')];
  assert.equal(analyze(facade).findings.filter(item => item.rule === 'import-cycle').length, 1);
});

test('工作线程评分与直接评分一致，并响应预先取消', async () => {
  const files = [file('src/main.py', 'def run(value):\n    return value / 0\n')];
  const direct = analyze(files);
  const progress: { completed: number; total: number; phase: string }[] = [];
  const worker = await analyzeInWorker(files, true, undefined, (completed, total, phase) => progress.push({ completed, total, phase }));
  assert.deepEqual(worker.findings, direct.findings);
  assert.equal(worker.score, direct.score);
  assert.deepEqual(progress, [{ completed: 1, total: 1, phase: 'files' }, { completed: 1, total: 1, phase: 'finalize' }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeInWorker(files, true, controller.signal), /取消/);
  const running = new AbortController();
  const pending = analyzeInWorker(files, true, running.signal);
  running.abort();
  await assert.rejects(pending, /取消/);
});
