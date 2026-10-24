import path from 'node:path';
import type { Analysis, CodeFile } from './analysis';

/** Deterministic mixed sampling keeps low-style-risk core files in the review set. */
export function selectAiFiles(analysis: Analysis, limit: number, changedPaths: readonly string[] = []): CodeFile[] {
  if (limit <= 0) return [];
  const byPath = new Map(analysis.files.map(file => [file.path, file]));
  const points = new Map<string, number>();
  const imports = new Map<string, number>();
  for (const finding of analysis.findings) {
    if (finding.category !== 'style' && finding.category !== 'consistency') points.set(finding.path, (points.get(finding.path) ?? 0) + finding.points);
  }
  const stemIndex = new Map<string, CodeFile[]>();
  for (const file of analysis.files) {
    const stem = path.posix.basename(file.path).replace(/\.[^.]+$/, '');
    if (stem.length >= 3) stemIndex.set(stem, [...(stemIndex.get(stem) ?? []), file]);
  }
  for (const file of analysis.files) {
    for (const line of file.content.split(/\r?\n/)) {
      if (!/^\s*(?:from |import |(?:const|let|var) .*require\s*\(|#include |use |using )/.test(line)) continue;
      for (const stem of line.match(/[A-Za-z_][\w-]{2,}/g) ?? []) {
        for (const candidate of stemIndex.get(stem) ?? []) {
          if (candidate !== file) imports.set(candidate.path, (imports.get(candidate.path) ?? 0) + 1);
        }
      }
    }
  }
  const selected: CodeFile[] = [];
  const add = (file?: CodeFile): void => { if (file && !selected.includes(file) && selected.length < limit) selected.push(file); };
  const quota = (fraction: number): number => Math.max(1, Math.floor(limit * fraction));
  const take = (files: CodeFile[], count: number): void => { for (const file of files.slice(0, count)) add(file); };
  take(changedPaths.map(name => byPath.get(name)).filter((file): file is CodeFile => Boolean(file)), quota(.25));
  take([...analysis.files].sort((a, b) => (points.get(b.path) ?? 0) - (points.get(a.path) ?? 0) || a.path.localeCompare(b.path)), quota(.25));
  take([...analysis.files].sort((a, b) => (imports.get(b.path) ?? 0) - (imports.get(a.path) ?? 0) || a.path.localeCompare(b.path)), quota(.20));
  take(analysis.files.filter(file => /(?:^|\/)(?:main|index|app|server|cli|config|settings|routes?)\.[^.\/]+$/i.test(file.path)).sort((a, b) => a.path.localeCompare(b.path)), quota(.15));
  // Path hash gives a stable, reproducible stratified remainder across languages.
  const groups = new Map<string, CodeFile[]>();
  for (const file of analysis.files) groups.set(file.language, [...(groups.get(file.language) ?? []), file]);
  for (const group of groups.values()) group.sort((a, b) => hash(a.path) - hash(b.path));
  while (selected.length < Math.min(limit, analysis.files.length)) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) { if (!selected.includes(next)) add(next); added = true; }
    }
    if (!added) break;
  }
  return selected;
}

function hash(value: string): number { let n = 2166136261; for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; }
