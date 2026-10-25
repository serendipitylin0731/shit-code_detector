import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, CodeFile, languageOf, lengthFactor } from '../src/analysis';

const file = (name: string, content: string): CodeFile => ({ path: name, language: languageOf(name)!, content });

test('识别多种语言与特殊文件名', () => {
  for (const name of ['main.py', 'app.tsx', 'main.go', 'lib.rs', 'Main.java', 'main.cpp', 'app.vue', 'query.sql', 'line_scraper.gleam', 'Dockerfile']) {
    assert.ok(languageOf(name), name);
  }
  assert.equal(languageOf('image.png'), undefined);
});

test('重复格式问题保留明细但聚合上限阻止其淹没真实缺陷', () => {
  const source = Array.from({ length: 250 }, () => 'const foo = 1;  ').join('\n');
  const result = analyze([file('bad.ts', source)], [], false);
  assert.equal(result.categoryScores.naming, 0);
  assert.equal(result.categoryScores.style, 12);
  assert.equal(result.score, 12);
  assert.equal(result.findings.filter(item => item.rule === 'trailing-space').length, 250);
});

test('运算符结尾允许一个空格，两个空格或 Tab 仍算行尾多余空白', () => {
  const source = [
    'const a = ',
    'const b =  ',
    'const c =\t',
    'const d = 1; ',
    'const e = 1; // comment + '
  ].join('\n');
  const js = analyze([file('spacing.ts', source)], [], false);
  assert.deepEqual(js.findings.filter(item => item.rule === 'trailing-space').map(item => item.line), [2, 3, 4, 5]);

  const python = analyze([file('spacing.py', 'value = left // \nvalue = left //  \nvalue = 1 # comment + ')], [], false);
  assert.deepEqual(python.findings.filter(item => item.rule === 'trailing-space').map(item => item.line), [2, 3]);
});

test('架构规则只在项目模式运行，跨文件缩进不一致可定位', () => {
  const long = Array.from({ length: 851 }, () => 'pass').join('\n');
  const tabs = '\tfoo\n\tbar\n\tbaz\n\tqux';
  const spaces = '    foo\n    bar\n    baz\n    qux';
  const files = [file('long.py', long), file('a.py', tabs), file('b.py', spaces)];
  const project = analyze(files);
  const selection = analyze(files, [], false);
  assert.ok(!project.findings.some(f => f.rule === 'large-file'));
  assert.ok(project.findings.some(f => f.rule === 'indent-style'));
  assert.ok(!selection.findings.some(f => f.rule === 'large-file'));
});

test('混合换行和混合缩进分别计分', () => {
  const result = analyze([file('mixed.py', 'if True:\r\n \tpass\n')], [], false);
  assert.ok(result.findings.some(f => f.rule === 'mixed-eol'));
  assert.ok(result.findings.some(f => f.rule === 'mixed-indent' && f.line === 2));
});

test('测试文件长度不计作生产架构问题', () => {
  const long = Array.from({ length: 1000 }, () => 'assert True').join('\n');
  const result = analyze([file('tests/test_feature.py', long)]);
  assert.ok(!result.findings.some(f => f.rule === 'large-file'));
});

test('同样的问题比例在 1000 行和 10000 行项目得到统一的长度标准化分', () => {
  const content = Array.from({ length: 1000 }, (_, index) => index < 100 ? `int value_${index}=1;` : `int value_${index} = 1;`).join('\n');
  const smallFiles = [file('part_0.cpp', content)];
  const largeFiles = Array.from({ length: 10 }, (_, index) => file(`part_${index}.cpp`, content));
  const ai = (files: CodeFile[]) => files.map(item => ({ path: item.path, line: 1, category: 'architecture' as const,
    rule: 'ai-abstraction_fit', points: 10, message: '同类抽象写法问题', source: 'ai' as const }));
  const small = analyze(smallFiles, ai(smallFiles), false);
  const large = analyze(largeFiles, ai(largeFiles), false);
  assert.equal(lengthFactor(smallFiles), 1);
  assert.equal(lengthFactor(largeFiles), 0.1);
  assert.ok(Math.abs(small.score - large.score) < 1e-9);
  assert.ok(Math.abs(small.categoryScores.style - large.categoryScores.style) < 1e-9);
  assert.ok(Math.abs(small.categoryScores.architecture - large.categoryScores.architecture) < 1e-9);
});
