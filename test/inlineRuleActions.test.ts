import assert from 'node:assert/strict';
import test from 'node:test';

test('界面规则只在导出时写入首个工作区根目录，已有文件须确认覆盖', async () => {
  const loader = require('node:module') as { _load: (request: string, parent: { filename?: string }, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  const files = new Map<string, string>();
  const writes: string[] = [];
  const errors: string[] = [];
  let overwrite: string | undefined;
  let onAction!: (action: import('../src/sidebar').SidebarAction) => Promise<void>;
  let loadedRule: unknown;
  let importedRule: unknown;
  const uri = (fsPath: string) => ({ fsPath, path: fsPath, toString: () => `file://${fsPath}` });
  class FileSystemError extends Error { code = 'FileNotFound'; }
  class SidebarProvider {
    static viewId = 'fake';
    constructor(action: typeof onAction) { onAction = action; }
    setActiveFileName(): void {}
    setApiKeyConfigured(): void {}
    setLoadedWorkspaceRule(rule: unknown): void { loadedRule = rule; }
    setImportedRepositoryRule(rule: unknown): void { importedRule = rule; }
    setError(message: string): void { errors.push(message); }
  }
  const vscode = {
    FileSystemError,
    Uri: { joinPath: (base: ReturnType<typeof uri>, name: string) => uri(`${base.fsPath}/${name}`) },
    workspace: { workspaceFolders: [{ uri: uri('/workspace'), name: 'workspace' }], fs: {
      stat: async (target: ReturnType<typeof uri>) => { if (!files.has(target.fsPath)) throw new FileSystemError(); return { size: files.get(target.fsPath)!.length }; },
      readFile: async (target: ReturnType<typeof uri>) => { if (!files.has(target.fsPath)) throw new FileSystemError(); return Buffer.from(files.get(target.fsPath)!); },
      writeFile: async (target: ReturnType<typeof uri>, data: Uint8Array) => { writes.push(target.fsPath); files.set(target.fsPath, Buffer.from(data).toString()); }
    } },
    window: { activeTextEditor: undefined, createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
      registerWebviewViewProvider: () => ({ dispose: () => undefined }), onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
      showWarningMessage: async () => overwrite, showInformationMessage: async () => undefined,
      showErrorMessage: async (message: string) => { errors.push(message); },
      showOpenDialog: async () => [uri('/imports/.shitcode_ignore')]
    },
    commands: { registerCommand: () => ({ dispose: () => undefined }) }
  };
  files.set('/imports/.shitcode_ignore', 'dist/\n');
  loader._load = (request, parent, isMain) => {
    if (request === 'vscode') return vscode;
    if (parent?.filename?.endsWith('/src/extension.js') && request === './sidebar') return { SidebarProvider };
    return originalLoad(request, parent, isMain);
  };
  try {
    const { activate } = require('../src/extension') as typeof import('../src/extension');
    activate({ extensionUri: uri('/extension'), secrets: { get: async () => undefined }, subscriptions: [] } as never);
  } finally { loader._load = originalLoad; }

  assert.deepEqual(writes, []);
  await onAction({ action: 'exportRule', rule: { name: '.shitcode', contents: 'src/main.py\n' } });
  assert.deepEqual(writes, ['/workspace/.shitcode']);
  assert.equal(files.get('/workspace/.shitcode'), 'src/main.py\n');
  await onAction({ action: 'exportRule', rule: { name: '.shitcode', contents: 'private/\n' } });
  assert.equal(files.get('/workspace/.shitcode'), 'src/main.py\n');
  overwrite = '覆盖';
  await onAction({ action: 'exportRule', rule: { name: '.shitcode', contents: 'private/\n' } });
  assert.equal(files.get('/workspace/.shitcode'), 'private/\n');
  await onAction({ action: 'exportRule', rule: { name: '../escape' as '.shitcode', contents: 'x' } });
  assert.equal(writes.length, 2);
  assert.ok(errors.some(error => error.includes('类型必须')));

  files.set('/workspace/.shitcode_ignore', '*.py\n');
  await onAction({ action: 'loadWorkspaceRule' });
  assert.deepEqual(loadedRule, { name: '.shitcode', contents: 'private/\n' });
  await onAction({ action: 'importRepositoryConfig' });
  assert.deepEqual(importedRule, { name: '.shitcode_ignore', contents: 'dist/\n' });
  assert.equal(writes.length, 2);
});
