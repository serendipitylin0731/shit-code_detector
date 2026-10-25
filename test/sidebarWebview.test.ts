import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, runInNewContext } from 'node:vm';

test('侧边栏只显示当前目标的操作入口，Webview 脚本可解析', () => {
  const manifest = require('../../package.json');
  assert.equal(manifest.engines.vscode, '^1.106.0');
  assert.equal(manifest.contributes.viewsContainers.secondarySidebar[0].id, 'shitCodeDetectorRight');
  assert.equal(manifest.icon, 'media/logo.png');
  const loader = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = loader._load;
  const uri = (value: string) => ({ value, toString: () => value });
  const vscode = { Uri: { joinPath: (base: ReturnType<typeof uri>, ...parts: string[]) => uri(`${base.value}/${parts.join('/')}`) } };
  loader._load = (request, parent, isMain) => request === 'vscode' ? vscode : original(request, parent, isMain);
  let SidebarProvider: typeof import('../src/sidebar').SidebarProvider;
  try { ({ SidebarProvider } = require('../src/sidebar') as typeof import('../src/sidebar')); }
  finally { loader._load = original; }
  assert.equal(manifest.contributes.views.shitCodeDetectorRight[0].id, SidebarProvider.viewId);

  const webview = { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (value: ReturnType<typeof uri>) => value, onDidReceiveMessage: () => undefined };
  const view = { webview, onDidDispose: () => undefined };
  new SidebarProvider(async () => undefined, uri('extension') as never).resolveWebviewView(view as never);
  assert.match(webview.html, /id="targetRoot"/);
  assert.match(webview.html, /id="targetFile"/);
  assert.match(webview.html, /id="targetRepository"/);
  assert.match(webview.html, /id="fileControls" hidden/);
  assert.match(webview.html, /id="repositoryControls" hidden/);
  assert.match(webview.html, /id="settingsPanel" hidden/);
  assert.match(webview.html, /id="settingsToggle"/);
  assert.match(webview.html, /send\('toggleVoid', \{ key: item\.voidKey \}\)/);
  assert.match(webview.html, /id="fileVoidToggle"/);
  assert.match(webview.html, /id="showMore"/);
  assert.match(webview.html, /id="progressPanel"/);
  assert.match(webview.html, /id="cancelScan"/);
  assert.doesNotMatch(webview.html, /id="previous"|id="next"|id="pageLabel"/);
  assert.match(webview.html, /\.grade-row\.voided, \.finding\.voided/);
  assert.match(webview.html, /extension\/media\/logo.svg/);
  assert.doesNotMatch(webview.html, /id="workspace"|id="openAiConfig"|选择文件评分|根目录和选定文件使用/);
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  const ids = [...webview.html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  class FakeNode {
    hidden = false;
    value = '';
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    style: Record<string, string> = {};
    className = '';
    textContent = '';
    title = '';
    disabled = false;
    childNodes: FakeNode[] = [];
    onclick?: () => void;
    onchange?: () => void;
    classList = { toggle: (name: string, present: boolean) => { this.className = present ? name : ''; } };
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    removeAttribute(name: string) { delete this.attributes[name]; }
    replaceChildren(...nodes: FakeNode[]) { this.childNodes = nodes; }
    append(...nodes: FakeNode[]) { this.childNodes.push(...nodes); }
  }
  const nodes = new Map(ids.map(id => [id, new FakeNode()]));
  const messages: unknown[] = [];
  let onMessage: ((event: { data: unknown }) => void) | undefined;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ getState: () => undefined, setState: () => undefined, postMessage: (message: unknown) => messages.push(message) }),
    document: { getElementById: (id: string) => { const node = nodes.get(id); assert.ok(node, id); return node; }, createElement: () => new FakeNode() },
    window: { addEventListener: (_type: string, callback: (event: { data: unknown }) => void) => { onMessage = callback; } }
  });
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { action: string }).action, 'ready');
  assert.equal(nodes.get('settingsPanel')?.hidden, true);
  (nodes.get('settingsToggle') as never as { onclick: () => void }).onclick();
  assert.equal(nodes.get('settingsPanel')?.hidden, false);
  (nodes.get('targetFile') as never as { onclick: () => void }).onclick();
  assert.equal(nodes.get('rootControls')?.hidden, true);
  assert.equal(nodes.get('fileControls')?.hidden, false);
  assert.equal(nodes.get('repositoryControls')?.hidden, true);
  assert.ok(onMessage);
  onMessage({ data: { type: 'state', busy: true, message: '读取代码文件 1/2', progress: 50 } });
  assert.equal(nodes.get('progressPanel')?.hidden, false);
  assert.equal(nodes.get('progressTrack')?.attributes['aria-valuenow'], '50');
  assert.equal(nodes.get('progressFill')?.style.width, '50%');
  nodes.get('cancelScan')?.onclick?.();
  assert.equal((messages.at(-1) as { action: string }).action, 'cancelScan');

  const findings = Array.from({ length: 25 }, (_, index) => ({ index, path: 'a.py', line: index + 1, category: 'style',
    severity: 'medium', evidenceType: 'static-confirmed', confidence: 'high', message: '问题 ' + index,
    voidable: true, voided: false, fileVoided: false, voidKey: 'key-' + index, openable: false }));
  const result = { id: 1, scanId: 1, score: 4, scoreDisplay: '4.00', label: '项目', fileCount: 1, density: '1 / 千行',
    voidedCount: 0, skipped: '0', checks: '通过', ai: '未启用', categoryCounts: { style: 25 },
    fileRows: [{ path: 'a.py', totalFindings: 25, activeFindings: 25, voided: false, voidable: true }],
    findings, aiAssessments: [] };
  onMessage({ data: { type: 'state', busy: false, message: '评分完成', result } });
  assert.equal(nodes.get('progressPanel')?.hidden, true);
  assert.equal(nodes.get('findingList')?.childNodes.length, 20);
  assert.equal(nodes.get('showMore')?.hidden, false);
  nodes.get('showMore')?.onclick?.();
  assert.equal(nodes.get('findingList')?.childNodes.length, 25);
  nodes.get('fileFilter')!.value = 'a.py';
  nodes.get('fileFilter')?.onchange?.();
  assert.equal(nodes.get('fileVoidToggle')?.hidden, false);
  nodes.get('fileVoidToggle')?.onclick?.();
  assert.equal((messages.at(-1) as { action: string; path: string }).action, 'toggleFileVoid');
  assert.equal((messages.at(-1) as { action: string; path: string }).path, 'a.py');
  onMessage({ data: { type: 'state', busy: false, result: { ...result, id: 2, score: 0, scoreDisplay: '0.00',
    voidedCount: 1, fileRows: [{ ...result.fileRows[0], activeFindings: 0, voided: true }],
    findings: findings.map(item => ({ ...item, voided: true, fileVoided: true, voidable: false })) } } });
  assert.equal(nodes.get('fileVoidToggle')?.textContent, '恢复整个文件');
  assert.equal(nodes.get('findingList')?.childNodes.length, 20);
  assert.match(nodes.get('findingList')?.childNodes[0]?.className ?? '', /voided/);
  nodes.get('fileVoidToggle')?.onclick?.();
  assert.equal((messages.at(-1) as { action: string; path: string }).action, 'toggleFileVoid');
  assert.equal((messages.at(-1) as { action: string; path: string }).path, 'a.py');
});
