import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScanConfig, selectScanConfig } from '../src/scanConfig';

test('.shitcode 是允许列表，使用与 .gitignore 相同的路径和否定规则', () => {
  const config = selectScanConfig('src/*.py\n!src/skip.py\n# comment\n');
  assert.equal(config.mode, 'include');
  assert.equal(config.allows('src/main.py'), true);
  assert.equal(config.allows('src/skip.py'), false);
  assert.equal(config.allows('src/main.ts'), false);
  assert.equal(config.allows('other.py'), false);
  assert.equal(config.allows('../outside.py'), false);
  assert.equal(config.mayContain('node_modules'), false);
  assert.equal(config.mayContain('src'), true);
  assert.equal(selectScanConfig('*.py').mayContain('node_modules'), true, '无目录前缀的模式可命中任意子目录');
});

test('.shitcode_ignore 是排除列表，未列出的文件仍参与评分', () => {
  const config = selectScanConfig(undefined, 'private/\n*.generated.py\n!keep.generated.py\n');
  assert.equal(config.mode, 'exclude');
  assert.equal(config.allows('private/key.py'), false);
  assert.equal(config.allows('src/main.py'), true);
  assert.equal(config.allows('src/secret.generated.py'), false);
  assert.equal(config.allows('src/keep.generated.py'), true);
});

test('两份配置同时存在时只读取 .shitcode；空允许列表也不回退', async () => {
  const requested: string[] = [];
  const config = await loadScanConfig(async name => {
    requested.push(name);
    return name === '.shitcode' ? '' : '*.py';
  });
  assert.deepEqual(requested, ['.shitcode']);
  assert.equal(config.fileName, '.shitcode');
  assert.equal(config.allows('main.py'), false);
  assert.equal(selectScanConfig(undefined, undefined).allows('main.py'), true);
});
