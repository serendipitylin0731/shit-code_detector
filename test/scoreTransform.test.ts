import assert from 'node:assert/strict';
import test from 'node:test';
import { finalScore, formattedFinalScore } from '../src/scoreTransform';

test('最终分严格按五段函数变换，边界连续并随原始分单调增加', () => {
  assert.equal(finalScore(0), 0);
  assert.equal(finalScore(0.05), 0.05);
  assert.equal(finalScore(0.1), 0.1);
  assert.equal(finalScore(45), 3);
  assert.equal(finalScore(150), 6);
  assert.equal(finalScore(250), 8);
  assert.ok(Math.abs(finalScore(0.1 - 1e-8) - 0.1) < 1e-7);
  assert.ok(Math.abs(finalScore(45 - 1e-8) - 3) < 1e-7);
  assert.ok(Math.abs(finalScore(150 - 1e-8) - 6) < 1e-7);
  assert.ok(Math.abs(finalScore(250 - 1e-8) - 8) < 1e-7);
  for (const x of [0, 0.05, 0.1, 1, 20, 44.9, 45, 100, 149.9, 150, 200, 249.9, 250, 500]) {
    assert.ok(finalScore(x + 1e-6) > finalScore(x), `x=${x}`);
  }
  assert.equal(formattedFinalScore(0.05), '0.050');
  assert.equal(formattedFinalScore(45), '3.000');
  assert.equal(formattedFinalScore(250), '8.000');
  assert.ok(finalScore(500) < 9);
  assert.throws(() => finalScore(-1), /非负/);
});
