import * as vscode from 'vscode';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { analyze, CodeFile, Finding } from './analysis';
import { AiResult, analyzeWithAi } from './ai';
import { cloneRepository, collectUris, directoryEntries, validateRepositoryUrl, workspaceEntries } from './collect';
import { LocalAiConfig, localConfigName, readLocalAiConfig } from './localConfig';
import { dashboardFindings } from './dashboardData';
import { DashboardResult, SidebarAction, SidebarProvider } from './sidebar';

const secretKey = 'shitCodeDetector.ai.apiKey';
type Scope = 'workspace' | 'files' | 'repository';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Shit Code Detector');
  let latestReport: string | undefined;
  let latestFiles: CodeFile[] = [];
  let reportId = 0;
  let running = false;
  const sidebar = new SidebarProvider(handleSidebarAction);
  sidebar.setWorkspaces(vscode.workspace.workspaceFolders);
  context.subscriptions.push(output, vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar), vscode.workspace.onDidChangeWorkspaceFolders(() => sidebar.setWorkspaces(vscode.workspace.workspaceFolders)));

  async function run(scope: Scope, target?: { workspace?: string; url?: string }): Promise<void> {
    if (running) { vscode.window.showInformationMessage('Shit Code Detector：当前评分尚未完成。'); return; }
    running = true;
    let cleanup: (() => Promise<void>) | undefined;
    try {
      if (scope === 'workspace' && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区，再扫描整个项目。');
      sidebar.setBusy(true, '正在准备评分…');
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Shit Code Detector 正在评分', cancellable: true }, async (progress, token) => {
        progress.report({ message: '收集代码文件' });
        let entries: { uri: vscode.Uri; path: string }[];
        let label: string;
        let selectedWorkspace: vscode.WorkspaceFolder | undefined;
        if (scope === 'workspace') {
          const selected = target?.workspace ? vscode.workspace.workspaceFolders?.find(folder => folder.uri.toString() === target.workspace) : undefined;
          if (target?.workspace && !selected) throw new Error('所选工作区已不存在，请重新选择。');
          selectedWorkspace = selected;
          entries = await workspaceEntries(token, selected);
          const folders = vscode.workspace.workspaceFolders ?? [];
          label = selected?.name ?? (folders.length > 1 ? `全部工作区（${folders.map(folder => folder.name).join('、')}）` : folders[0]?.name ?? '当前工作区');
        } else if (scope === 'files') {
          const selected = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, openLabel: '选择要评分的代码文件' });
          if (!selected?.length) { sidebar.setBusy(false); return; }
          entries = selected.map(uri => ({ uri, path: path.basename(uri.fsPath) }));
          selectedWorkspace = vscode.workspace.getWorkspaceFolder(selected[0]);
          // 重名文件使用完整路径区分，以免报告中的定位发生碰撞。
          const counts = new Map<string, number>();
          for (const entry of entries) counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
          entries = entries.map(entry => counts.get(entry.path)! > 1 ? { ...entry, path: entry.uri.fsPath.replaceAll('\\', '/') } : entry);
          label = '选定文件';
        } else {
          const input = target?.url ?? await vscode.window.showInputBox({ prompt: '输入公开 HTTPS Git 仓库地址', placeHolder: 'https://github.com/owner/repository.git', ignoreFocusOut: true });
          if (!input && target?.url === undefined) { sidebar.setBusy(false); return; }
          if (!input?.trim()) throw new Error('请输入 HTTPS Git 仓库地址。');
          const url = validateRepositoryUrl(input);
          progress.report({ message: '克隆 Git 仓库' });
          const clone = await cloneRepository(url, token);
          cleanup = clone.cleanup;
          entries = await directoryEntries(clone.directory, token);
          label = url;
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        const config = vscode.workspace.getConfiguration('shitCodeDetector');
        const maxFileBytes = config.get<number>('maxFileBytes', 524288);
        progress.report({ message: `读取 ${entries.length} 个候选文件` });
        const collection = await collectUris(entries, maxFileBytes, token, scope === 'files');
        if (scope === 'repository') collection.files.forEach(file => { file.uri = undefined; });
        if (!collection.files.length) throw new Error('没有找到可评分的代码文件。请检查文件类型或排除规则。');
        progress.report({ message: `运行本地规则（${collection.files.length} 个文件）` });
        const projectMode = scope !== 'files';
        let result = analyze(collection.files, [], projectMode);
        let ai: AiResult | undefined;
        let localAi: LocalAiConfig = {};
        let localConfigError: string | undefined;
        try { localAi = await readLocalAiConfig((selectedWorkspace ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath); }
        catch (error) { localConfigError = `本地 AI 配置读取失败：${error instanceof Error ? error.message : String(error)}`; }
        const aiEnabled = Boolean(localConfigError) || (localAi.enabled ?? config.get<boolean>('ai.enabled', false));
        if (aiEnabled) {
          const apiKey = localConfigError ? undefined : localAi.apiKey || await context.secrets.get(secretKey);
          if (localConfigError) {
            ai = { findings: [], reviewedFiles: 0, truncatedFiles: 0, errors: [localConfigError] };
          } else if (!apiKey) {
            ai = { findings: [], reviewedFiles: 0, truncatedFiles: 0, errors: [`AI 已启用，但没有 API Key。请填写工作区根目录 ${localConfigName} 的 apiKey，或使用“设置 AI API Key”命令。`] };
          } else {
            progress.report({ message: '请求 AI 审查' });
            const controller = new AbortController();
            const subscription = token.onCancellationRequested(() => controller.abort());
            try {
              ai = await analyzeWithAi(result, {
                baseUrl: localAi.baseUrl || config.get<string>('ai.baseUrl', 'https://api.deepseek.com'),
                model: localAi.model || config.get<string>('ai.model', 'deepseek-v4-flash'),
                apiKey,
                maxFiles: config.get<number>('ai.maxFiles', 30),
                maxCharsPerFile: config.get<number>('ai.maxCharsPerFile', 12000)
              }, projectMode, controller.signal);
            } finally { subscription.dispose(); }
            result = analyze(collection.files, ai.findings, projectMode);
          }
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        const report = makeReport(label, scope, result.score, result.categoryScores, result.findings, collection.files, collection.skipped, aiEnabled, ai);
        latestReport = report;
        latestFiles = collection.files;
        const dashboard: DashboardResult = {
          id: ++reportId, label, scope, score: result.score, fileCount: collection.files.length,
          skipped: `不支持 ${collection.skipped.unsupported} / 超大 ${collection.skipped.large} / 二进制 ${collection.skipped.binary} / 读取失败 ${collection.skipped.unreadable}`,
          ai: !aiEnabled ? '未启用' : `${ai?.reviewedFiles ?? 0}/${collection.files.length} 个文件，${ai?.errors.length ?? 0} 个失败项`,
          categoryScores: result.categoryScores,
          findings: dashboardFindings(result.findings, collection.files)
        };
        sidebar.setResult(dashboard);
        await sidebar.reveal();
        output.appendLine(`${new Date().toISOString()} ${label}: ${result.score} 分，${collection.files.length} 个文件`);
        vscode.window.showInformationMessage(`Shit Code Detector：${result.score} 分，发现 ${result.findings.length} 个问题。`);
      });
    } catch (error) {
      if (error instanceof vscode.CancellationError) sidebar.setBusy(false, '已取消评分');
      else {
        const message = error instanceof Error ? error.message : String(error);
        sidebar.setError(message);
        output.appendLine(`错误：${message}`);
        vscode.window.showErrorMessage(`Shit Code Detector：${message}`);
      }
    } finally {
      try { await cleanup?.(); }
      finally { running = false; }
    }
  }

  async function openAiConfig(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root || root.scheme !== 'file') throw new Error('请先打开本地工作区，再编辑 ai.local.json。');
    const configPath = path.join(root.fsPath, localConfigName);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(configPath));
    } catch {
      await writeFile(configPath, JSON.stringify({ enabled: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'YOUR_DEEPSEEK_API_KEY_HERE' }, null, 2) + '\n', { flag: 'wx' });
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(configPath));
  }

  async function showReport(): Promise<void> {
    if (!latestReport) { vscode.window.showInformationMessage('请先完成一次评分。'); return; }
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: latestReport });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function handleSidebarAction(message: SidebarAction): Promise<void> {
    try {
      switch (message.action) {
        case 'scanWorkspace': await run('workspace', { workspace: message.workspace }); break;
        case 'scanFiles': await run('files'); break;
        case 'scanRepository': await run('repository', { url: message.url }); break;
        case 'openAiConfig': await openAiConfig(); break;
        case 'setApiKey': await vscode.commands.executeCommand('shitCodeDetector.setApiKey'); break;
        case 'openReport': await showReport(); break;
        case 'openFinding': {
          if (!Number.isInteger(message.index)) break;
          const item = sidebar.getFinding(message.index);
          const file = latestFiles.find(candidate => candidate.path === item?.path);
          if (!item?.openable || !file?.uri) break;
          const line = Math.max(0, (item.line ?? 1) - 1);
          await vscode.window.showTextDocument(vscode.Uri.parse(file.uri), { selection: new vscode.Range(line, 0, line, 0) });
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sidebar.setError(message);
      vscode.window.showErrorMessage(`Shit Code Detector：${message}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('shitCodeDetector.scanWorkspace', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) { await run('workspace'); return; }
      if (folders.length === 1) { await run('workspace', { workspace: folders[0].uri.toString() }); return; }
      const choices = [{ label: '全部工作区', uri: undefined }, ...folders.map(folder => ({ label: folder.name, uri: folder.uri.toString() }))];
      const picked = await vscode.window.showQuickPick(choices, { placeHolder: '选择要评分的工作区' });
      if (picked) await run('workspace', { workspace: picked.uri });
    }),
    vscode.commands.registerCommand('shitCodeDetector.scanFiles', () => run('files')),
    vscode.commands.registerCommand('shitCodeDetector.scanRepository', () => run('repository')),
    vscode.commands.registerCommand('shitCodeDetector.openAiConfig', async () => {
      try { await openAiConfig(); }
      catch (error) { vscode.window.showErrorMessage(`Shit Code Detector：${error instanceof Error ? error.message : String(error)}`); }
    }),
    vscode.commands.registerCommand('shitCodeDetector.setApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: '输入 AI API Key（留空并确认可删除已保存的 Key）', password: true, ignoreFocusOut: true });
      if (key === undefined) return;
      if (key.trim()) await context.secrets.store(secretKey, key.trim());
      else await context.secrets.delete(secretKey);
      vscode.window.showInformationMessage(key.trim() ? 'AI API Key 已保存到 VS Code SecretStorage。' : 'AI API Key 已删除。');
    })
  );
}

export function deactivate(): void { /* 无持久进程 */ }

function makeReport(label: string, scope: Scope, score: number, categoryScores: Record<string, number>, findings: Finding[], files: CodeFile[], skipped: Record<string, number>, aiEnabled: boolean, ai?: AiResult): string {
  const clean = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', 'ˋ');
  const lines = [
    '# Shit Code Detector 评分报告', '',
    `- 对象：${clean(label)}`,
    `- 模式：${scope === 'workspace' ? '工作区' : scope === 'files' ? '选定文件' : 'HTTPS Git 仓库'}`,
    `- 总分：**${score}**（越高越 shit，无上限）`,
    `- 已分析：${files.length} 个代码文件`,
    `- 跳过：不支持或生成文件 ${skipped.unsupported}，超大文件 ${skipped.large}，二进制 ${skipped.binary}，读取失败 ${skipped.unreadable}`,
    `- AI：${!aiEnabled ? '未启用' : `${ai?.reviewedFiles ?? 0}/${files.length} 个文件完成语义审查；截断片段 ${ai?.truncatedFiles ?? 0} 个`}`,
    '', '## 分类分数', '',
    '| 架构 | 风格 | 命名 | 可读性 | 一致性 |', '| ---: | ---: | ---: | ---: | ---: |',
    `| ${categoryScores.architecture} | ${categoryScores.style} | ${categoryScores.naming} | ${categoryScores.readability} | ${categoryScores.consistency} |`,
    '', '## 具体问题', ''
  ];
  if (!findings.length) lines.push('没有发现符合当前规则的问题。');
  else {
    lines.push('| 分数 | 类别 | 来源 | 位置 | 说明 |', '| ---: | --- | --- | --- | --- |');
    for (const finding of [...findings].sort((a, b) => b.points - a.points || a.path.localeCompare(b.path))) {
      const file = files.find(item => item.path === finding.path);
      const location = `${finding.path}${finding.line ? `:${finding.line}` : ''}`;
      const linked = file?.uri ? `[${clean(location)}](${file.uri}${finding.line ? `#L${finding.line}` : ''})` : clean(location);
      lines.push(`| +${finding.points} | ${finding.category} | ${finding.source} | ${linked} | ${clean(finding.message)} |`);
    }
  }
  if (ai?.errors.length) lines.push('', '## AI 未完成项', '', ...ai.errors.map(error => `- ${clean(error)}`));
  lines.push('', '## 评分说明', '', '总分 = 所有本地规则罚分 + 所有有效 AI 问题罚分；AI 严重度 1–5 分别折算为 2、4、6、8、10 分。分数不截断、不归一化。架构评估仅用于工作区和 Git 仓库模式；详见 `SCORING.md`。', '');
  return lines.join('\n');
}
