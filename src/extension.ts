import * as vscode from 'vscode';
import path from 'node:path';
import { CodeFile, Finding, mergeAnalysis, REFERENCE_CODE_LINES } from './analysis';
import { analyzeInWorker } from './analyzeAsync';
import { AiResult, analyzeWithAi, planAiRequests } from './ai';
import { AI_BASE_POINTS, AI_CRITERIA, AI_RUBRIC_VERSION } from './aiRubric';
import { finalScore, formattedFinalScore, SCORE_FORMULA } from './scoreTransform';
import { summaryMetrics } from './summaryMetrics';
import { compareGitBaseline, GitBaseline } from './gitBaseline';
import { cloneRepository, collectActiveDocument, collectUris, directoryEntries, ScanEntry, validateRepositoryUrl, workspaceEntries } from './collect';
import { ScanConfig, ScanRuleDraft, scanConfigFromDraft, validateScanRuleDraft } from './scanConfig';
import { dashboardFindings, fileScores } from './dashboardData';
import { DashboardResult, SidebarAction, SidebarProvider } from './sidebar';
import { assessmentVoidKey, buildVoidScoreModel, findingVoidKey } from './voidScore';
import { ScanProgress, ScanScope } from './scanProgress';

const secretKey = 'shitCodeDetector.ai.apiKey';
type Scope = ScanScope;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Shit Code Detector');
  let latestReport: string | undefined;
  let latestJson: string | undefined;
  let latestFiles: CodeFile[] = [];
  let toggleCurrentVoid: ((key: string) => void) | undefined;
  let toggleCurrentFileVoid: ((filePath: string) => void) | undefined;
  let cancelCurrentScan: (() => void) | undefined;
  let reportId = 0;
  let running = false;
  let repositoryConfig: ScanConfig | undefined;
  let lastEditor = vscode.window.activeTextEditor;
  const sidebar = new SidebarProvider(handleSidebarAction, context.extensionUri);
  sidebar.setActiveFileName(lastEditor ? path.basename(lastEditor.document.uri.path) : undefined);
  void context.secrets.get(secretKey).then(key => sidebar.setApiKeyConfigured(Boolean(key)), () => undefined);
  context.subscriptions.push(output, vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) lastEditor = editor;
      sidebar.setActiveFileName(lastEditor ? path.basename(lastEditor.document.uri.path) : undefined);
    }));

  async function run(scope: Scope, target?: { url?: string; ruleSource?: 'workspace' | 'all' | 'inline'; rule?: ScanRuleDraft }): Promise<void> {
    if (running) return;
    running = true;
    let cleanup: (() => Promise<void>) | undefined;
    const cancellation = new vscode.CancellationTokenSource();
    const token = cancellation.token;
    cancelCurrentScan = () => cancellation.cancel();
    const editor = scope === 'files' ? (vscode.window.activeTextEditor ?? lastEditor) : undefined;
    try {
      if (scope === 'workspace' && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区，再扫描整个项目。');
      sidebar.setBusy(true, '正在准备评分…', 0);
      void sidebar.reveal().catch(error => output.appendLine(`打开评分侧边栏失败：${error instanceof Error ? error.message : String(error)}`));
      let overallProgress = 0;
      const progress = { report: (update: { message: string; percentage?: number }) => {
        if (token.isCancellationRequested) return;
        overallProgress = Math.max(overallProgress, Math.min(100, update.percentage ?? overallProgress));
        sidebar.setBusy(true, update.message, overallProgress);
      } };
      const executeScan = async (): Promise<void> => {
        progress.report({ message: '查找代码文件…', percentage: 0 });
        await new Promise<void>(resolve => setImmediate(resolve));
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        let entries: ScanEntry[];
        let label: string;
        let selectedWorkspace: vscode.WorkspaceFolder | undefined;
        let singleFileCollection: Awaited<ReturnType<typeof collectActiveDocument>> | undefined;
        const config = vscode.workspace.getConfiguration('shitCodeDetector');
        const maxFileBytes = config.get<number>('maxFileBytes', 0);
        const apiKey = await context.secrets.get(secretKey);
        const aiEnabled = Boolean(apiKey);
        const plan = new ScanProgress();
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        let lastDiscoveryUpdate = 0;
        const onDiscovered = (count: number): void => {
          const now = Date.now();
          if (count === 1 || now - lastDiscoveryUpdate >= 150) {
            progress.report({ message: `已找到 ${count} 个候选文件…`, percentage: plan.stage('discovery') });
            lastDiscoveryUpdate = now;
          }
        };
        if (scope === 'workspace') {
          selectedWorkspace = vscode.workspace.workspaceFolders?.[0];
          if (!selectedWorkspace) throw new Error('请先打开一个工作区根目录。');
          const rule = target?.ruleSource === 'inline' ? scanConfigFromDraft(target.rule) : undefined;
          entries = await workspaceEntries(token, selectedWorkspace, onDiscovered, rule);
          label = `当前项目：${selectedWorkspace.name}`;
        } else if (scope === 'files') {
          if (!editor) throw new Error('请先在编辑器中打开要评分的代码文件。');
          if (!vscode.window.visibleTextEditors.some(item => item.document.uri.toString() === editor.document.uri.toString())) {
            throw new Error('请先在编辑器中打开要评分的代码文件。');
          }
          singleFileCollection = await collectActiveDocument(editor.document, maxFileBytes);
          entries = [];
          selectedWorkspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
          label = `当前文件：${path.basename(editor.document.uri.path)}${editor.document.isDirty ? '（含未保存修改）' : ''}`;
        } else {
          const input = target?.url ?? await vscode.window.showInputBox({ prompt: '输入公开 HTTPS Git 仓库地址', placeHolder: 'https://github.com/owner/repository.git', ignoreFocusOut: true });
          if (!input && target?.url === undefined) { sidebar.setBusy(false); return; }
          if (!input?.trim()) throw new Error('请输入 HTTPS Git 仓库地址。');
          const url = validateRepositoryUrl(input);
          const rule = target?.ruleSource === 'inline' ? scanConfigFromDraft(target.rule) :
            target?.ruleSource === 'all' ? undefined : repositoryConfig;
          progress.report({ message: '克隆 Git 仓库', percentage: plan.stage('discovery') });
          const clone = await cloneRepository(url, token);
          cleanup = clone.cleanup;
          progress.report({ message: '查找仓库代码文件…', percentage: plan.stage('discovery', 1, 2) });
          entries = await directoryEntries(clone.directory, token, rule, onDiscovered);
          label = url;
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        plan.stage('discovery', 1, 1);
        const candidateCount = singleFileCollection ? 1 : entries.length;
        progress.report({ message: `读取代码文件 0/${candidateCount}`, percentage: plan.stage('read', 0, candidateCount) });
        const collection = singleFileCollection ?? await collectUris(entries, maxFileBytes, token, false,
          (completed, total) => progress.report({ message: `读取代码文件 ${completed}/${total}`, percentage: plan.stage('read', completed, total) }));
        if (singleFileCollection) progress.report({ message: '读取代码文件 1/1', percentage: plan.stage('read', 1, 1) });
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        if (scope === 'repository') collection.files.forEach(file => { file.uri = undefined; });
        if (!collection.files.length) throw new Error('没有找到可评分的代码文件。请检查 .shitcode／.shitcode_ignore、文件类型或排除规则。');
        const projectMode = scope !== 'files';
        const maxCharsPerRequest = config.get<number>('ai.maxCharsPerRequest', 12000);
        if (aiEnabled) progress.report({ message: '统计 AI 评分任务…', percentage: plan.stage('read', candidateCount, candidateCount) });
        const aiWork = aiEnabled ? await planAiRequests(collection.files, maxCharsPerRequest, projectMode) : { fileRequests: 0, projectRequests: 0 };
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        plan.configure(collection.files.length, aiWork.fileRequests, aiWork.projectRequests);
        progress.report({ message: `本地规则 0/${collection.files.length} 个文件`, percentage: plan.stage('local', 0, collection.files.length) });
        const analysisController = new AbortController();
        const analysisSubscription = token.onCancellationRequested(() => analysisController.abort());
        let result;
        try { result = await analyzeInWorker(collection.files, projectMode, analysisController.signal, (completed, total, phase) => {
          if (phase === 'finalize') progress.report({ message: '汇总本地与跨文件检查…', percentage: plan.stage('local', completed, total) });
          else progress.report({ message: `本地规则 ${completed}/${total} 个文件`, percentage: plan.stage('local', completed, total) });
        }); }
        catch (error) { if (token.isCancellationRequested) throw new vscode.CancellationError(); throw error; }
        finally { analysisSubscription.dispose(); }
        const baselineRoot = selectedWorkspace?.uri.fsPath;
        if (scope === 'workspace' && baselineRoot) progress.report({ message: '比对 Git 基线…', percentage: plan.stage('baseline') });
        const baseline = scope === 'workspace' && baselineRoot ? await compareGitBaseline(baselineRoot, result) : undefined;
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        if (scope === 'workspace' && baselineRoot) plan.stage('baseline', 1, 1);
        let ai: AiResult | undefined;
        if (apiKey) {
          progress.report({ message: '准备 AI 审查…', percentage: plan.stage('aiFiles') });
          const controller = new AbortController();
          const subscription = token.onCancellationRequested(() => controller.abort());
          try {
            ai = await analyzeWithAi(result, {
              baseUrl: config.get<string>('ai.baseUrl', 'https://api.deepseek.com'),
              model: config.get<string>('ai.model', 'deepseek-flash'),
              apiKey,
              maxCharsPerRequest,
              onProgress: (completed, total) => progress.report({ message: `AI 文件审查轮次 ${completed}/${total}`, percentage: plan.stage('aiFiles', completed, total) }),
              onProjectProgress: (completed, total) => progress.report({ message: `AI 项目审查轮次 ${completed}/${total}`, percentage: plan.stage('aiProject', completed, total) })
            }, projectMode, controller.signal);
          } finally { subscription.dispose(); }
          result = mergeAnalysis(result, ai.findings);
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        progress.report({ message: '整理评分结果…', percentage: plan.stage('report') });
        const fullResult = result;
        const scanId = ++reportId;
        const voidModel = buildVoidScoreModel(fullResult);
        const voided = new Set<string>();
        const voidedFiles = new Set<string>();
        const pathByVoidKey = new Map(fullResult.findings.map((finding, index) => [findingVoidKey(finding, index), finding.path]));
        latestFiles = collection.files;
        const publish = (): void => {
          const scored = voidModel.apply(voided, voidedFiles);
          const metrics = summaryMetrics(scored, ai?.assessments.filter(item => item.grade === 'U').length ?? 0);
          const allFindings = fullResult.findings;
          latestReport = makeReport(label, scope, scored.score, scored.categoryScores, scored.findings, collection.files,
            collection.skipped, scored.checkCoverage, aiEnabled, ai, metrics, baseline, allFindings, voided, voidedFiles);
          latestJson = JSON.stringify({ schemaVersion: 12, target: label, scope, score: finalScore(scored.score), rawScore: scored.score,
            referenceCodeLines: REFERENCE_CODE_LINES, effectiveCodeLines: metrics.effectiveLines,
            scoreFormula: SCORE_FORMULA, fileCount: collection.files.length, categoryContributions: scored.categoryScores,
            metrics, voidedJudgments: [...voided], voidedFiles: [...voidedFiles],
            baseline: baseline ? { available: baseline.baselineAvailable, changedPaths: baseline.changedPaths, introduced: baseline.introduced.map(({ points, ...finding }) => finding), note: baseline.note } : undefined,
            checkCoverage: scored.checkCoverage, fileIssueCounts: fileScores(scored.findings, collection.files).map(({ score, ...entry }) => entry),
            findings: allFindings.map((finding, index) => { const { points, ...entry } = finding; return { ...entry,
              voided: voided.has(findingVoidKey(finding, index)) || voidedFiles.has(finding.path), voidedByFile: voidedFiles.has(finding.path) }; }),
            skipped: collection.skipped,
            ai: { enabled: aiEnabled, rubricVersion: AI_RUBRIC_VERSION, basePoints: AI_BASE_POINTS,
              criteria: AI_CRITERIA, assessments: (ai?.assessments ?? []).map(({ basePoints, weight, points, ...item }) =>
                ({ ...item, voided: voided.has(assessmentVoidKey(item.path, item.criterion)) || voidedFiles.has(item.path),
                  voidedByFile: voidedFiles.has(item.path) })),
              reviewedFiles: ai?.reviewedFiles ?? 0, processedFiles: ai?.processedFiles ?? 0, totalFiles: ai?.totalFiles ?? collection.files.length,
              processedChars: ai?.processedChars ?? 0, totalChars: ai?.totalChars ?? 0,
              fileRequests: ai?.fileRequests ?? 0, reviewedProject: ai?.reviewedProject ?? false,
              projectRequests: ai?.projectRequests ?? 0, processedProjectRequests: ai?.processedProjectRequests ?? 0,
              errors: ai?.errors ?? [] } }, null, 2) + '\n';
          const activeFileScores = fileScores(scored.findings, collection.files);
          const activeFileCounts = new Map(activeFileScores.map(item => [item.path, item.findings]));
          const dashboard: DashboardResult = {
            id: ++reportId, scanId, label, scope, score: finalScore(scored.score), scoreDisplay: formattedFinalScore(scored.score), fileCount: collection.files.length,
            density: metrics.issueDensity.toFixed(1) + ' / 千行', voidedCount: voided.size + voidedFiles.size,
            baseline: baseline?.baselineAvailable ? `${baseline.changedPaths.length} 个变更文件，${baseline.introduced.length} 条新增本地问题` : baseline?.note,
            skipped: `不支持 ${collection.skipped.unsupported} / 超大 ${collection.skipped.large} / 二进制 ${collection.skipped.binary} / 读取失败 ${collection.skipped.unreadable}`,
            checks: scored.checkCoverage,
            ai: !aiEnabled ? '未配置 Key' : `AI 已响应 ${ai?.processedFiles ?? 0}/${collection.files.length} 个文件、${ai?.processedChars ?? 0}/${ai?.totalChars ?? 0} 字符；全部条目有效分级 ${ai?.reviewedFiles ?? 0} 个文件；项目请求 ${ai?.processedProjectRequests ?? 0}/${ai?.projectRequests ?? 0}，${ai?.errors.length ?? 0} 个失败项`,
            aiAssessments: (ai?.assessments ?? []).map(({ basePoints, weight, points, ...item }) => {
              const voidKey = assessmentVoidKey(item.path, item.criterion);
              return { ...item, voidKey, voided: voided.has(voidKey) || voidedFiles.has(item.path),
                voidable: voidModel.validKeys.has(voidKey) && !voidedFiles.has(item.path), fileVoided: voidedFiles.has(item.path) };
            }),
            categoryCounts: Object.fromEntries(Object.keys(scored.categoryScores).map(category =>
              [category, scored.findings.filter(finding => finding.category === category).length])) as Record<keyof typeof scored.categoryScores, number>,
            fileScores: activeFileScores.map(({ score, ...item }) => item),
            fileRows: fileScores(allFindings, collection.files).map(item => ({ path: item.path, totalFindings: item.findings,
              activeFindings: activeFileCounts.get(item.path) ?? 0,
              voided: voidedFiles.has(item.path), voidable: voidModel.validFilePaths.has(item.path) })),
            findings: dashboardFindings(allFindings, collection.files, voided, voidModel.validKeys, voidedFiles)
          };
          if (running) progress.report({ message: '评分完成', percentage: plan.complete() });
          sidebar.setResult(dashboard);
        };
        toggleCurrentVoid = key => {
          if (!voidModel.validKeys.has(key)) return;
          if (voidedFiles.has(pathByVoidKey.get(key) ?? '')) return;
          if (voided.has(key)) voided.delete(key);
          else voided.add(key);
          publish();
        };
        toggleCurrentFileVoid = filePath => {
          if (!voidModel.validFilePaths.has(filePath)) return;
          if (voidedFiles.has(filePath)) voidedFiles.delete(filePath);
          else voidedFiles.add(filePath);
          publish();
        };
        publish();
        output.appendLine(`${new Date().toISOString()} ${label}: ${formattedFinalScore(fullResult.score)} / 9，${collection.files.length} 个文件`);
      };
      await executeScan();
    } catch (error) {
      if (error instanceof vscode.CancellationError) sidebar.setBusy(false, '已取消评分');
      else {
        const message = error instanceof Error ? error.message : String(error);
        sidebar.setError(message);
        output.appendLine(`错误：${message}`);
      }
    } finally {
      try { await cleanup?.(); }
      finally { running = false; cancelCurrentScan = undefined; cancellation.dispose(); }
    }
  }

  async function importRepositoryConfig(): Promise<void> {
    const chosen = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      openLabel: '导入 Git 评分规则', title: '选择 .shitcode 或 .shitcode_ignore' });
    if (!chosen?.length) return;
    const name = path.basename(chosen[0].fsPath);
    if (name !== '.shitcode' && name !== '.shitcode_ignore') throw new Error('只能导入名为 .shitcode 或 .shitcode_ignore 的文件。');
    const bytes = await vscode.workspace.fs.readFile(chosen[0]);
    if (bytes.length > 1024 * 1024) throw new Error('评分规则文件不能超过 1 MiB。');
    const contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const draft = validateScanRuleDraft({ name, contents });
    repositoryConfig = scanConfigFromDraft(draft);
    sidebar.setImportedRepositoryRule(draft);
  }

  async function loadWorkspaceRule(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('请先打开一个工作区根目录。');
    for (const name of ['.shitcode', '.shitcode_ignore'] as const) {
      const uri = vscode.Uri.joinPath(root, name);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.length > 1024 * 1024) throw new Error(`${name} 不能超过 1 MiB。`);
        const draft = validateScanRuleDraft({ name, contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
        sidebar.setLoadedWorkspaceRule(draft);
        return;
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') continue;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
    }
    vscode.window.showInformationMessage('当前项目根目录没有 .shitcode 或 .shitcode_ignore。');
  }

  async function exportRule(value: unknown): Promise<void> {
    const draft = validateScanRuleDraft(value);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('请先打开一个工作区根目录，再导出评分规则。');
    const destination = vscode.Uri.joinPath(root, draft.name);
    let exists = false;
    try { await vscode.workspace.fs.stat(destination); exists = true; }
    catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound') &&
          (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (exists) {
      const choice = await vscode.window.showWarningMessage(`当前项目根目录已存在 ${draft.name}，覆盖它吗？`, { modal: true }, '覆盖');
      if (choice !== '覆盖') return;
    }
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(draft.contents));
    let priorityNote = '';
    if (draft.name === '.shitcode_ignore') {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.shitcode'));
        priorityNote = '当前根目录仍有 .shitcode，项目扫描会优先使用它。';
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound') &&
            (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    vscode.window.showInformationMessage(`${draft.name} 已导出到当前项目根目录。${priorityNote}`);
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
        case 'scanWorkspace': await run('workspace', { ruleSource: message.source, rule: message.rule }); break;
        case 'scanFiles': await run('files'); break;
        case 'scanRepository': await run('repository', { url: message.url, ruleSource: message.source, rule: message.rule }); break;
        case 'importRepositoryConfig': await importRepositoryConfig(); break;
        case 'clearRepositoryConfig': repositoryConfig = undefined; break;
        case 'loadWorkspaceRule': await loadWorkspaceRule(); break;
        case 'exportRule': await exportRule(message.rule); break;
        case 'setApiKey': await vscode.commands.executeCommand('shitCodeDetector.setApiKey'); break;
        case 'openSettings': await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:serendipitylin0731.shit-code-detector'); break;
        case 'openReport': await showReport(); break;
        case 'exportJson': await exportJson(); break;
        case 'toggleVoid': if (!running && typeof message.key === 'string') toggleCurrentVoid?.(message.key); break;
        case 'toggleFileVoid': if (!running && typeof message.path === 'string') toggleCurrentFileVoid?.(message.path); break;
        case 'cancelScan': if (running) { sidebar.setBusy(true, '正在取消评分…'); cancelCurrentScan?.(); } break;
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
    vscode.commands.registerCommand('shitCodeDetector.scanWorkspace', () => run('workspace')),
    vscode.commands.registerCommand('shitCodeDetector.scanFiles', () => run('files')),
    vscode.commands.registerCommand('shitCodeDetector.scanRepository', () => run('repository')),
    vscode.commands.registerCommand('shitCodeDetector.exportJson', () => exportJson()),
    vscode.commands.registerCommand('shitCodeDetector.setApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: '输入 AI API Key（留空并确认可删除已保存的 Key）', password: true, ignoreFocusOut: true });
      if (key === undefined) return;
      if (key.trim()) await context.secrets.store(secretKey, key.trim());
      else await context.secrets.delete(secretKey);
      sidebar.setApiKeyConfigured(Boolean(key.trim()));
      vscode.window.showInformationMessage(key.trim() ? 'AI API Key 已安全保存；下次评分将自动调用 AI。' : 'AI API Key 已删除；后续评分只运行本地规则。');
    })
  );
}

export function deactivate(): void { /* 无持久进程 */ }

function makeReport(label: string, scope: Scope, rawScore: number, categoryScores: Record<string, number>, findings: Finding[], files: CodeFile[], skipped: Record<string, number>, checkCoverage: string, aiEnabled: boolean, ai: AiResult | undefined, metrics: ReturnType<typeof summaryMetrics>, baseline?: GitBaseline, allFindings: Finding[] = findings, voided: ReadonlySet<string> = new Set(), voidedFiles: ReadonlySet<string> = new Set()): string {
  const clean = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', 'ˋ');
  const severity = (finding: Finding): string => finding.aiGrade ? ({ B: '轻微', C: '一般', D: '较重', E: '严重' } as const)[finding.aiGrade]
    : finding.points >= 6 ? '严重' : finding.points >= 4 ? '较重' : finding.points >= 2 ? '一般' : '轻微';
  const categoryCounts = Object.fromEntries(Object.keys(categoryScores).map(category =>
    [category, findings.filter(finding => finding.category === category).length]));
  const lines = [
    '# Shit Code Detector 评分报告', '',
    `- 对象：${clean(label)}`,
    `- 模式：${scope === 'workspace' ? '当前项目' : scope === 'files' ? '当前文件' : 'HTTPS Git 仓库'}`,
    `- 最终分：**${formattedFinalScore(rawScore)} / 9**（越高越 shit）`,
    `- 长度基准：${REFERENCE_CODE_LINES} 行有效代码；原始分统一乘以 ${REFERENCE_CODE_LINES} / max(有效行数, ${REFERENCE_CODE_LINES})`,
    `- 问题密度：${metrics.issueDensity.toFixed(1)} 条 / 千行有效代码（不足 ${REFERENCE_CODE_LINES} 行按 ${REFERENCE_CODE_LINES} 行计算）`,
    `- 已分析：${files.length} 个代码文件`,
    `- 手动 void：${voided.size} 个判断条目、${voidedFiles.size} 个文件（不计入当前分数）`,
    `- 跳过：不支持或生成文件 ${skipped.unsupported}，超大文件 ${skipped.large}，二进制 ${skipped.binary}，读取失败 ${skipped.unreadable}`,
    `- 静态解析：${checkCoverage}`,
    `- AI：${!aiEnabled ? '未配置 Key' : `已响应 ${ai?.processedFiles ?? 0}/${files.length} 个文件、${ai?.processedChars ?? 0}/${ai?.totalChars ?? 0} 字符；全部条目有效分级 ${ai?.reviewedFiles ?? 0} 个文件；项目代码请求 ${ai?.processedProjectRequests ?? 0}/${ai?.projectRequests ?? 0} 次，项目全部条目${ai?.reviewedProject ? '完成分级' : '未完成分级'}`}`,
    `- AI 未完成条目：${metrics.uncertainAssessments}`, '', '## 语言覆盖', '',
    '| 语言 | 文件数 | 分析能力 | 语法失败文件数 |', '| --- | ---: | --- | ---: |',
    ...metrics.languageCoverage.map(item => `| ${item.language} | ${item.files} | ${item.parser} | ${item.parseFailures} |`),
    '', '## Git 增量', '',
    baseline?.baselineAvailable ? `相对 HEAD，${baseline.changedPaths.length} 个变更文件中发现 ${baseline.introduced.length} 条新增本地规则问题。` : baseline?.note ?? '此模式不提供 Git 基线。',
    ...(baseline?.introduced.length ? ['', '| 严重程度 | 位置 | 说明 |', '| --- | --- | --- |',
      ...baseline.introduced.map(item => `| ${severity(item)} | ${clean(item.path)}${item.line ? `:${item.line}` : ''} | ${clean(item.message)} |`)] : []),
    '', '## 分类问题数', '',
    '| 架构 | 复杂度 | 重复 | 风格 | 命名 | 可读性 | 一致性 |', '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${categoryCounts.architecture} | ${categoryCounts.complexity} | ${categoryCounts.duplication} | ${categoryCounts.style} | ${categoryCounts.naming} | ${categoryCounts.readability} | ${categoryCounts.consistency} |`,
    '', '## AI 分项评分', '',
    `评分表版本：${AI_RUBRIC_VERSION}。等级基础分：${Object.entries(AI_BASE_POINTS).map(([grade, points]) => `${grade}=${points}`).join('、')}；内部按基础分 × 固定权重累计。`, '',
    '| 条目 | 范围 | 类别 | 权重 |', '| --- | --- | --- | ---: |',
    ...AI_CRITERIA.map(item => `| ${clean(item.title)} | ${item.scope === 'file' ? '文件' : '项目'} | ${item.category} | ${item.weight} |`),
    '',
    ...(ai?.assessments.length ? [
      '| 对象 | 条目 | 等级 | 严重程度 | 状态 | 证据 |', '| --- | --- | --- | --- | --- | --- |',
      ...[...ai.assessments].sort((a, b) => Number(voidedFiles.has(a.path) || voided.has(assessmentVoidKey(a.path, a.criterion))) - Number(voidedFiles.has(b.path) || voided.has(assessmentVoidKey(b.path, b.criterion))))
        .map(item => `| ${clean(item.path)} | ${clean(item.title)} | ${item.grade}${item.adjustedFrom ? `（原建议 ${item.adjustedFrom}，校验后）` : ''} | ${{ A: '无问题', B: '轻微', C: '一般', D: '较重', E: '严重', 'N/A': '不适用', U: '未完成' }[item.grade]} | ${voidedFiles.has(item.path) ? '文件已 void' : voided.has(assessmentVoidKey(item.path, item.criterion)) ? '已 void' : '生效'} | ${clean(item.reason)} |`),
      ''
    ] : ['没有已完成的 AI 分项评分。', '']),
    '## 文件分数', '',
    '文件问题数只包含定位到该文件的问题；项目级问题单独计入总分。整文件 void 保留扫描时的长度基准，项目级判断仍需单独 void。', '',
    '| 文件 | 生效问题数 | 状态 |', '| --- | ---: | --- |',
    ...fileScores(findings, files).sort((a, b) => Number(voidedFiles.has(a.path)) - Number(voidedFiles.has(b.path)))
      .map(item => `| ${clean(item.path)} | ${item.findings} | ${voidedFiles.has(item.path) ? '文件已 void' : '生效'} |`),
    '', '## 具体问题', ''
  ];
  if (!allFindings.length) lines.push('没有发现符合当前规则的问题。');
  else {
    lines.push('| 严重程度 | 类别 | 状态 | 证据类型 | 置信度 | 位置 | 说明 |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const { finding, index } of allFindings.map((finding, index) => ({ finding, index }))
      .sort((a, b) => Number(voidedFiles.has(a.finding.path) || voided.has(findingVoidKey(a.finding, a.index))) - Number(voidedFiles.has(b.finding.path) || voided.has(findingVoidKey(b.finding, b.index))) ||
        b.finding.points - a.finding.points || a.finding.path.localeCompare(b.finding.path))) {
      const file = files.find(item => item.path === finding.path);
      const location = `${finding.path}${finding.line ? `:${finding.line}` : ''}`;
      const linked = file?.uri ? `[${clean(location)}](${file.uri}${finding.line ? `#L${finding.line}` : ''})` : clean(location);
      lines.push(`| ${severity(finding)} | ${finding.category} | ${voidedFiles.has(finding.path) ? '文件已 void' : voided.has(findingVoidKey(finding, index)) ? '已 void' : '生效'} | ${finding.evidenceType === 'ai-inference' ? 'AI 推断' : '静态确认'} | ${finding.confidence ?? '中'} | ${linked} | ${clean(finding.message)} |`);
    }
  }
  if (ai?.errors.length) lines.push('', '## AI 未完成项', '', ...ai.errors.map(error => `- ${clean(error)}`));
  lines.push('', '## 评分说明', '', `内部累计值 x：本地与 AI 先统一乘 ${REFERENCE_CODE_LINES} / max(有效代码行数, ${REFERENCE_CODE_LINES})；本地类别再应用各自上限与系数，AI 条目按基础分 × 固定权重计入。手动 void 的本地问题按原类别贡献比例扣除；void 的 AI 条目与整文件贡献不计分，恢复后按原有逐条 void 状态重新计算。最终分按 SCORING.md 中的五段函数转换，断点为 0.1、45、150、250。A 不计分；U 表示未审查完成，N/A 表示不适用。代码风格评分不判断运行结果。详见 SCORING.md 与 AI_RUBRIC.md。`, '');
  return lines.join('\n');
}
