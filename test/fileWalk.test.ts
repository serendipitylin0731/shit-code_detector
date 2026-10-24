import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listCodePaths } from '../src/fileWalk';

test('目录扫描实际跳过根与嵌套 .gitignore 命中的代码', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scd-ignore-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'private'));
    await writeFile(path.join(root, '.gitignore'), 'private/\n*.tmp\n');
    await writeFile(path.join(root, 'src', '.gitignore'), 'hidden.py\n');
    await writeFile(path.join(root, 'src', 'keep.py'), 'print(1)\n');
    await writeFile(path.join(root, 'src', 'hidden.py'), 'print(2)\n');
    await writeFile(path.join(root, 'src', 'note.tmp'), 'ignored\n');
    await writeFile(path.join(root, 'private', 'generated.py'), 'print(3)\n');
    assert.deepEqual(await listCodePaths(root), ['src/keep.py']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
