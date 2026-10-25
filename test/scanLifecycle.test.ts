import assert from 'node:assert/strict';
import test from 'node:test';

test('侧边栏打开未返回时扫描仍启动，取消能结束正在等待的收集', async () => {
  const loader = require('node:module') as { _load: (request: string, parent: { filename?: string }, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  const commands = new Map<string, () => Promise<void>>();
  const messages: string[] = [];
  const progressValues: number[] = [];
  let mode: 'cancel' | 'complete' | 'ai' = 'cancel';
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
    setBusy(_busy: boolean, message: string, progress?: number): void {
      messages.push(message); if (progress !== undefined) progressValues.push(progress);
    }
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
        if (mode !== 'cancel') return Promise.resolve([{}]);
        started(); return new Promise<never>((_resolve, reject) => token.onCancellationRequested(() => reject(new CancellationError())));
      },
      collectUris: async (_entries: unknown, _limit: unknown, _token: unknown, _flag: unknown, onProgress: (completed: number, total: number) => void) => {
        onProgress(1, 1);
        return { files: [{ path: 'a.py', language: 'Python', content: 'value = 1\n' }],
          skipped: { unsupported: 0, large: 0, binary: 0, unreadable: 0 } };
      }
    };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './analyzeAsync') return {
      analyzeInWorker: async (files: unknown[], _mode: unknown, _signal: unknown,
        onProgress: (completed: number, total: number, phase: 'files') => void) => {
        onProgress(files.length, files.length, 'files');
        return { files, findings: [], score: 0, checkCoverage: '测试覆盖',
          categoryScores: { style: 0, naming: 0, readability: 0, complexity: 0, duplication: 0, consistency: 0, architecture: 0 } };
      }
    };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './ai') return {
      planAiRequests: () => ({ fileRequests: 6, projectRequests: 6 }),
      analyzeWithAi: async (_analysis: unknown, options: { onProgress: (completed: number, total: number) => void;
        onProjectProgress: (completed: number, total: number) => void }) => {
        for (let completed = 0; completed <= 6; completed++) options.onProgress(completed, 6);
        for (let completed = 0; completed <= 6; completed++) options.onProjectProgress(completed, 6);
        return { findings: [], assessments: [], reviewedFiles: 1, processedFiles: 1, totalFiles: 1,
          processedChars: 10, totalChars: 10, fileRequests: 6, reviewedProject: true,
          projectRequests: 6, processedProjectRequests: 6, errors: [] };
      }
    };
    if (parent?.filename?.endsWith('/src/extension.js') && request === './gitBaseline') return { compareGitBaseline: async () => undefined };
    return originalLoad(request, parent, isMain);
  };
  try {
    const { activate } = require('../src/extension') as typeof import('../src/extension');
    activate({ extensionUri: {}, secrets: { get: async () => mode === 'ai' ? 'test-key' : undefined }, subscriptions: [] } as never);
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
  const firstProgressIndex = progressValues.length;
  await command();
  assert.equal(completedScore, 0);
  assert.ok(messages.includes('评分完成'));
  const scanProgress = progressValues.slice(firstProgressIndex);
  assert.equal(scanProgress[0], 0);
  assert.ok(scanProgress.includes(10));
  assert.ok(scanProgress.includes(20));
  assert.equal(scanProgress.at(-1), 100);
  assert.ok(scanProgress.every((value, index) => index === 0 || value >= scanProgress[index - 1]));
  mode = 'ai';
  const firstAiProgressIndex = progressValues.length;
  await command();
  const aiProgress = progressValues.slice(firstAiProgressIndex);
  assert.ok(messages.includes('AI 文件审查轮次 1/6'));
  assert.ok(messages.includes('AI 项目审查轮次 1/6'));
  for (const percent of [10, 20, 40, 60, 80, 100]) assert.ok(aiProgress.includes(percent), `缺少总进度 ${percent}%：${aiProgress}`);
  assert.equal(aiProgress.at(-1), 100);
  assert.ok(aiProgress.every((value, index) => index === 0 || value >= aiProgress[index - 1]));
});
