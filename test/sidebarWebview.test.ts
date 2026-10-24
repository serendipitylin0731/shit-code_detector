import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';

test('侧边栏只显示当前目标的操作入口，Webview 脚本可解析', () => {
  const loader = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === 'vscode' ? {} : original(request, parent, isMain);
  let SidebarProvider: typeof import('../src/sidebar').SidebarProvider;
  try { ({ SidebarProvider } = require('../src/sidebar') as typeof import('../src/sidebar')); }
  finally { loader._load = original; }

  const webview = { options: {}, html: '', onDidReceiveMessage: () => undefined };
  const view = { webview, onDidDispose: () => undefined };
  new SidebarProvider(async () => undefined).resolveWebviewView(view as never);
  assert.match(webview.html, /id="targetRoot"/);
  assert.match(webview.html, /id="targetRepository"/);
  assert.match(webview.html, /id="repositoryControls" hidden/);
  assert.doesNotMatch(webview.html, /id="workspace"|id="openAiConfig"/);
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
});
