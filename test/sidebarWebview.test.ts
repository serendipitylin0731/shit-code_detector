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
  assert.match(webview.html, /extension\/media\/logo.svg/);
  assert.doesNotMatch(webview.html, /id="workspace"|id="openAiConfig"|选择文件评分|根目录和选定文件使用/);
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  const ids = [...webview.html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  const nodes = new Map(ids.map(id => [id, { hidden: false, value: '', dataset: {}, attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attributes[name] = value; } }]));
  const messages: unknown[] = [];
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ getState: () => undefined, setState: () => undefined, postMessage: (message: unknown) => messages.push(message) }),
    document: { getElementById: (id: string) => { const node = nodes.get(id); assert.ok(node, id); return node; } },
    window: { addEventListener: () => undefined }
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
});
