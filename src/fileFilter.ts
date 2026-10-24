import { languageOf } from './analysis';

export const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'coverage',
  '.terraform', 'Pods', 'bin', 'obj', 'artifacts'
]);

const ignoredFiles = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|manifest\.toml)$|\.min\.(?:js|css)$|\.generated\.[^.]+$|\.g\.(?:cs|dart)$|\.pb\.(?:go|js|ts|py)$/i;

export function isSensitiveConfig(filePath: string): boolean {
  return /(?:^|[\\/])ai\.local(?:\.example)?\.json$/i.test(filePath);
}

export function isEligible(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return Boolean(languageOf(normalized)) && !isSensitiveConfig(normalized) &&
    !normalized.split('/').some(part => ignoredDirectories.has(part)) &&
    !/(?:^|\/)(?:test|tests)\/fixtures\//i.test(normalized) && !ignoredFiles.test(normalized);
}
