import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { CodeFile, languageOf } from './analysis';
import { isEligible, isSensitiveConfig } from './fileFilter';
import { GitIgnoreMatcher } from './gitIgnore';
import { listCodePaths } from './fileWalk';

export interface Collection {
  files: CodeFile[];
  skipped: { unsupported: number; large: number; binary: number; unreadable: number };
}

export async function collectUris(entries: { uri: vscode.Uri; path: string }[], maxFileBytes: number, token?: vscode.CancellationToken, explicitSelection = false): Promise<Collection> {
  const collection: Collection = { files: [], skipped: { unsupported: 0, large: 0, binary: 0, unreadable: 0 } };
  for (const entry of entries) {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    if (isSensitiveConfig(entry.path) || !(explicitSelection ? Boolean(languageOf(entry.path)) : isEligible(entry.path))) { collection.skipped.unsupported++; continue; }
    try {
      const stat = await vscode.workspace.fs.stat(entry.uri);
      if (stat.size > maxFileBytes) { collection.skipped.large++; continue; }
      const bytes = await vscode.workspace.fs.readFile(entry.uri);
      if (bytes.length > maxFileBytes) { collection.skipped.large++; continue; }
      if (bytes.includes(0)) { collection.skipped.binary++; continue; }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      collection.files.push({ path: entry.path.replaceAll('\\', '/'), language: languageOf(entry.path)!, content, uri: entry.uri.toString() });
    } catch {
      collection.skipped.unreadable++;
    }
  }
  return collection;
}

export async function workspaceEntries(token?: vscode.CancellationToken, selectedFolder?: vscode.WorkspaceFolder): Promise<{ uri: vscode.Uri; path: string }[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('请先打开一个工作区。');
  const include = selectedFolder ? new vscode.RelativePattern(selectedFolder, '**/*') : '**/*';
  const uris = await vscode.workspace.findFiles(include, '**/{.git,.hg,.svn,node_modules,vendor,dist,build,out,target,.next,.nuxt,.venv,venv,__pycache__,.idea,.vscode,coverage,.terraform,Pods,bin,obj,artifacts}/**', undefined, token);
  const matchers = new Map<string, GitIgnoreMatcher>();
  const entries: { uri: vscode.Uri; path: string }[] = [];
  for (const uri of uris) {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    const folder = vscode.workspace.getWorkspaceFolder(uri)!;
    let matcher = matchers.get(folder.uri.toString());
    if (!matcher) {
      matcher = workspaceMatcher(folder.uri);
      matchers.set(folder.uri.toString(), matcher);
    }
    const relative = path.posix.relative(folder.uri.path, uri.path);
    if (await matcher.isIgnored(relative)) continue;
    const prefix = folders.length > 1 && !selectedFolder ? `${folder.name}/` : '';
    entries.push({ uri, path: prefix + relative });
  }
  return entries;
}

export async function excludeIgnoredSelections(entries: { uri: vscode.Uri; path: string }[]): Promise<{ uri: vscode.Uri; path: string }[]> {
  const matchers = new Map<string, GitIgnoreMatcher>();
  const result: { uri: vscode.Uri; path: string }[] = [];
  for (const entry of entries) {
    const folder = vscode.workspace.getWorkspaceFolder(entry.uri);
    const root = folder?.uri ?? (entry.uri.scheme === 'file' ? vscode.Uri.file(await findLocalIgnoreRoot(entry.uri.fsPath)) : undefined);
    if (!root) { result.push(entry); continue; }
    const key = root.toString();
    let matcher = matchers.get(key);
    if (!matcher) { matcher = workspaceMatcher(root); matchers.set(key, matcher); }
    const relative = path.posix.relative(root.path, entry.uri.path);
    if (!await matcher.isIgnored(relative)) result.push(entry);
  }
  return result;
}

export async function directoryEntries(root: string, token?: vscode.CancellationToken): Promise<{ uri: vscode.Uri; path: string }[]> {
  const relatives = await listCodePaths(root, () => { if (token?.isCancellationRequested) throw new vscode.CancellationError(); });
  return relatives.map(relative => ({ uri: vscode.Uri.file(path.join(root, relative)), path: relative }));
}

function workspaceMatcher(root: vscode.Uri): GitIgnoreMatcher {
  return new GitIgnoreMatcher(async directory => {
    const uri = vscode.Uri.joinPath(root, ...(directory ? directory.split('/') : []), '.gitignore');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri)); }
    catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  });
}

async function findLocalIgnoreRoot(filePath: string): Promise<string> {
  let directory = path.dirname(filePath);
  let topmostIgnore: string | undefined;
  for (;;) {
    try { await stat(path.join(directory, '.git')); return directory; } catch { /* 继续查找 */ }
    try { await stat(path.join(directory, '.gitignore')); topmostIgnore = directory; } catch { /* 继续查找 */ }
    const parent = path.dirname(directory);
    if (parent === directory) return topmostIgnore ?? path.dirname(filePath);
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
