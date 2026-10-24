import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ignoredDirectories, isEligible } from './fileFilter';

export async function listCodePaths(root: string, checkCancelled?: () => void): Promise<string[]> {
  const entries: string[] = [];
  async function visit(directory: string): Promise<void> {
    checkCancelled?.();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (item.isDirectory()) {
        if (!ignoredDirectories.has(item.name)) await visit(absolute);
      } else if (item.isFile() && isEligible(relative)) {
        entries.push(relative);
      }
    }
  }
  await visit(root);
  return entries;
}
