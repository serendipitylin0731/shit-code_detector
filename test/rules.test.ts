import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, CodeFile, languageOf } from '../src/analysis';

const file = (name: string, content: string): CodeFile => ({ path: name, language: languageOf(name)!, content });

test('空行阈值放宽，文件长度不单独作为缺陷', () => {
  const fourBlanks = analyze([file('a.py', 'x = 1\n\n\n\n\ny = 2')]);
  const fiveBlanks = analyze([file('a.py', 'x = 1\n\n\n\n\n\ny = 2')]);
  assert.ok(!fourBlanks.findings.some(finding => finding.rule === 'blank-run'));
  assert.equal(fiveBlanks.findings.filter(finding => finding.rule === 'blank-run').length, 1);
  const short = analyze([file('short.py', Array(800).fill('pass').join('\n'))]);
  const long = analyze([file('long.py', Array(801).fill('pass').join('\n'))]);
  assert.ok(!short.findings.some(finding => finding.rule === 'large-file'));
  assert.ok(!long.findings.some(finding => finding.rule === 'large-file'));
});

test('JS/TS 解析器区分运算符、字符串与语法错误', () => {
  const source = analyze([file('main.ts', 'const total=left+right;\nconst label = "a=b";\n//bad\nnull.value;\nJSON.parse("{bad}");')], [], false);
  assert.equal(source.findings.filter(finding => finding.rule === 'operator-spacing').length, 2);
  assert.ok(source.findings.some(finding => finding.rule === 'comment-spacing'));
  assert.ok(source.findings.some(finding => finding.rule === 'null-dereference'));
  assert.ok(source.findings.some(finding => finding.rule === 'invalid-json-parse'));
  assert.ok(!source.findings.some(finding => finding.rule === 'syntax-error'));
  const broken = analyze([file('broken.ts', 'const answer = ;')], [], false);
  assert.ok(broken.findings.some(finding => finding.rule === 'syntax-error'));
});

test('Python AST 与 tokenizer 查出明显异常，保留关键字参数惯例', () => {
  const source = analyze([file('main.py', 'def process(value):\n    amount=10\n    #bad\n    helper(value=1)\n    return amount/0\n')], [], false);
  assert.ok(source.findings.some(finding => finding.rule === 'zero-division'));
  assert.ok(source.findings.some(finding => finding.rule === 'comment-spacing'));
  assert.equal(source.findings.filter(finding => finding.rule === 'operator-spacing').length, 1);
  const none = analyze([file('none.py', 'print(None.value)')], [], false);
  assert.ok(none.findings.some(finding => finding.rule === 'none-dereference'));
});

test('C/C++ 宏规则发现优先级与重复求值风险', () => {
  const result = analyze([file('macros.h', '#define SQUARE(x) x*x\n#define int long long\n#define ANSWER 42\nint result=5;')], [], false);
  assert.ok(result.findings.some(finding => finding.rule === 'macro-expression-parens'));
  assert.ok(result.findings.some(finding => finding.rule === 'macro-argument-parens'));
  assert.ok(result.findings.some(finding => finding.rule === 'macro-repeat-argument'));
  assert.ok(result.findings.some(finding => finding.rule === 'macro-keyword'));
  assert.ok(result.findings.some(finding => finding.rule === 'operator-spacing'));
  assert.ok(!result.findings.some(finding => finding.message.includes('ANSWER')));
  const safe = analyze([file('safe.h', '#define URL "https://example.com/a+b"\n#define PRINT(x) printf("%s", x)')], [], false);
  assert.equal(safe.findings.length, 0);
});

test('语言惯用写法不误判为空格与命名问题', () => {
  const make = analyze([file('Makefile', 'all:\n\t  echo done')], [], false);
  assert.ok(!make.findings.some(finding => finding.rule === 'mixed-indent'));
  const python = analyze([file('doc.py', '#: Public attribute\ndata = 1\n')], [], false);
  assert.ok(!python.findings.some(finding => finding.rule === 'comment-spacing'));
  assert.ok(!python.findings.some(finding => finding.rule === 'vague-name'));
  const keyword = analyze([file('kwargs.py', 'def f(value=1):\n    return value\n')], [], false);
  assert.ok(!keyword.findings.some(finding => finding.rule === 'operator-spacing'));
});

test('注释空格缺陷不再独立触发重复的一致性扣分', () => {
  const python = analyze([file('comments.py', '# Good explanation\n#bad explanation\nvalue = 1')], [], false);
  const typescript = analyze([file('comments.ts', '// Good explanation\n//bad explanation\nconst value = 1;')], [], false);
  for (const result of [python, typescript]) {
    assert.equal(result.findings.filter(finding => finding.rule === 'comment-spacing').length, 1);
    assert.equal(result.findings.filter(finding => finding.rule === 'comment-style').length, 0);
  }
});
