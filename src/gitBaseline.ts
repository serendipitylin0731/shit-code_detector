import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Analysis, Finding } from './analysis';
import { analyzeInWorker } from './analyzeAsync';

const execute = promisify(execFile);
export interface GitBaseline {
  changedPaths: string[];
  introduced: Finding[];
  baselineAvailable: boolean;
  note?: string;
}

/** Compare only the changed files against HEAD using the same local rules. */
export async function compareGitBaseline(root: string, current: Analysis): Promise<GitBaseline> {
  try {
    const [tracked, untracked] = await Promise.all([
      git(root, ['diff', '--name-only', '-z', 'HEAD', '--']),
      git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    ]);
    const names = new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean));
    const files = current.files.filter(file => names.has(file.path));
    if (files.length > 100) return { changedPaths: files.map(file => file.path), introduced: [], baselineAvailable: false, note: '变更文件超过 100 个，已跳过基线比较。' };
    if (!files.length) return { changedPaths: [], introduced: [], baselineAvailable: true };
    const originals = await Promise.all(files.map(async file => {
      try { return { ...file, content: await git(root, ['show', `HEAD:${file.path}`], 2_000_000) }; }
      catch { return undefined; }
    }));
    const baseline = await analyzeInWorker(originals.filter((file): file is NonNullable<typeof file> => Boolean(file)), false);
    const remaining = new Map<string, number>();
    for (const finding of baseline.findings) {
      const key = fingerprint(finding);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const introduced: Finding[] = [];
    for (const finding of current.findings.filter(item => item.source === 'rules' && names.has(item.path))) {
      const key = fingerprint(finding);
      const count = remaining.get(key) ?? 0;
      if (count) remaining.set(key, count - 1);
      else introduced.push(finding);
    }
    return { changedPaths: files.map(file => file.path), introduced, baselineAvailable: true };
  } catch {
    return { changedPaths: [], introduced: [], baselineAvailable: false, note: 'Git 基线不可用；增量分析未运行。' };
  }
}

function fingerprint(finding: Finding): string { return `${finding.path}\0${finding.rule}\0${finding.message.replace(/\d+/g, '#')}`; }
async function git(root: string, args: string[], maxBuffer = 4_000_000): Promise<string> {
  const { stdout } = await execute('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return stdout;
}
