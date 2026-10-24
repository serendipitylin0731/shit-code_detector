import assert from 'node:assert/strict';
import test from 'node:test';
import { isEligible, isSensitiveConfig } from '../src/fileFilter';

test('AI 本地配置始终排除在评分输入之外', () => {
  assert.equal(isEligible('ai.local.json'), false);
  assert.equal(isEligible('nested/ai.local.json'), false);
  assert.equal(isSensitiveConfig('nested/ai.local.json'), true);
  assert.equal(isEligible('src/main.py'), true);
});

test('依赖、生成文件和测试样本不会污染工作区评分', () => {
  assert.equal(isEligible('node_modules/pkg/index.js'), false);
  assert.equal(isEligible('test/fixtures/quality.ts'), false);
  assert.equal(isEligible('artifacts/quality-fixtures/good/src/numbers.py'), false);
  assert.equal(isEligible('src/client.generated.ts'), false);
});
