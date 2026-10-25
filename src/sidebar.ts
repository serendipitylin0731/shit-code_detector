import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { Analysis } from './analysis';
import type { AiAssessment } from './ai';
import { DashboardFinding, FileScore } from './dashboardData';

export interface DashboardResult {
  id: number;
  scanId: number;
  label: string;
  scope: string;
  score: number;
  scoreDisplay: string;
  voidedCount: number;
  density: string;
  baseline?: string;
  fileCount: number;
  skipped: string;
  checks: string;
  ai: string;
  aiAssessments: (Omit<AiAssessment, 'basePoints' | 'weight' | 'points'> & { voidKey: string; voided: boolean; voidable: boolean; fileVoided: boolean })[];
  categoryCounts: Record<keyof Analysis['categoryScores'], number>;
  fileScores: Pick<FileScore, 'path' | 'findings'>[];
  fileRows: { path: string; totalFindings: number; activeFindings: number; voided: boolean; voidable: boolean }[];
  findings: DashboardFinding[];
}

export type SidebarAction =
  | { action: 'scanWorkspace' }
  | { action: 'scanFiles' }
  | { action: 'scanRepository'; url: string }
  | { action: 'importRepositoryConfig' }
  | { action: 'clearRepositoryConfig' }
  | { action: 'setApiKey' }
  | { action: 'openSettings' }
  | { action: 'openFinding'; index: number }
  | { action: 'openReport' }
  | { action: 'exportJson' }
  | { action: 'toggleVoid'; key: string }
  | { action: 'toggleFileVoid'; path: string }
  | { action: 'cancelScan' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'shitCodeDetector.dashboardRight';
  private view?: vscode.WebviewView;
  private result?: DashboardResult;
  private busy = false;
  private message = '';
  private progress?: number;
  private repositoryConfigName?: string;
  private apiKeyConfigured = false;
  private activeFileName?: string;

  constructor(private readonly onAction: (action: SidebarAction) => Promise<void>, private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    view.webview.html = html(view.webview, view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'logo.svg')).toString());
    view.webview.onDidReceiveMessage((message: SidebarAction | { action: 'ready' }) => {
      if (message?.action === 'ready') { this.sendState(true); return; }
      void this.onAction(message as SidebarAction);
    });
    view.onDidDispose(() => { this.view = undefined; });
  }

  setRepositoryConfigName(name?: string): void { this.repositoryConfigName = name; this.sendState(); }
  setApiKeyConfigured(value: boolean): void { this.apiKeyConfigured = value; this.sendState(); }
  setActiveFileName(value?: string): void { this.activeFileName = value; this.sendState(); }

  setBusy(value: boolean, message = '', progress?: number): void { this.busy = value; this.message = message; this.progress = progress; this.sendState(); }
  setError(message: string): void { this.busy = false; this.message = message; this.progress = undefined; this.sendState(); }
  setResult(result: DashboardResult): void { this.result = result; this.busy = false; this.message = '评分完成'; this.progress = undefined; this.sendState(true); }
  async reveal(): Promise<void> {
    if (!this.view) await vscode.commands.executeCommand('workbench.view.extension.shitCodeDetectorRight');
    this.view?.show(false);
  }
  getFinding(index: number): DashboardFinding | undefined { return this.result?.findings[index]; }

  private sendState(includeResult = false): void {
    void this.view?.webview.postMessage({ type: 'state', result: includeResult ? this.result : undefined, busy: this.busy, message: this.message, progress: this.progress,
      repositoryConfigName: this.repositoryConfigName, apiKeyConfigured: this.apiKeyConfigured, activeFileName: this.activeFileName });
  }
}

