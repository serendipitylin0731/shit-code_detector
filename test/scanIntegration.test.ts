import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('当前项目与当前文件遵循新配置，旧 .gitignore 不参与筛选', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scd-scan-config-'));
  const moduleLoader = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = moduleLoader._load;
  const uri = (filePath: string) => ({ fsPath: filePath, path: filePath.replaceAll('\\', '/'), toString: () => `file://${filePath}` });
  const folder = { uri: uri(root), name: 'sample' };
  const visited: string[] = [];
  const vscode = {
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    FileSystemError: class FileSystemError extends Error { code = 'FileNotFound'; },
    Uri: { file: uri, joinPath: (base: ReturnType<typeof uri>, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
    workspace: {
      workspaceFolders: [folder],
      getWorkspaceFolder: (target: ReturnType<typeof uri>) => target.fsPath.startsWith(root + path.sep) ? folder : undefined,
      fs: {
        readDirectory: async (target: ReturnType<typeof uri>) => {
          visited.push(target.fsPath);
          return (await readdir(target.fsPath, { withFileTypes: true }))
            .map(item => [item.name, item.isDirectory() ? 2 : item.isFile() ? 1 : 64]);
        },
        readFile: async (target: ReturnType<typeof uri>) => readFile(target.fsPath),
        stat: async (target: ReturnType<typeof uri>) => ({ size: (await stat(target.fsPath)).size })
      }
    }
  };
  moduleLoader._load = (request, parent, isMain) => request === 'vscode' ? vscode : originalLoad(request, parent, isMain);
  const { workspaceEntries, collectUris, applyScanConfigToSelections, collectActiveDocument } = require('../src/collect') as typeof import('../src/collect');
  moduleLoader._load = originalLoad;
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'private'));
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, '.gitignore'), 'private/\nnode_modules/\n');
    await writeFile(path.join(root, '.shitcode'), 'src/main.py\nprivate/hidden.py\nnode_modules/pkg/index.js\n');
    await writeFile(path.join(root, '.shitcode_ignore'), '*.py\n');
    await writeFile(path.join(root, 'src', 'main.py'), 'print(1)\n');
    await writeFile(path.join(root, 'private', 'hidden.py'), 'print(2)\n');
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'const value = 3;\n');
    const discovered: number[] = [];
    const included = await collectUris(await workspaceEntries(undefined, undefined, count => discovered.push(count)), 10000);
    assert.deepEqual(included.files.map(file => file.path).sort(), ['node_modules/pkg/index.js', 'private/hidden.py', 'src/main.py']);
    assert.deepEqual(discovered, [1, 2, 3]);
    const currentDocument = { uri: uri(path.join(root, 'src', 'main.py')), isUntitled: false, getText: () => 'print("unsaved editor snapshot")\n' };
    const active = await collectActiveDocument(currentDocument as never, 10000);
    assert.equal(active.files[0].content, 'print("unsaved editor snapshot")\n');
    const allowedSelections = await applyScanConfigToSelections([
      { uri: uri(path.join(root, 'src', 'main.py')) as never, path: 'main.py' },
      { uri: uri(path.join(root, 'private', 'hidden.py')) as never, path: 'hidden.py' }
    ]);
    assert.deepEqual(allowedSelections.map(file => file.path), ['main.py', 'hidden.py']);

    await rm(path.join(root, '.shitcode'));
    await writeFile(path.join(root, '.shitcode_ignore'), 'private/\n');
    const excluded = await collectUris(await workspaceEntries(), 10000);
    assert.deepEqual(excluded.files.map(file => file.path).sort(), ['node_modules/pkg/index.js', 'src/main.py']);
    const selected = await applyScanConfigToSelections([
      { uri: uri(path.join(root, 'src', 'main.py')) as never, path: 'main.py' },
      { uri: uri(path.join(root, 'private', 'hidden.py')) as never, path: 'hidden.py' }
    ]);
    assert.deepEqual(selected.map(file => file.path), ['main.py']);
    await assert.rejects(collectActiveDocument({ uri: uri(path.join(root, 'private', 'hidden.py')), isUntitled: false, getText: () => 'print(2)' } as never, 10000), /排除/);

    visited.length = 0;
    await writeFile(path.join(root, '.shitcode_ignore'), 'private/\nnode_modules/\n');
    const pruned = await collectUris(await workspaceEntries(), 10000);
    assert.deepEqual(pruned.files.map(file => file.path), ['src/main.py']);
    assert.equal(visited.includes(path.join(root, 'node_modules')), false);

    await rm(path.join(root, '.shitcode_ignore'));
    const noConfig = await collectUris(await workspaceEntries(), 10000);
    assert.deepEqual(noConfig.files.map(file => file.path).sort(), ['private/hidden.py', 'src/main.py']);
  } finally {
    moduleLoader._load = originalLoad;
    await rm(root, { recursive: true, force: true });
  }
});
