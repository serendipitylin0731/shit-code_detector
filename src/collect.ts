import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { CodeFile, languageOf } from './analysis';
import { ignoredDirectories, isEligible, isSensitiveConfig } from './fileFilter';
import { listCodePaths } from './fileWalk';
import { loadScanConfig, ScanConfig } from './scanConfig';

export interface ScanEntry { uri: vscode.Uri; path: string; configured?: boolean }

export interface Collection {
  files: CodeFile[];
  skipped: { unsupported: number; large: number; binary: number; unreadable: number };
}

export async function collectUris(entries: ScanEntry[], maxFileBytes: number, token?: vscode.CancellationToken, explicitSelection = false,
  onProgress?: (completed: number, total: number) => void): Promise<Collection> {
  const collection: Collection = { files: [], skipped: { unsupported: 0, large: 0, binary: 0, unreadable: 0 } };
  for (const [index, entry] of entries.entries()) {
    if (index > 0 && index % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    if (isSensitiveConfig(entry.path) || !((explicitSelection || entry.configured) ? Boolean(languageOf(entry.path)) : isEligible(entry.path))) {
      collection.skipped.unsupported++; onProgress?.(index + 1, entries.length); continue;
    }
    try {
      const stat = await vscode.workspace.fs.stat(entry.uri);
      if (maxFileBytes > 0 && stat.size > maxFileBytes) { collection.skipped.large++; continue; }
      const bytes = await vscode.workspace.fs.readFile(entry.uri);
      if (maxFileBytes > 0 && bytes.length > maxFileBytes) { collection.skipped.large++; continue; }
      if (bytes.includes(0)) { collection.skipped.binary++; continue; }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      collection.files.push({ path: entry.path.replaceAll('\\', '/'), language: languageOf(entry.path)!, content, uri: entry.uri.toString() });
    } catch {
      collection.skipped.unreadable++;
    } finally {
      onProgress?.(index + 1, entries.length);
    }
  }
  return collection;
}

export async function workspaceEntries(token?: vscode.CancellationToken, selectedFolder?: vscode.WorkspaceFolder,
  onDiscovered?: (count: number) => void, configOverride?: ScanConfig): Promise<ScanEntry[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('请先打开一个工作区。');
  const entries: ScanEntry[] = [];
  const multiRoot = folders.length > 1 && !selectedFolder;
  let visited = 0;
  for (const folder of selectedFolder ? [selectedFolder] : folders) {
    const config = configOverride ?? await readRootScanConfig(folder.uri);
    const configured = config.mode !== 'all';
    async function visit(directory: vscode.Uri, relativeDirectory: string): Promise<void> {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
        if (++visited % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        if (token?.isCancellationRequested) throw new vscode.CancellationError();
        if (type & vscode.FileType.SymbolicLink) continue;
        const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
        const uri = vscode.Uri.joinPath(directory, name);
        if (type & vscode.FileType.Directory) {
          if (['.git', '.hg', '.svn'].includes(name) || (!configured && ignoredDirectories.has(name)) ||
              (config.mode === 'include' && !config.mayContain(relative)) ||
              (config.mode === 'exclude' && !config.allows(`${relative}/`))) continue;
          await visit(uri, relative);
        } else if (type & vscode.FileType.File) {
          if (!config.allows(relative)) continue;
          const prefix = multiRoot ? `${folder.name}/` : '';
          entries.push({ uri, path: prefix + relative, configured });
          onDiscovered?.(entries.length);
        }
      }
    }
    await visit(folder.uri, '');
  }
  return entries;
}

export async function applyScanConfigToSelections(entries: ScanEntry[]): Promise<ScanEntry[]> {
  const configs = new Map<string, ScanConfig>();
  const result: ScanEntry[] = [];
  for (const entry of entries) {
    const folder = vscode.workspace.getWorkspaceFolder(entry.uri);
    const root = folder?.uri ?? (entry.uri.scheme === 'file' ? vscode.Uri.file(await findLocalScanRoot(entry.uri.fsPath)) : undefined);
    if (!root) { result.push(entry); continue; }
    const key = root.toString();
    let config = configs.get(key);
    if (!config) { config = await readRootScanConfig(root); configs.set(key, config); }
    const relative = path.posix.relative(root.path, entry.uri.path);
    if (config.allows(relative)) result.push({ ...entry, configured: config.mode !== 'all' });
  }
  return result;
}

/** Score the visible editor snapshot, including unsaved changes. */
export async function collectActiveDocument(document: vscode.TextDocument, maxFileBytes: number): Promise<Collection> {
  if (document.isUntitled) throw new Error('请先保存当前文件，再进行单文件评分。');
  const entry: ScanEntry = { uri: document.uri, path: path.basename(document.uri.path) };
  const selected = await applyScanConfigToSelections([entry]);
  if (!selected.length) throw new Error('当前文件未被所属项目的 .shitcode 选中，或已被 .shitcode_ignore 排除。');
  const skipped = { unsupported: 0, large: 0, binary: 0, unreadable: 0 };
  if (isSensitiveConfig(entry.path) || !languageOf(entry.path)) { skipped.unsupported++; return { files: [], skipped }; }
  const content = document.getText();
  if (maxFileBytes > 0 && Buffer.byteLength(content, 'utf8') > maxFileBytes) { skipped.large++; return { files: [], skipped }; }
  if (content.includes('\0')) { skipped.binary++; return { files: [], skipped }; }
  return { files: [{ path: entry.path, language: languageOf(entry.path)!, content, uri: document.uri.toString() }], skipped };
}

export async function directoryEntries(root: string, token?: vscode.CancellationToken, config?: ScanConfig,
  onDiscovered?: (count: number) => void): Promise<ScanEntry[]> {
  const relatives = await listCodePaths(root, () => { if (token?.isCancellationRequested) throw new vscode.CancellationError(); }, config, onDiscovered);
  return relatives.map(relative => ({ uri: vscode.Uri.file(path.join(root, relative)), path: relative, configured: config?.mode !== undefined && config.mode !== 'all' }));
}

export async function readRootScanConfig(root: vscode.Uri): Promise<ScanConfig> {
  let current: '.shitcode' | '.shitcode_ignore' = '.shitcode';
  try {
    return await loadScanConfig(async name => {
      current = name;
      const uri = vscode.Uri.joinPath(root, name);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri)); }
      catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    });
  } catch (error) {
    throw new Error(`根目录 ${current} 读取或解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function findLocalScanRoot(filePath: string): Promise<string> {
  let directory = path.dirname(filePath);
  let topmostConfig: string | undefined;
  for (;;) {
    try { await stat(path.join(directory, '.git')); return directory; } catch { /* 继续查找 */ }
    for (const name of ['.shitcode', '.shitcode_ignore']) {
      try { await stat(path.join(directory, name)); topmostConfig = directory; } catch { /* 继续查找 */ }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return topmostConfig ?? path.dirname(filePath);
    directory = parent;
  }
}

export function validateRepositoryUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入有效的 HTTPS Git 仓库地址。'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.port) {
    throw new Error('只接受不含账号、密码、端口、查询参数的 HTTPS 仓库地址。');
  }
  return url.toString();
}

export async function cloneRepository(url: string, token?: vscode.CancellationToken): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shit-code-detector-'));
  try {
    await runGit(['-c', 'core.hooksPath=/dev/null', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false', 'clone', '--depth', '1', '--single-branch', '--no-recurse-submodules', url, directory], token);
    return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function runGit(args: string[], token?: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } });
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), 120_000);
    const subscription = token?.onCancellationRequested(() => child.kill());
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
    child.on('error', error => { clearTimeout(timeout); subscription?.dispose(); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      subscription?.dispose();
      if (token?.isCancellationRequested) reject(new vscode.CancellationError());
      else if (code === 0) resolve();
      else reject(new Error(`Git 克隆失败：${stderr.trim() || `退出码 ${code}`}`));
    });
  });
}