function html(webview: vscode.Webview, logoUrl: string): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; padding: 12px 12px 28px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: 12px; }
  button, select, input { font: inherit; }
  button { cursor: pointer; }
  .score-panel { position: sticky; top: 0; z-index: 2; padding: 13px 14px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 12px; background: var(--vscode-editorWidget-background); box-shadow: 0 6px 24px #00000012; }
  .brand { display: flex; align-items: center; gap: 9px; min-height: 38px; }
  .brand img { width: 36px; height: 36px; flex: 0 0 auto; }
  .brand-copy { flex: 1; min-width: 0; }
  .brand-title { font-size: 12px; font-weight: 750; letter-spacing: .01em; }
  .brand-sub { color: var(--vscode-descriptionForeground); font-size: 10px; margin-top: 2px; }
  .icon-button { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: transparent; color: var(--vscode-foreground); }
  .icon-button:hover, .icon-button[aria-expanded="true"] { background: var(--vscode-list-hoverBackground); }
  .icon-button svg { width: 18px; height: 18px; }
  .eyebrow { color: var(--vscode-descriptionForeground); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .score { font-size: 49px; line-height: 1.05; font-weight: 760; font-variant-numeric: tabular-nums; margin: 4px 0; letter-spacing: -.04em; }
  .score[data-tone="good"] { color: #65c99d; } .score[data-tone="watch"] { color: #f0b465; } .score[data-tone="bad"] { color: #f27d79; }
  .hint, .meta { color: var(--vscode-descriptionForeground); line-height: 1.45; overflow-wrap: anywhere; }
  .score-line { display: flex; align-items: baseline; gap: 8px; }
  .score-line span { color: var(--vscode-descriptionForeground); font-size: 13px; }
  .section { margin-top: 12px; padding: 13px; border: 1px solid var(--vscode-panel-border); border-radius: 11px; background: var(--vscode-editorWidget-background); }
  h2 { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
  .field { display: block; width: 100%; margin: 6px 0; padding: 9px 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 7px; }
  .field:focus-visible, button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .action { display: block; width: 100%; margin: 8px 0 0; padding: 9px 10px; border: none; border-radius: 7px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-align: center; font-weight: 650; }
  .action:hover { background: var(--vscode-button-hoverBackground); }
  .action.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .action.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .action:disabled { opacity: .55; cursor: default; }
  .row { display: flex; gap: 6px; }
  .row > * { flex: 1; min-width: 0; }
  .target-switch { display: flex; gap: 3px; margin-bottom: 12px; padding: 3px; border-radius: 8px; background: var(--vscode-input-background); }
  .target-switch button { flex: 1; min-width: 0; padding: 8px 3px; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); font-weight: 600; white-space: nowrap; }
  .target-switch button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); box-shadow: 0 1px 4px #00000022; }
  .target-note { padding: 7px 0 2px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .status { margin: 10px 3px; min-height: 16px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .progress-panel { margin-top: 10px; padding: 10px; border: 1px solid var(--vscode-focusBorder); border-radius: 8px; background: var(--vscode-sideBar-background); }
  .progress-head { display: flex; align-items: center; gap: 9px; min-height: 22px; }
  .progress-head strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .progress-percent { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
  .spinner { display: inline-block; width: 17px; height: 17px; flex: 0 0 auto; border: 2px solid var(--vscode-descriptionForeground); border-top-color: var(--vscode-focusBorder); border-radius: 50%; animation: spin .8s linear infinite; }
  .progress-track { height: 5px; overflow: hidden; margin: 10px 0 8px; border-radius: 5px; background: var(--vscode-progressBar-background, var(--vscode-panel-border)); opacity: .48; }
  .progress-fill { height: 100%; width: 32%; border-radius: inherit; background: var(--vscode-focusBorder); animation: sweep 1.35s ease-in-out infinite alternate; }
  .progress-track.determinate { opacity: 1; }
  .progress-track.determinate .progress-fill { animation: none; transition: width .2s ease; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(320%); } }
  @media (prefers-reduced-motion: reduce) { .spinner, .progress-fill { animation: none; } }
  .cancel-scan { padding: 3px 0; border: 0; background: none; color: var(--vscode-textLink-foreground); }
  .settings-heading { display: flex; align-items: center; justify-content: space-between; }
  .settings-heading h2 { margin: 0; }
  .settings-heading .hint { font-size: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
  .chip { padding: 4px 6px; background: var(--vscode-editorWidget-background); border-radius: 4px; }
  .rank { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; padding: 6px; border: 0; border-radius: 3px; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); text-align: left; }
  .rank:hover { background: var(--vscode-list-hoverBackground); }
  .rank.voided { opacity: .48; filter: grayscale(1); }
  .rank-select { display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0; gap: 6px; border: 0; background: none; color: inherit; text-align: left; }
  .rank-select span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-select strong { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rank .void-button { flex: 0 0 auto; margin: 0; }
  .grade-row { margin: 5px 0; padding: 7px; border-left: 3px solid var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background); border-radius: 3px; overflow-wrap: anywhere; }
  .grade-row.A { border-color: #4f9f70; } .grade-row.B { border-color: #a5b944; }
  .grade-row.C { border-color: #d6a338; } .grade-row.D { border-color: #e4773e; } .grade-row.E { border-color: #d94b54; }
  .grade-row.U, .grade-row.N\\/A { border-color: var(--vscode-descriptionForeground); }
  .grade-row.voided, .finding.voided { opacity: .48; filter: grayscale(1); border-color: var(--vscode-descriptionForeground); }
  .void-button { margin-top: 7px; padding: 3px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 10px; }
  .void-button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .grade-score { font-weight: 700; font-variant-numeric: tabular-nums; }
  details summary { cursor: pointer; font-weight: 600; margin: 8px 0; }
  .list-head { display: flex; align-items: baseline; justify-content: space-between; }
  .finding { border-left: 3px solid; margin: 7px 0; padding: 8px 8px 9px; border-radius: 3px; background: var(--vscode-editorWidget-background); overflow-wrap: anywhere; }
  .finding.low { border-color: #4f9f70; } .finding.medium { border-color: #d6a338; }
  .finding.high { border-color: #e4773e; } .finding.critical { border-color: #d94b54; }
  .finding-top { display: flex; align-items: center; gap: 6px; font-weight: 600; }
  .severity { margin-left: auto; font-size: 10px; font-weight: 700; }
  .location { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); margin: 6px 0; overflow-wrap: anywhere; }
  .reason { line-height: 1.45; }
  .open { border: 0; background: none; color: var(--vscode-textLink-foreground); padding: 5px 0 0; }
  .more-button { display: block; width: 100%; margin-top: 12px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head><body>
<div class="score-panel"><div class="brand"><img src="${logoUrl}" alt="Shit Code Detector 标志"><div class="brand-copy"><div class="brand-title">Shit Code Detector</div><div class="brand-sub">代码风格雷达</div></div><button class="icon-button" id="settingsToggle" type="button" aria-label="打开设置" title="设置" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" stroke="currentColor" stroke-width="1.7"/><path d="m10.4 2.8-.5 1.7a8 8 0 0 0-1.7.9L6.5 5l-2 2 1 1.7a8 8 0 0 0-.8 1.7l-1.9.5v2.8l1.9.5a8 8 0 0 0 .8 1.7l-1 1.7 2 2 1.7-1a8 8 0 0 0 1.7.8l.5 1.9h2.8l.5-1.9a8 8 0 0 0 1.7-.8l1.7 1 2-2-1-1.7a8 8 0 0 0 .8-1.7l1.9-.5v-2.8l-1.9-.5a8 8 0 0 0-.8-1.7l1-1.7-2-2-1.7 1a8 8 0 0 0-1.7-.8l-.5-1.9h-2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button></div><div class="eyebrow" style="margin-top: 11px">综合评分</div><div class="score-line"><div class="score" id="score">—</div><span>/ 9</span></div><div class="meta" id="summary">选择对象后开始评分</div><section class="progress-panel" id="progressPanel" role="status" aria-live="polite" hidden><div class="progress-head"><span class="spinner" aria-hidden="true"></span><strong id="progressTitle">正在评分…</strong><span class="progress-percent" id="progressPercent"></span></div><div class="progress-track" id="progressTrack" role="progressbar" aria-label="当前阶段进度"><div class="progress-fill" id="progressFill"></div></div><button class="cancel-scan" id="cancelScan" type="button">取消评分</button></section></div>
<section class="section" id="settingsPanel" hidden><div class="settings-heading"><h2>AI 设置</h2><span class="hint">保密存储</span></div><div class="hint" id="apiKeyStatus">未配置 Key：只运行本地规则。</div><button class="action secondary" id="setApiKey">保存或更换 API Key</button><button class="action secondary" id="openSettings">调整模型与 API 地址</button></section>
<section class="section"><h2>评分对象</h2><div class="target-switch" role="group" aria-label="评分目标"><button id="targetRoot" type="button" aria-pressed="true">当前项目</button><button id="targetFile" type="button" aria-pressed="false">单文件</button><button id="targetRepository" type="button" aria-pressed="false">Git 仓库</button></div><div id="rootControls"><div class="target-note">从当前项目根目录读取待评分代码。</div><button class="action" id="scanWorkspace">评分当前项目</button></div><div id="fileControls" hidden><div class="target-note" id="activeFileName">先在编辑器中打开代码文件。</div><button class="action" id="scanFiles">评分当前文件</button></div><div id="repositoryControls" hidden><input class="field" id="repoUrl" type="url" placeholder="https://github.com/owner/repo.git" aria-label="Git 仓库 HTTPS 地址"><div class="row"><button class="action secondary" id="importRepositoryConfig">导入评分规则…</button><button class="action secondary" id="clearRepositoryConfig" hidden>清除规则</button></div><div class="hint" id="repositoryConfigStatus">未导入规则：扫描仓库中的有效代码。</div><button class="action" id="scanRepository">评分 Git 仓库</button></div></section>
<div class="status" id="status" role="status"></div>
<section class="section" id="results" hidden><div class="chips" id="categories"></div><h2>问题最多的文件</h2><div id="fileRanking"></div><details id="aiDetails"><summary id="aiGradeTitle">AI 分项等级</summary><div class="hint">固定条目按 A–E、N/A、U 分级；权重与公式见评分文档。</div><div id="aiAssessmentList"></div></details><div class="list-head"><h2 id="findingTitle">具体问题</h2><div><button class="open" id="openReport">Markdown 报告</button> · <button class="open" id="exportJson">导出 JSON</button></div></div><select class="field" id="fileFilter" aria-label="筛选文件"><option value="all">全部文件</option></select><button class="action secondary" id="fileVoidToggle" type="button" hidden>void 整个文件</button><div class="hint" id="fileVoidHint" hidden>整文件 void 保留长度基准；项目级结论需单独 void。</div><select class="field" id="categoryFilter" aria-label="筛选类别"><option value="all">全部类别</option><option value="architecture">架构</option><option value="style">风格</option><option value="naming">命名</option><option value="readability">可读性</option><option value="complexity">复杂度</option><option value="duplication">重复</option><option value="consistency">一致性</option></select><div class="hint" id="coverage"></div><div id="findingList"></div><button class="more-button" id="showMore" type="button" hidden>显示更多</button></section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let current = null, visibleCount = 20, busy = false;
  const savedState = vscode.getState() || {};
  let targetMode = ['root', 'file', 'repository'].includes(savedState.targetMode) ? savedState.targetMode : 'root';
  let settingsOpen = Boolean(savedState.settingsOpen);
  const pageSize = 20;
  const categoryNames = { architecture: '架构', style: '风格', naming: '命名', readability: '可读性', complexity: '复杂度', duplication: '重复', consistency: '一致性' };
  const severityNames = { low: '轻微', medium: '一般', high: '较重', critical: '严重' };
  const gradeSeverity = { A: '无问题', B: '轻微', C: '一般', D: '较重', E: '严重', 'N/A': '不适用', U: '未完成' };
  function send(action, extras) { vscode.postMessage(Object.assign({ action }, extras || {})); }
  function renderTargetMode() {
    $('rootControls').hidden = targetMode !== 'root';
    $('fileControls').hidden = targetMode !== 'file';
    $('repositoryControls').hidden = targetMode !== 'repository';
    $('targetRoot').setAttribute('aria-pressed', String(targetMode === 'root'));
    $('targetFile').setAttribute('aria-pressed', String(targetMode === 'file'));
    $('targetRepository').setAttribute('aria-pressed', String(targetMode === 'repository'));
    vscode.setState({ targetMode, settingsOpen });
  }
  function renderSettings() {
    $('settingsPanel').hidden = !settingsOpen;
    $('settingsToggle').setAttribute('aria-expanded', String(settingsOpen));
    $('settingsToggle').setAttribute('aria-label', settingsOpen ? '关闭设置' : '打开设置');
    vscode.setState({ targetMode, settingsOpen });
  }
  $('targetRoot').onclick = () => { targetMode = 'root'; renderTargetMode(); };
  $('targetFile').onclick = () => { targetMode = 'file'; renderTargetMode(); };
  $('targetRepository').onclick = () => { targetMode = 'repository'; renderTargetMode(); };
  renderTargetMode();
  $('settingsToggle').onclick = () => { settingsOpen = !settingsOpen; renderSettings(); };
  renderSettings();
  $('scanWorkspace').onclick = () => send('scanWorkspace');
  $('scanFiles').onclick = () => send('scanFiles');
  $('scanRepository').onclick = () => send('scanRepository', { url: $('repoUrl').value.trim() });
  $('importRepositoryConfig').onclick = () => send('importRepositoryConfig');
  $('clearRepositoryConfig').onclick = () => send('clearRepositoryConfig');
  $('setApiKey').onclick = () => send('setApiKey');
  $('openSettings').onclick = () => send('openSettings');
  $('openReport').onclick = () => send('openReport');
  $('exportJson').onclick = () => send('exportJson');
  $('cancelScan').onclick = () => { $('cancelScan').disabled = true; send('cancelScan'); };
  $('categoryFilter').onchange = () => { visibleCount = pageSize; renderFindings(); };
  $('fileFilter').onchange = () => { visibleCount = pageSize; renderFileVoidToggle(); renderFindings(); };
  $('fileVoidToggle').onclick = () => { const path = $('fileFilter').value; if (path !== 'all') send('toggleFileVoid', { path }); };
  $('showMore').onclick = () => { visibleCount += pageSize; renderFindings(); };
  function make(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = String(content); return node; }
  function renderFileVoidToggle() {
    const file = current?.fileRows?.find(item => item.path === $('fileFilter').value);
    $('fileVoidToggle').hidden = !file?.voidable;
    $('fileVoidHint').hidden = !file?.voidable;
    if (file?.voidable) $('fileVoidToggle').textContent = file.voided ? '恢复整个文件' : 'void 整个文件';
  }
  function renderFindings() {
    if (!current) return;
    const filter = $('categoryFilter').value;
    const file = $('fileFilter').value;
    const items = current.findings.filter(item => (filter === 'all' || item.category === filter) && (file === 'all' || item.path === file));
    $('findingTitle').textContent = '具体问题 · ' + items.filter(item => !item.voided).length + ' 条生效';
    const list = $('findingList'); list.replaceChildren();
    if (!items.length) list.append(make('p', 'hint', '没有符合筛选条件的问题。'));
    for (const item of items.slice(0, visibleCount)) {
      const card = make('article', 'finding ' + item.severity + (item.voided ? ' voided' : ''));
      const top = make('div', 'finding-top');
      top.append(make('span', '', categoryNames[item.category] || item.category), make('span', 'severity', severityNames[item.severity]));
      card.append(top, make('div', 'location', item.path + (item.line ? ':' + item.line : '') + ' · ' + (item.evidenceType === 'ai-inference' ? 'AI 推断' : '静态规则匹配') + ' · 置信度 ' + ({ high: '高', medium: '中', low: '低' }[item.confidence] || '中')), make('div', 'reason', item.message));
      if (item.voidable) { const toggle = make('button', 'void-button', item.voided ? '恢复计分' : 'void 此判断'); toggle.onclick = () => send('toggleVoid', { key: item.voidKey }); card.append(toggle); }
      else if (item.fileVoided) card.append(make('div', 'hint', '文件已 void，可在文件列表恢复。'));
      if (item.openable) { const open = make('button', 'open', '打开文件位置 →'); open.onclick = () => send('openFinding', { index: item.index }); card.append(open); }
      list.append(card);
    }
    $('showMore').hidden = items.length <= visibleCount;
    $('showMore').textContent = '显示更多 · 已显示 ' + Math.min(visibleCount, items.length) + ' / ' + items.length + ' 条';
  }
  window.addEventListener('message', event => {
    if (event.data?.type !== 'state') return;
    const state = event.data;
    busy = Boolean(state.busy);
    for (const id of ['scanWorkspace','scanFiles','scanRepository','importRepositoryConfig','clearRepositoryConfig']) $(id).disabled = busy;
    $('progressPanel').hidden = !busy;
    $('status').hidden = busy;
    $('progressTitle').textContent = state.message || '正在评分…';
    $('cancelScan').disabled = !busy || state.message === '正在取消评分…';
    const progress = Number.isFinite(state.progress) ? Math.max(0, Math.min(100, state.progress)) : undefined;
    $('progressTrack').classList.toggle('determinate', progress !== undefined);
    $('progressFill').style.width = progress === undefined ? '32%' : progress + '%';
    $('progressPercent').textContent = progress === undefined ? '进行中' : '本阶段 ' + Math.round(progress) + '%';
    if (progress === undefined) { $('progressTrack').removeAttribute('aria-valuenow'); $('progressTrack').removeAttribute('aria-valuetext'); }
    else { $('progressTrack').setAttribute('aria-valuenow', String(Math.round(progress))); $('progressTrack').setAttribute('aria-valuetext', state.message || '当前阶段'); }
    $('status').textContent = state.message || '';
    $('repositoryConfigStatus').textContent = state.repositoryConfigName ? '已导入 ' + state.repositoryConfigName + '，按其规则筛选仓库文件。' : '未导入规则：扫描仓库中的有效代码。';
    $('clearRepositoryConfig').hidden = !state.repositoryConfigName;
    $('apiKeyStatus').textContent = state.apiKeyConfigured ? 'Key 已安全保存；每次评分自动进行 AI 审查。' : '未配置 Key：只运行本地规则。';
    $('activeFileName').textContent = state.activeFileName ? '当前文件：' + state.activeFileName : '先在编辑器中打开代码文件。';
    if (state.result) {
      const changed = current?.id !== state.result.id;
      const newScan = current?.scanId !== state.result.scanId;
      const selectedFile = newScan ? 'all' : $('fileFilter').value;
      const selectedCategory = newScan ? 'all' : $('categoryFilter').value;
      current = state.result;
      $('score').textContent = current.scoreDisplay;
      $('score').dataset.tone = current.score < 3 ? 'good' : current.score < 6 ? 'watch' : 'bad';
      $('summary').textContent = current.label + ' · ' + current.fileCount + ' 个文件 · 问题密度 ' + current.density + (current.voidedCount ? ' · 已 void ' + current.voidedCount + ' 项' : '');
      $('results').hidden = false;
      $('coverage').textContent = '跳过：' + current.skipped + ' · 解析：' + current.checks + ' · AI：' + current.ai;
      if (current.baseline) $('coverage').textContent += ' · Git 增量：' + current.baseline;
      const chips = $('categories'); chips.replaceChildren();
      for (const [key, value] of Object.entries(current.categoryCounts)) chips.append(make('span', 'chip', (categoryNames[key] || key) + ' ' + value + ' 条'));
      if (changed) {
        const fileSelect = $('fileFilter'); fileSelect.replaceChildren();
        const all = make('option', '', '全部文件'); all.value = 'all'; fileSelect.append(all);
        const ranking = $('fileRanking'); ranking.replaceChildren();
        for (const entry of current.fileRows) {
          const option = make('option', '', entry.path + ' · ' + entry.totalFindings + ' 条' + (entry.voided ? ' · 已 void' : '')); option.value = entry.path; fileSelect.append(option);
        }
        fileSelect.value = current.fileRows.some(item => item.path === selectedFile) ? selectedFile : 'all';
        $('categoryFilter').value = selectedCategory;
        const ranked = [...current.fileRows].filter(item => item.totalFindings > 0 || item.voided)
          .sort((a, b) => Number(a.voided) - Number(b.voided) || b.activeFindings - a.activeFindings || a.path.localeCompare(b.path));
        for (const entry of [...ranked.filter(item => !item.voided).slice(0, 10), ...ranked.filter(item => item.voided)]) {
          const row = make('div', 'rank' + (entry.voided ? ' voided' : ''));
          const select = make('button', 'rank-select'); select.title = entry.path + ' · ' + entry.totalFindings + ' 条问题';
          select.append(make('span', '', entry.path), make('strong', '', entry.activeFindings + ' 条'));
          select.onclick = () => { fileSelect.value = entry.path; visibleCount = pageSize; renderFileVoidToggle(); renderFindings(); };
          row.append(select);
          if (entry.voidable) {
            const toggle = make('button', 'void-button', entry.voided ? '恢复' : 'void');
            toggle.title = entry.voided ? '恢复整个文件计分' : 'void 整个文件';
            toggle.onclick = () => send('toggleFileVoid', { path: entry.path });
            row.append(toggle);
          }
          ranking.append(row);
        }
        if (!ranking.childNodes.length) ranking.append(make('p', 'hint', '没有发现可计分的文件问题。'));
        const assessments = [...(current.aiAssessments || [])].sort((a, b) => Number(a.voided) - Number(b.voided));
        $('aiGradeTitle').textContent = 'AI 分项等级 · ' + assessments.length + ' 项';
        const gradeList = $('aiAssessmentList'); gradeList.replaceChildren();
        if (!assessments.length) gradeList.append(make('p', 'hint', '未启用 AI，或没有通过校验的分项评分。'));
        for (const item of assessments) {
          const row = make('article', 'grade-row ' + item.grade + (item.voided ? ' voided' : ''));
          row.append(make('div', 'grade-score', item.grade + (item.adjustedFrom ? '（原建议 ' + item.adjustedFrom + '，校验后）' : '') + ' · ' + item.title + ' · ' + gradeSeverity[item.grade]),
            make('div', 'location', item.path + (item.line ? ':' + item.line : '')),
            make('div', 'reason', item.reason));
          if (item.voidable) { const toggle = make('button', 'void-button', item.voided ? '恢复计分' : 'void 此条目'); toggle.onclick = () => send('toggleVoid', { key: item.voidKey }); row.append(toggle); }
          else if (item.fileVoided) row.append(make('div', 'hint', '文件已 void，可在文件列表恢复。'));
          gradeList.append(row);
        }
        if (newScan) visibleCount = pageSize;
        renderFileVoidToggle();
        renderFindings();
      }
    }
  });
  send('ready');
</script></body></html>`;
}
