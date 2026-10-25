import assert from 'node:assert/strict';
import test from 'node:test';

test('侧边栏打开未返回时扫描仍启动，取消能结束正在等待的收集', async () => {
  const loader = require('node:module') as { _load: (request: string, parent: { filename?: string }, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  const commands = new Map<string, () => Promise<void>>();
  const messages: string[] = [];
  let mode: 'cancel' | 'complete' = 'cancel';
  let completedScore: number | undefined;
  let started!: () => void;
  const collectionStarted = new Promise<void>(resolve => { started = resolve; });
  class CancellationError extends Error {}
  class CancellationTokenSource {
    private callbacks: (() => void)[] = [];
    token = { isCancellationRequested: false, onCancellationRequested: (callback: () => void) => {
      this.callbacks.push(callback); return { dispose: () => { this.callbacks = this.callbacks.filter(item => item !== callback); } };
    } };
    cancel(): void { this.token.isCancellationRequested = true; this.callbacks.forEach(callback => callback()); }
    dispose(): void { this.callbacks = []; }
  }
  class SidebarProvider {
    static viewId = 'fake';
    constructor(readonly onAction: (action: { action: string }) => Promise<void>) { sidebar = this; }
    setActiveFileName(): void {}
    setApiKeyConfigured(): void {}
    setBusy(_busy: boolean, message: string): void { messages.push(message); }
    setError(message: string): void { messages.push(`错误：${message}`); }
    setResult(result: { score: number }): void { completedScore = result.score; messages.push('评分完成'); }
    reveal(): Promise<void> { return new Promise(() => undefined); }
  }
  let sidebar!: SidebarProvider;
  const vscode = {
    CancellationError, CancellationTokenSource,
    window: { activeTextEditor: undefined, createOutputChannel: () => ({ appendLine: (line: string) => messages.push(`日志：${line}`), dispose: () => undefined }),
      registerWebviewViewProvider: () => ({ dispose: () => undefined }), onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }) },
    workspace: { isTrusted: true, workspaceFolders: [{ name: 'test', uri: { fsPath: '/tmp/test' } }],
      getConfiguration: () => ({ get: (_name: string, fallback: unknown) => fallback }) },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return { dispose: () => undefined }; } }
  };
  loader._load = (request, parent, isMain) => {
    if (request === 'vscode') return vscode;
    if (parent?.filename?.endsWith('/src/extension.js') && request === './sidebar') return { SidebarProvider };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './collect') return {
      workspaceEntries: (token: CancellationTokenSource['token']) => {
        if (mode === 'complete') return Promise.resolve([]);
        started(); return new Promise<never>((_resolve, reject) => token.onCancellationRequested(() => reject(new CancellationError())));
      },
      collectUris: async () => ({ files: [{ path: 'a.py', language: 'Python', content: 'value = 1\n' }],
        skipped: { unsupported: 0, large: 0, binary: 0, unreadable: 0 } })
    };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './analyzeAsync') return {
      analyzeInWorker: async (files: unknown[]) => ({ files, findings: [], score: 0, checkCoverage: '测试覆盖',
        categoryScores: { style: 0, naming: 0, readability: 0, complexity: 0, duplication: 0, consistency: 0, architecture: 0 } })
    };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './gitBaseline') return { compareGitBaseline: async () => undefined };
    return originalLoad(request, parent, isMain);
  };
  try {
    const { activate } = require('../src/extension') as typeof import('../src/extension');
    activate({ extensionUri: {}, secrets: { get: async () => undefined }, subscriptions: [] } as never);
  } finally { loader._load = originalLoad; }
  const command = commands.get('shitCodeDetector.scanWorkspace');
  assert.ok(command);
  const running = command();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`扫描未进入文件收集阶段：${messages.join(' / ')}`)), 1000);
    void collectionStarted.then(() => { clearTimeout(timer); resolve(); });
  });
  assert.ok(messages.includes('查找代码文件…'));
  await sidebar.onAction({ action: 'cancelScan' });
  await running;
  assert.ok(messages.includes('已取消评分'));
  mode = 'complete';
  await command();
  assert.equal(completedScore, 0);
  assert.ok(messages.includes('评分完成'));
});
