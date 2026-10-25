import assert from 'node:assert/strict';
import test from 'node:test';
import { Analysis, analyze, Finding } from '../src/analysis';
import { dashboardFindings } from '../src/dashboardData';
import { summaryMetrics } from '../src/summaryMetrics';
import { assessmentVoidKey, buildVoidScoreModel, findingVoidKey } from '../src/voidScore';

test('void 一个达到上限的风格问题仍立即降分，恢复后回到原分', () => {
  const findings: Finding[] = Array.from({ length: 30 }, (_, index) => ({
    path: 'main.py', line: index + 1, category: 'style', rule: 'trailing-space', points: 1,
    message: '行尾空格', source: 'rules'
  }));
  const base: Analysis = { files: [{ path: 'main.py', language: 'Python', content: 'x = 1\n'.repeat(30) }],
    findings, categoryScores: { style: 12, naming: 0, readability: 0, complexity: 0, duplication: 0,
      consistency: 0, architecture: 0 }, score: 12, checkCoverage: '' };
  const model = buildVoidScoreModel(base);
  const key = findingVoidKey(findings[0], 0);
  assert.ok(model.validKeys.has(key));
  assert.equal(model.apply(new Set()).score, 12);
  const after = model.apply(new Set([key]));
  assert.ok(after.score < 12);
  assert.ok(after.score > 0);
  assert.equal(after.findings.length, 29);
  assert.ok(summaryMetrics(after).issueDensity < summaryMetrics(base).issueDensity);
  const rows = dashboardFindings(findings, base.files, new Set([key]), model.validKeys);
  assert.equal(rows.at(-1)?.voidKey, key);
  assert.equal(rows.at(-1)?.voided, true);
  assert.equal(model.apply(new Set()).score, 12);
});

test('void AI 条目同时排除其全部问题，只扣一次加权分', () => {
  const findings: Finding[] = [
    { path: 'a.py', line: 1, category: 'architecture', rule: 'ai-function_cohesion', points: 12, message: '问题一', source: 'ai', aiGrade: 'D' },
    { path: 'a.py', line: 2, category: 'architecture', rule: 'ai-function_cohesion', points: 0, message: '问题二', source: 'ai', aiGrade: 'D' }
  ];
  const base: Analysis = { files: [{ path: 'a.py', language: 'Python', content: 'a\nb' }], findings,
    categoryScores: { style: 0, naming: 0, readability: 0, complexity: 0, duplication: 0,
      consistency: 0, architecture: 12 }, score: 12, checkCoverage: '' };
  const model = buildVoidScoreModel(base);
  const key = assessmentVoidKey('a.py', 'function_cohesion');
  assert.equal(findingVoidKey(findings[0], 0), key);
  assert.equal(findingVoidKey(findings[1], 1), key);
  assert.equal(model.apply(new Set([key])).score, 0);
  assert.equal(model.apply(new Set([key])).findings.length, 0);
  assert.deepEqual(dashboardFindings(findings, base.files, new Set([key]), model.validKeys).map(row => row.voided), [true, true]);
});

test('超过 1000 行时 void AI 条目扣除长度归一后的贡献', () => {
  const base = analyze([{ path: 'large.py', language: 'Python', content: 'value = 1\n'.repeat(2000) }], [{
    path: 'large.py', line: 1, category: 'architecture', rule: 'ai-abstraction_fit', points: 6,
    message: '不必要的抽象', source: 'ai', aiGrade: 'D'
  }], false);
  assert.equal(base.score, 3);
  const model = buildVoidScoreModel(base);
  assert.equal(model.apply(new Set([assessmentVoidKey('large.py', 'abstraction_fit')])).score, 0);
});
