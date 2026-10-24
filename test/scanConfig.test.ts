import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadScanConfig, selectScanConfig } from '../src/scanConfig';
import { listCodePaths } from '../src/fileWalk';

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

test('导入 Git 规则后按允许或排除列表遍历仓库，未导入时沿用有效代码过滤', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scd-repository-rules-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, 'src', 'main.ts'), 'export const main = 1;\n');
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.ts'), 'export const dependency = 1;\n');
    await writeFile(path.join(root, '.git', 'internal.ts'), 'secret\n');
    assert.deepEqual(await listCodePaths(root), ['src/main.ts']);
    const include = selectScanConfig('node_modules/pkg/index.ts\nsrc/main.ts\n!src/main.ts\n');
    assert.deepEqual(await listCodePaths(root, undefined, include), ['node_modules/pkg/index.ts']);
    const exclude = selectScanConfig(undefined, 'node_modules/\n');
    assert.deepEqual(await listCodePaths(root, undefined, exclude), ['src/main.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
