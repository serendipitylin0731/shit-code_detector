import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze } from '../src/analysis';
import { qualityCases } from './fixtures/quality';

test('好、中、差项目的本地分数呈稳定梯度', () => {
  const scores = qualityCases.map(example => analyze(example.files));
  assert.equal(scores[0].score, 0);
  assert.ok(scores[1].score > scores[0].score, '中档项目应高于良好项目');
  assert.ok(scores[2].score > scores[1].score * 10, '差项目应显著高于中档项目');
  assert.ok(scores[1].findings.some(finding => finding.rule === 'vague-name'));
  assert.ok(scores[2].findings.some(finding => finding.rule === 'large-file'));
  assert.ok(scores[2].findings.some(finding => finding.rule === 'mixed-indent'));
  assert.ok(scores[2].findings.some(finding => finding.rule === 'indent-style'));
});
