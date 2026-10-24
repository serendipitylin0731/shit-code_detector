import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { CodeFile, languageOf } from './analysis';

const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'coverage',
  '.terraform', 'Pods', 'bin', 'obj'
]);
const ignoredFiles = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|manifest\.toml)$|\.min\.(?:js|css)$|\.generated\.[^.]+$|\.g\.(?:cs|dart)$|\.pb\.(?:go|js|ts|py)$/i;

export interface Collection {
  files: CodeFile[];
  skipped: { unsupported: number; large: number; binary: number; unreadable: number };
}

export function isEligible(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return Boolean(languageOf(normalized)) && !normalized.split('/').some(part => ignoredDirectories.has(part)) && !ignoredFiles.test(normalized);
}

export async function collectUris(entries: { uri: vscode.Uri; path: string }[], maxFileBytes: number, token?: vscode.CancellationToken, explicitSelection = false): Promise<Collection> {
  const collection: Collection = { files: [], skipped: { unsupported: 0, large: 0, binary: 0, unreadable: 0 } };
  for (const entry of entries) {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    if (!(explicitSelection ? Boolean(languageOf(entry.path)) : isEligible(entry.path))) { collection.skipped.unsupported++; continue; }
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

export async function workspaceEntries(token?: vscode.CancellationToken): Promise<{ uri: vscode.Uri; path: string }[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('请先打开一个工作区。');
  const uris = await vscode.workspace.findFiles('**/*', '**/{.git,.hg,.svn,node_modules,vendor,dist,build,out,target,.next,.nuxt,.venv,venv,__pycache__,.idea,.vscode,coverage,.terraform,Pods,bin,obj}/**', undefined, token);
  return uris.map(uri => {
    const folder = vscode.workspace.getWorkspaceFolder(uri)!;
    const prefix = folders.length > 1 ? `${folder.name}/` : '';
    return { uri, path: prefix + path.posix.relative(folder.uri.path, uri.path) };
  });
}

export async function directoryEntries(root: string, token?: vscode.CancellationToken): Promise<{ uri: vscode.Uri; path: string }[]> {
  const entries: { uri: vscode.Uri; path: string }[] = [];
  async function visit(directory: string): Promise<void> {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (!ignoredDirectories.has(item.name)) await visit(path.join(directory, item.name));
      } else if (item.isFile()) {
        const absolute = path.join(directory, item.name);
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (isEligible(relative)) entries.push({ uri: vscode.Uri.file(absolute), path: relative });
      }
    }
  }
  await visit(root);
  return entries;
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
