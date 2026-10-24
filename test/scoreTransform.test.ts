import assert from 'node:assert/strict';
import test from 'node:test';
import { finalScore, formattedFinalScore } from '../src/scoreTransform';

test('最终分严格按给定函数变换原始分，保持单调并趋近 9', () => {
  assert.equal(finalScore(0), 0);
  assert.equal(finalScore(40), 4.5);
  assert.equal(finalScore(80), 8);
  assert.equal(formattedFinalScore(40), '4.500');
  assert.equal(formattedFinalScore(1), '0.000141');
  assert.ok(finalScore(20) < finalScore(40));
  assert.ok(finalScore(40) < finalScore(80));
  assert.ok(finalScore(80) < finalScore(200));
  assert.ok(finalScore(200) < 9);
  assert.throws(() => finalScore(-1), /非负/);
});
