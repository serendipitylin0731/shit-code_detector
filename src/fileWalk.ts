import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ignoredDirectories, isEligible } from './fileFilter';
import { ScanConfig } from './scanConfig';

export async function listCodePaths(root: string, checkCancelled?: () => void, config?: ScanConfig,
  onDiscovered?: (count: number) => void): Promise<string[]> {
  const entries: string[] = [];
  const configured = config && config.mode !== 'all';
  async function visit(directory: string): Promise<void> {
    checkCancelled?.();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (item.isDirectory()) {
        if (['.git', '.hg', '.svn'].includes(item.name) || (!configured && ignoredDirectories.has(item.name)) ||
            (config?.mode === 'include' && !config.mayContain(relative)) ||
            (config?.mode === 'exclude' && !config.allows(`${relative}/`))) continue;
        await visit(absolute);
      } else if (item.isFile() && (!configured ? isEligible(relative) : config.allows(relative))) {
        entries.push(relative);
        onDiscovered?.(entries.length);
      }
    }
  }
  await visit(root);
  return entries;
}
