import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanProgress, ScanScope } from '../src/scanProgress';

test('蓝色进度条对所有目标使用单调的总进度，完成时到 100%', () => {
  for (const scope of ['workspace', 'files', 'repository'] as ScanScope[]) {
    for (const aiEnabled of [false, true]) {
      const plan = new ScanProgress();
      const values = [plan.stage('discovery'), plan.stage('discovery', 1, 1),
        plan.stage('read', 0, 4), plan.stage('read', 2, 4), plan.stage('read', 4, 4)];
      plan.configure(2, aiEnabled ? 2 : 0, aiEnabled && scope !== 'files' ? 2 : 0);
      values.push(plan.stage('local', 0, 2), plan.stage('local', 1, 2), plan.stage('local', 2, 2));
      if (scope === 'workspace') values.push(plan.stage('baseline'), plan.stage('baseline', 1, 1));
      if (aiEnabled) {
        values.push(plan.stage('aiFiles'), plan.stage('aiFiles', 1, 2), plan.stage('aiFiles', 2, 2));
        if (scope !== 'files') values.push(plan.stage('aiProject'), plan.stage('aiProject', 1, 2), plan.stage('aiProject', 2, 2));
      }
      values.push(plan.stage('report'), plan.complete());
      assert.equal(values[0], 0);
      assert.equal(values[4], 10);
      assert.equal(values.at(-2), 100);
      assert.equal(values.at(-1), 100);
      assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]), `${scope}, AI=${aiEnabled}: ${values}`);
      assert.ok(values.every(value => value <= 100));
    }
  }
});

test('未知时长阶段保留总进度，当前阶段计数不能令蓝条回退', () => {
  const plan = new ScanProgress();
  assert.equal(plan.stage('discovery', 1, 2), 0);
  assert.equal(plan.stage('discovery'), 0);
  assert.equal(plan.stage('read', 1, 2), 5);
  assert.equal(plan.stage('read', 0, 2), 5);
  assert.equal(plan.stage('read', 2, 2), 10);
  plan.configure(2, 3, 1);
  assert.equal(plan.stage('local', 0, 2), 10);
  assert.equal(plan.stage('local', 1, 2), 25);
  assert.equal(plan.stage('local', 2, 2), 40);
  assert.equal(plan.stage('baseline', 1, 1), 40);
  assert.equal(plan.stage('aiFiles', 1, 3), 55);
  assert.equal(plan.stage('aiFiles', 3, 3), 85);
  assert.equal(plan.stage('aiProject', 1, 1), 100);
});
