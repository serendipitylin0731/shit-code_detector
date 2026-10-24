import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ignoredDirectories, isEligible } from './fileFilter';
import { GitIgnoreMatcher } from './gitIgnore';

export async function listCodePaths(root: string, checkCancelled?: () => void): Promise<string[]> {
  const entries: string[] = [];
  const matcher = new GitIgnoreMatcher(async directory => {
    try { return await readFile(path.join(root, directory, '.gitignore'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  });
  async function visit(directory: string): Promise<void> {
    checkCancelled?.();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (item.isDirectory()) {
        if (!ignoredDirectories.has(item.name) && !await matcher.isIgnored(relative, true)) await visit(absolute);
      } else if (item.isFile() && isEligible(relative) && !await matcher.isIgnored(relative)) {
        entries.push(relative);
      }
    }
  }
  await visit(root);
  return entries;
}
