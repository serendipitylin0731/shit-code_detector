import type ignore from 'ignore';

const createIgnore = require('../vendor/ignore') as typeof ignore;
type Rules = ignore.Ignore;

export type ScanConfigMode = 'include' | 'exclude' | 'all';
export type ScanRuleName = '.shitcode' | '.shitcode_ignore';
export interface ScanRuleDraft { name: ScanRuleName; contents: string }

export function validateScanRuleDraft(value: unknown): ScanRuleDraft {
  if (!value || typeof value !== 'object') throw new Error('请先填写评分规则。');
  const draft = value as Partial<ScanRuleDraft>;
  if (draft.name !== '.shitcode' && draft.name !== '.shitcode_ignore') throw new Error('评分规则类型必须是 .shitcode 或 .shitcode_ignore。');
  if (typeof draft.contents !== 'string' || Buffer.byteLength(draft.contents, 'utf8') > 1024 * 1024) {
    throw new Error('评分规则必须是文本，且不能超过 1 MiB。');
  }
  return { name: draft.name, contents: draft.contents };
}

export function scanConfigFromDraft(value: unknown): ScanConfig {
  const draft = validateScanRuleDraft(value);
  return draft.name === '.shitcode' ? selectScanConfig(draft.contents) : selectScanConfig(undefined, draft.contents);
}

/** Root-level selection files use the same pattern and negation syntax as .gitignore. */
export class ScanConfig {
  private readonly rules?: Rules;
  private readonly includePatterns: string[];

  constructor(readonly mode: ScanConfigMode, contents?: string) {
    const source = (contents ?? '').replace(/^\uFEFF/, '');
    this.includePatterns = mode === 'include' ? source.split(/\r?\n/) : [];
    if (mode !== 'all') this.rules = createIgnore().add(source);
  }

  /** Conservative pruning for literal root prefixes; wildcard or basename rules keep traversal open. */
  mayContain(relativeDirectory: string): boolean {
    if (this.mode !== 'include') return true;
    const directory = relativeDirectory.replaceAll('\\', '/').replace(/\/$/, '').split('/');
    for (const raw of this.includePatterns) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      if (line.startsWith('\\')) return true;
      const anchored = line.startsWith('/');
      const parts = line.replace(/^\//, '').replace(/\/$/, '').split('/');
      if (parts.length < 2 && !anchored) return true;
      const fixed: string[] = [];
      for (const part of parts) {
        if (!part || /[*?\[\]\\]/.test(part)) break;
        fixed.push(part);
      }
      if (!fixed.length) return true;
      if (directory.slice(0, Math.min(directory.length, fixed.length)).every((part, index) => part.toLowerCase() === fixed[index].toLowerCase())) return true;
    }
    return false;
  }

  allows(relativePath: string): boolean {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return false;
    if (this.mode === 'all') return true;
    const matched = this.rules!.ignores(normalized);
    return this.mode === 'include' ? matched : !matched;
  }

  get fileName(): '.shitcode' | '.shitcode_ignore' | undefined {
    return this.mode === 'include' ? '.shitcode' : this.mode === 'exclude' ? '.shitcode_ignore' : undefined;
  }
}

/** The allow-list always wins when both files exist, even when it is empty. */
export function selectScanConfig(includeContents?: string, excludeContents?: string): ScanConfig {
  if (includeContents !== undefined) return new ScanConfig('include', includeContents);
  if (excludeContents !== undefined) return new ScanConfig('exclude', excludeContents);
  return new ScanConfig('all');
}

export async function loadScanConfig(readRootFile: (name: '.shitcode' | '.shitcode_ignore') => Promise<string | undefined>): Promise<ScanConfig> {
  const include = await readRootFile('.shitcode');
  if (include !== undefined) return selectScanConfig(include);
  return selectScanConfig(undefined, await readRootFile('.shitcode_ignore'));
}
