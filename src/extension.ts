import * as vscode from 'vscode';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { CodeFile, Finding, mergeAnalysis } from './analysis';
import { analyzeInWorker } from './analyzeAsync';
import { AiResult, analyzeWithAi } from './ai';
import { AI_BASE_POINTS, AI_CRITERIA, AI_RUBRIC_VERSION } from './aiRubric';
import { finalScore, formattedFinalScore } from './scoreTransform';
import { summaryMetrics } from './summaryMetrics';
import { compareGitBaseline, GitBaseline } from './gitBaseline';
import { cloneRepository, collectUris, directoryEntries, excludeIgnoredSelections, validateRepositoryUrl, workspaceEntries } from './collect';
import { LocalAiConfig, localConfigName, readLocalAiConfig } from './localConfig';
import { dashboardFindings, fileScores } from './dashboardData';
import { DashboardResult, SidebarAction, SidebarProvider } from './sidebar';

const secretKey = 'shitCodeDetector.ai.apiKey';
type Scope = 'workspace' | 'files' | 'repository';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Shit Code Detector');
  let latestReport: string | undefined;
  let latestJson: string | undefined;
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
          entries = await excludeIgnoredSelections(entries);
          if (!entries.length) throw new Error('所选文件均被 .gitignore 排除。');
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
        const analysisController = new AbortController();
        const analysisSubscription = token.onCancellationRequested(() => analysisController.abort());
        let result;
        try { result = await analyzeInWorker(collection.files, projectMode, analysisController.signal); }
        catch (error) { if (token.isCancellationRequested) throw new vscode.CancellationError(); throw error; }
        finally { analysisSubscription.dispose(); }
        const baselineRoot = selectedWorkspace?.uri.fsPath ?? (scope === 'workspace' && vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined);
        const baseline = scope === 'workspace' && baselineRoot ? await compareGitBaseline(baselineRoot, result) : undefined;
        let ai: AiResult | undefined;
        let localAi: LocalAiConfig = {};
        let localConfigError: string | undefined;
        try { localAi = await readLocalAiConfig((selectedWorkspace ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath); }
        catch (error) { localConfigError = `本地 AI 配置读取失败：${error instanceof Error ? error.message : String(error)}`; }
        const aiEnabled = Boolean(localConfigError) || (localAi.enabled ?? config.get<boolean>('ai.enabled', false));
        if (aiEnabled) {
          const apiKey = localConfigError ? undefined : localAi.apiKey || await context.secrets.get(secretKey);
          if (localConfigError) {
            ai = { findings: [], assessments: [], reviewedFiles: 0, reviewedProject: false, truncatedFiles: 0, errors: [localConfigError] };
          } else if (!apiKey) {
            ai = { findings: [], assessments: [], reviewedFiles: 0, reviewedProject: false, truncatedFiles: 0, errors: [`AI 已启用，但没有 API Key。请填写工作区根目录 ${localConfigName} 的 apiKey，或使用“设置 AI API Key”命令。`] };
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
                maxCharsPerFile: config.get<number>('ai.maxCharsPerFile', 12000),
                changedPaths: baseline?.changedPaths
              }, projectMode, controller.signal);
            } finally { subscription.dispose(); }
            result = mergeAnalysis(result, ai.findings);
          }
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        const metrics = summaryMetrics(result, ai?.assessments.filter(item => item.grade === 'U').length ?? 0);
        const report = makeReport(label, scope, result.score, result.categoryScores, result.findings, collection.files, collection.skipped, result.checkCoverage, aiEnabled, ai, metrics, baseline);
        latestReport = report;
        latestJson = JSON.stringify({ schemaVersion: 4, target: label, scope, score: finalScore(result.score), rawScore: result.score,
          scoreFormula: '9*x^3/(x^3+64000)', fileCount: collection.files.length, categoryContributions: result.categoryScores,
          metrics,
          baseline: baseline ? { available: baseline.baselineAvailable, changedPaths: baseline.changedPaths, introduced: baseline.introduced.map(({ points, ...finding }) => finding), note: baseline.note } : undefined,
          checkCoverage: result.checkCoverage, fileIssueCounts: fileScores(result.findings, collection.files).map(({ score, ...entry }) => entry),
          findings: result.findings.map(({ points, ...finding }) => finding), skipped: collection.skipped,
          ai: { enabled: aiEnabled, rubricVersion: AI_RUBRIC_VERSION, basePoints: AI_BASE_POINTS,
            criteria: AI_CRITERIA, assessments: (ai?.assessments ?? []).map(({ basePoints, weight, points, ...item }) => item), reviewedFiles: ai?.reviewedFiles ?? 0,
            reviewedProject: ai?.reviewedProject ?? false, truncatedFiles: ai?.truncatedFiles ?? 0, errors: ai?.errors ?? [] } }, null, 2) + '\n';
        latestFiles = collection.files;
        const dashboard: DashboardResult = {
          id: ++reportId, label, scope, score: finalScore(result.score), scoreDisplay: formattedFinalScore(result.score), fileCount: collection.files.length,
          density: metrics.issueDensity.toFixed(1) + ' / 千行', highRisk: metrics.highRisk,
          baseline: baseline?.baselineAvailable ? `${baseline.changedPaths.length} 个变更文件，${baseline.introduced.length} 条新增本地问题` : baseline?.note,
          skipped: `不支持 ${collection.skipped.unsupported} / 超大 ${collection.skipped.large} / 二进制 ${collection.skipped.binary} / 读取失败 ${collection.skipped.unreadable}`,
          checks: result.checkCoverage,
          ai: !aiEnabled ? '未启用' : `${ai?.reviewedFiles ?? 0}/${collection.files.length} 个文件完整分级，项目 ${ai?.reviewedProject ? '完成' : '未完成'}，${ai?.assessments.filter(item => item.adjustedFrom).length ?? 0} 项校验降级，${ai?.errors.length ?? 0} 个失败项`,
          aiAssessments: (ai?.assessments ?? []).map(({ basePoints, weight, points, ...item }) => item),
          categoryCounts: Object.fromEntries(Object.keys(result.categoryScores).map(category =>
            [category, result.findings.filter(finding => finding.category === category).length])) as Record<keyof typeof result.categoryScores, number>,
          fileScores: fileScores(result.findings, collection.files).map(({ score, ...item }) => item),
          findings: dashboardFindings(result.findings, collection.files)
        };
        sidebar.setResult(dashboard);
        await sidebar.reveal();
        output.appendLine(`${new Date().toISOString()} ${label}: ${formattedFinalScore(result.score)} / 9，${collection.files.length} 个文件`);
        vscode.window.showInformationMessage(`Shit Code Detector：${formattedFinalScore(result.score)} / 9，发现 ${result.findings.length} 个问题。`);
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

  async function exportJson(): Promise<void> {
    if (!latestJson) { vscode.window.showInformationMessage('请先完成一次评分。'); return; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const destination = await vscode.window.showSaveDialog({ saveLabel: '导出评分 JSON', filters: { JSON: ['json'] },
      defaultUri: root ? vscode.Uri.joinPath(root, 'shit-code-report.json') : undefined });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(latestJson));
    vscode.window.showInformationMessage(`评分 JSON 已导出：${destination.fsPath}`);
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
        case 'exportJson': await exportJson(); break;
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
    vscode.commands.registerCommand('shitCodeDetector.exportJson', () => exportJson()),
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

function makeReport(label: string, scope: Scope, rawScore: number, categoryScores: Record<string, number>, findings: Finding[], files: CodeFile[], skipped: Record<string, number>, checkCoverage: string, aiEnabled: boolean, ai: AiResult | undefined, metrics: ReturnType<typeof summaryMetrics>, baseline?: GitBaseline): string {
  const clean = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', 'ˋ');
  const severity = (finding: Finding): string => finding.aiGrade ? ({ B: '轻微', C: '一般', D: '较重', E: '严重' } as const)[finding.aiGrade]
    : finding.points >= 6 ? '严重' : finding.points >= 4 ? '较重' : finding.points >= 2 ? '一般' : '轻微';
  const categoryCounts = Object.fromEntries(Object.keys(categoryScores).map(category =>
    [category, findings.filter(finding => finding.category === category).length]));
  const lines = [
    '# Shit Code Detector 评分报告', '',
    `- 对象：${clean(label)}`,
    `- 模式：${scope === 'workspace' ? '工作区' : scope === 'files' ? '选定文件' : 'HTTPS Git 仓库'}`,
    `- 最终分：**${formattedFinalScore(rawScore)} / 9**（越高越 shit）`,
    `- 问题密度：${metrics.issueDensity.toFixed(1)} / 千行有效代码（小项目按 200 行平滑）`,
    `- 高风险状态：${metrics.highRisk ? '发现静态确认的高风险正确性或安全问题' : '未发现静态确认的高风险问题'}`,
    `- 已分析：${files.length} 个代码文件`,
    `- 跳过：不支持或生成文件 ${skipped.unsupported}，超大文件 ${skipped.large}，二进制 ${skipped.binary}，读取失败 ${skipped.unreadable}`,
    `- 静态解析：${checkCoverage}`,
    `- AI：${!aiEnabled ? '未启用' : `${ai?.reviewedFiles ?? 0}/${files.length} 个文件完成全部条目分级；项目分级${ai?.reviewedProject ? '完成' : '未完成'}；截断片段 ${ai?.truncatedFiles ?? 0} 个`}`,
    `- AI 未完成条目：${metrics.uncertainAssessments}`, '', '## 语言覆盖', '',
    '| 语言 | 文件数 | 分析能力 | 语法失败文件数 |', '| --- | ---: | --- | ---: |',
    ...metrics.languageCoverage.map(item => `| ${item.language} | ${item.files} | ${item.parser} | ${item.parseFailures} |`),
    '', '## Git 增量', '',
    baseline?.baselineAvailable ? `相对 HEAD，${baseline.changedPaths.length} 个变更文件中发现 ${baseline.introduced.length} 条新增本地规则问题。` : baseline?.note ?? '此模式不提供 Git 基线。',
    ...(baseline?.introduced.length ? ['', '| 严重程度 | 位置 | 说明 |', '| --- | --- | --- |',
      ...baseline.introduced.map(item => `| ${severity(item)} | ${clean(item.path)}${item.line ? `:${item.line}` : ''} | ${clean(item.message)} |`)] : []),
    '', '## 分类问题数', '',
    '| 架构 | 复杂度 | 重复 | 风格 | 命名 | 可读性 | 一致性 | 正确性 | 安全 |', '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${categoryCounts.architecture} | ${categoryCounts.complexity} | ${categoryCounts.duplication} | ${categoryCounts.style} | ${categoryCounts.naming} | ${categoryCounts.readability} | ${categoryCounts.consistency} | ${categoryCounts.correctness} | ${categoryCounts.security} |`,
    '', '## AI 分项评分', '',
    `评分表版本：${AI_RUBRIC_VERSION}。等级基础分：${Object.entries(AI_BASE_POINTS).map(([grade, points]) => `${grade}=${points}`).join('、')}；内部按基础分 × 固定权重累计。`, '',
    '| 条目 | 范围 | 类别 | 权重 |', '| --- | --- | --- | ---: |',
    ...AI_CRITERIA.map(item => `| ${clean(item.title)} | ${item.scope === 'file' ? '文件' : '项目'} | ${item.category} | ${item.weight} |`),
    '',
    ...(ai?.assessments.length ? [
      '| 对象 | 条目 | 等级 | 严重程度 | 证据 |', '| --- | --- | --- | --- | --- |',
      ...ai.assessments.map(item => `| ${clean(item.path)} | ${clean(item.title)} | ${item.grade}${item.adjustedFrom ? `（原建议 ${item.adjustedFrom}，校验后）` : ''} | ${{ A: '无问题', B: '轻微', C: '一般', D: '较重', E: '严重', 'N/A': '不适用', U: '未完成' }[item.grade]} | ${clean(item.reason)} |`),
      ''
    ] : ['没有已完成的 AI 分项评分。', '']),
    '## 文件分数', '',
    '文件问题数只包含定位到该文件的问题；项目级问题计入总分。', '',
    '| 文件 | 问题数 |', '| --- | ---: |',
    ...fileScores(findings, files).map(item => `| ${clean(item.path)} | ${item.findings} |`),
    '', '## 具体问题', ''
  ];
  if (!findings.length) lines.push('没有发现符合当前规则的问题。');
  else {
    lines.push('| 严重程度 | 类别 | 证据类型 | 置信度 | 位置 | 说明 |', '| --- | --- | --- | --- | --- | --- |');
    for (const finding of [...findings].sort((a, b) => b.points - a.points || a.path.localeCompare(b.path))) {
      const file = files.find(item => item.path === finding.path);
      const location = `${finding.path}${finding.line ? `:${finding.line}` : ''}`;
      const linked = file?.uri ? `[${clean(location)}](${file.uri}${finding.line ? `#L${finding.line}` : ''})` : clean(location);
      lines.push(`| ${severity(finding)} | ${finding.category} | ${finding.evidenceType === 'ai-inference' ? 'AI 推断' : '静态确认'} | ${finding.confidence ?? '中'} | ${linked} | ${clean(finding.message)} |`);
    }
  }
  if (ai?.errors.length) lines.push('', '## AI 未完成项', '', ...ai.errors.map(error => `- ${clean(error)}`));
  lines.push('', '## 评分说明', '', '内部累计值 x = 本地规则分类聚合值（维护性信号含规模平滑，各类上限和系数见 SCORING.md）+ Σ（有效 AI 分项基础分 × 固定条目权重）；最终分 f(x)=9x³/(x³+64000)。AI 条目不受本地类别系数与规模平滑影响。A 不计分；U 表示未审查完成，N/A 表示不适用。静态规则匹配不等于运行测试。详见 `SCORING.md` 与 `AI_RUBRIC.md`。', '');
  return lines.join('\n');
}
