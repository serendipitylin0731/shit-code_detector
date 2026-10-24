import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { Analysis } from './analysis';
import { DashboardFinding, FileScore } from './dashboardData';

export interface DashboardResult {
  id: number;
  label: string;
  scope: string;
  score: number;
  fileCount: number;
  skipped: string;
  checks: string;
  ai: string;
  categoryScores: Analysis['categoryScores'];
  fileScores: FileScore[];
  findings: DashboardFinding[];
}

export type SidebarAction =
  | { action: 'scanWorkspace'; workspace?: string }
  | { action: 'scanFiles' }
  | { action: 'scanRepository'; url: string }
  | { action: 'openAiConfig' }
  | { action: 'setApiKey' }
  | { action: 'openFinding'; index: number }
  | { action: 'openReport' }
  | { action: 'exportJson' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'shitCodeDetector.dashboard';
  private view?: vscode.WebviewView;
  private result?: DashboardResult;
  private busy = false;
  private message = '';
  private workspaces: { name: string; uri: string }[] = [];

  constructor(private readonly onAction: (action: SidebarAction) => Promise<void>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html(view.webview);
    view.webview.onDidReceiveMessage((message: SidebarAction | { action: 'ready' }) => {
      if (message?.action === 'ready') { this.sendState(); return; }
      void this.onAction(message as SidebarAction);
    });
    view.onDidDispose(() => { this.view = undefined; });
  }

  setWorkspaces(folders: readonly vscode.WorkspaceFolder[] = []): void {
    this.workspaces = folders.map(folder => ({ name: folder.name, uri: folder.uri.toString() }));
    this.sendState();
  }

  setBusy(value: boolean, message = ''): void { this.busy = value; this.message = message; this.sendState(); }
  setError(message: string): void { this.busy = false; this.message = message; this.sendState(); }
  setResult(result: DashboardResult): void { this.result = result; this.busy = false; this.message = '评分完成'; this.sendState(); }
  async reveal(): Promise<void> {
    if (!this.view) await vscode.commands.executeCommand('workbench.view.extension.shitCodeDetector');
    this.view?.show(false);
  }
  getFinding(index: number): DashboardFinding | undefined { return this.result?.findings[index]; }

  private sendState(): void {
    void this.view?.webview.postMessage({ type: 'state', result: this.result, busy: this.busy, message: this.message, workspaces: this.workspaces });
  }
}

function html(webview: vscode.Webview): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 12px 24px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 12px; }
  button, select, input { font: inherit; }
  button { cursor: pointer; }
  .score-panel { position: sticky; top: 0; z-index: 2; padding: 16px 0 10px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
  .eyebrow { color: var(--vscode-descriptionForeground); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .score { font-size: 44px; line-height: 1.1; font-weight: 700; font-variant-numeric: tabular-nums; margin: 4px 0; }
  .hint, .meta { color: var(--vscode-descriptionForeground); line-height: 1.45; overflow-wrap: anywhere; }
  .score-line { display: flex; align-items: baseline; gap: 8px; }
  .score-line span { color: var(--vscode-descriptionForeground); }
  .section { margin-top: 18px; }
  h2 { font-size: 12px; margin: 0 0 9px; }
  .field { display: block; width: 100%; margin: 6px 0; padding: 7px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; }
  .action { display: block; width: 100%; margin: 6px 0; padding: 8px; border: none; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-align: left; }
  .action:hover { background: var(--vscode-button-hoverBackground); }
  .action.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .action.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .action:disabled { opacity: .55; cursor: default; }
  .row { display: flex; gap: 6px; }
  .row > * { flex: 1; min-width: 0; }
  .status { margin: 8px 0; min-height: 16px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
  .chip { padding: 4px 6px; background: var(--vscode-editorWidget-background); border-radius: 4px; }
  .rank { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; padding: 6px; border: 0; border-radius: 3px; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); text-align: left; }
  .rank:hover { background: var(--vscode-list-hoverBackground); }
  .rank span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank strong { color: #e4773e; font-variant-numeric: tabular-nums; }
  .list-head { display: flex; align-items: baseline; justify-content: space-between; }
  .finding { border-left: 3px solid; margin: 7px 0; padding: 8px 8px 9px; border-radius: 3px; background: var(--vscode-editorWidget-background); overflow-wrap: anywhere; }
  .finding.low { border-color: #4f9f70; } .finding.medium { border-color: #d6a338; }
  .finding.high { border-color: #e4773e; } .finding.critical { border-color: #d94b54; }
  .finding-top { display: flex; align-items: center; gap: 6px; font-weight: 600; }
  .points { font-variant-numeric: tabular-nums; }
  .low .points { color: #4f9f70; } .medium .points { color: #d6a338; }
  .high .points { color: #e4773e; } .critical .points { color: #d94b54; }
  .severity { margin-left: auto; font-size: 10px; font-weight: 700; }
  .location { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); margin: 6px 0; overflow-wrap: anywhere; }
  .reason { line-height: 1.45; }
  .open { border: 0; background: none; color: var(--vscode-textLink-foreground); padding: 5px 0 0; }
  .pager { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 12px; }
  .pager button { padding: 4px 7px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; border-radius: 3px; }
</style></head><body>
<div class="score-panel"><div class="eyebrow">Shit score</div><div class="score-line"><div class="score" id="score">—</div><span>无上限 · 越高越差</span></div><div class="meta" id="summary">选择评分对象后开始</div></div>
<section class="section"><h2>评分对象</h2><select class="field" id="workspace"><option value="">当前全部工作区</option></select><button class="action" id="scanWorkspace">评分所选工作区</button><button class="action secondary" id="scanFiles">选择文件评分…</button><input class="field" id="repoUrl" type="url" placeholder="https://github.com/owner/repo.git" aria-label="Git 仓库 HTTPS 地址"><button class="action secondary" id="scanRepository">评分 Git 仓库</button></section>
<section class="section"><h2>AI 分析</h2><div class="row"><button class="action secondary" id="openAiConfig">打开本地配置</button><button class="action secondary" id="setApiKey">安全保存 Key</button></div><div class="hint">本地配置：工作区根目录 ai.local.json</div></section>
<div class="status" id="status" role="status"></div>
<section class="section" id="results" hidden><div class="chips" id="categories"></div><h2>问题最多的文件</h2><div id="fileRanking"></div><div class="list-head"><h2 id="findingTitle">具体问题</h2><div><button class="open" id="openReport">Markdown 报告</button> · <button class="open" id="exportJson">导出 JSON</button></div></div><select class="field" id="fileFilter" aria-label="筛选文件"><option value="all">全部文件</option></select><select class="field" id="categoryFilter" aria-label="筛选类别"><option value="all">全部类别</option><option value="architecture">架构</option><option value="style">风格</option><option value="naming">命名</option><option value="readability">可读性</option><option value="complexity">复杂度</option><option value="duplication">重复</option><option value="consistency">一致性</option><option value="correctness">正确性</option></select><div class="hint" id="coverage"></div><div id="findingList"></div><div class="pager"><button id="previous">上一页</button><span id="pageLabel"></span><button id="next">下一页</button></div></section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let current = null, page = 0, busy = false;
  const pageSize = 100;
  const categoryNames = { architecture: '架构', style: '风格', naming: '命名', readability: '可读性', complexity: '复杂度', duplication: '重复', consistency: '一致性', correctness: '正确性' };
  const severityNames = { low: '轻微', medium: '一般', high: '较重', critical: '严重' };
  function send(action, extras) { vscode.postMessage(Object.assign({ action }, extras || {})); }
  $('scanWorkspace').onclick = () => send('scanWorkspace', { workspace: $('workspace').value || undefined });
  $('scanFiles').onclick = () => send('scanFiles');
  $('scanRepository').onclick = () => send('scanRepository', { url: $('repoUrl').value.trim() });
  $('openAiConfig').onclick = () => send('openAiConfig');
  $('setApiKey').onclick = () => send('setApiKey');
  $('openReport').onclick = () => send('openReport');
  $('exportJson').onclick = () => send('exportJson');
  $('categoryFilter').onchange = () => { page = 0; renderFindings(); };
  $('fileFilter').onchange = () => { page = 0; renderFindings(); };
  $('previous').onclick = () => { if (page > 0) { page--; renderFindings(); } };
  $('next').onclick = () => { page++; renderFindings(); };
  function make(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = String(content); return node; }
  function renderFindings() {
    if (!current) return;
    const filter = $('categoryFilter').value;
    const file = $('fileFilter').value;
    const items = current.findings.filter(item => (filter === 'all' || item.category === filter) && (file === 'all' || item.path === file));
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, pages - 1);
    $('findingTitle').textContent = '具体问题 · ' + items.length;
    const list = $('findingList'); list.replaceChildren();
    if (!items.length) list.append(make('p', 'hint', '没有符合筛选条件的问题。'));
    for (const item of items.slice(page * pageSize, (page + 1) * pageSize)) {
      const card = make('article', 'finding ' + item.severity);
      const top = make('div', 'finding-top');
      top.append(make('span', 'points', '+' + item.points), make('span', '', categoryNames[item.category] || item.category), make('span', 'severity', severityNames[item.severity]));
      card.append(top, make('div', 'location', item.path + (item.line ? ':' + item.line : '') + ' · ' + (item.source === 'ai' ? 'AI' : '本地规则')), make('div', 'reason', item.message));
      if (item.openable) { const open = make('button', 'open', '打开文件位置 →'); open.onclick = () => send('openFinding', { index: item.index }); card.append(open); }
      list.append(card);
    }
    $('pageLabel').textContent = (page + 1) + ' / ' + pages;
    $('previous').disabled = page === 0;
    $('next').disabled = page >= pages - 1;
  }
  window.addEventListener('message', event => {
    if (event.data?.type !== 'state') return;
    const state = event.data;
    busy = Boolean(state.busy);
    for (const id of ['scanWorkspace','scanFiles','scanRepository']) $(id).disabled = busy;
    $('status').textContent = state.message || '';
    const selected = $('workspace').value;
    $('workspace').replaceChildren(make('option', '', '当前全部工作区'));
    $('workspace').firstChild.value = '';
    for (const folder of state.workspaces || []) { const option = make('option', '', folder.name); option.value = folder.uri; $('workspace').append(option); }
    $('workspace').value = selected;
    if (state.result) {
      const changed = current?.id !== state.result.id;
      current = state.result;
      $('score').textContent = current.score;
      $('summary').textContent = current.label + ' · ' + current.fileCount + ' 个文件';
      $('results').hidden = false;
      $('coverage').textContent = '跳过：' + current.skipped + ' · 解析：' + current.checks + ' · AI：' + current.ai;
      const chips = $('categories'); chips.replaceChildren();
      for (const [key, value] of Object.entries(current.categoryScores)) chips.append(make('span', 'chip', (categoryNames[key] || key) + ' ' + value));
      if (changed) {
        const fileSelect = $('fileFilter'); fileSelect.replaceChildren();
        const all = make('option', '', '全部文件'); all.value = 'all'; fileSelect.append(all);
        const ranking = $('fileRanking'); ranking.replaceChildren();
        for (const entry of current.fileScores) {
          const option = make('option', '', entry.path + ' · ' + entry.score); option.value = entry.path; fileSelect.append(option);
        }
        for (const entry of current.fileScores.filter(item => item.score > 0).slice(0, 10)) {
          const button = make('button', 'rank'); button.title = entry.path + ' · ' + entry.findings + ' 条问题';
          button.append(make('span', '', entry.path), make('strong', '', '+' + entry.score));
          button.onclick = () => { fileSelect.value = entry.path; page = 0; renderFindings(); };
          ranking.append(button);
        }
        if (!ranking.childNodes.length) ranking.append(make('p', 'hint', '没有发现可计分的文件问题。'));
        page = 0; renderFindings();
      }
    }
  });
  send('ready');
</script></body></html>`;
}
