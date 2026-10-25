import { Analysis, Category, Finding, lengthFactor, LOCAL_CATEGORY_POLICY } from './analysis';

export function assessmentVoidKey(path: string, criterion: string): string {
  return JSON.stringify(['ai', path, criterion]);
}

export function findingVoidKey(finding: Finding, index: number): string {
  return finding.source === 'ai' && finding.rule.startsWith('ai-')
    ? assessmentVoidKey(finding.path, finding.rule.slice(3))
    : JSON.stringify(['local', index]);
}

export interface VoidScoreModel {
  validKeys: Set<string>;
  validFilePaths: Set<string>;
  apply(voided: ReadonlySet<string>, voidedFiles?: ReadonlySet<string>): Analysis;
}

/** Allocate capped local-category contributions once so voiding any positive item reduces the score. */
export function buildVoidScoreModel(base: Analysis): VoidScoreModel {
  const localTotals = new Map<Category, number>();
  for (const finding of base.findings) if (finding.source === 'rules') {
    localTotals.set(finding.category, (localTotals.get(finding.category) ?? 0) + finding.points);
  }
  const scale = lengthFactor(base.files);
  const keys = base.findings.map(findingVoidKey);
  const contributions = base.findings.map(finding => {
    if (finding.source === 'ai') return finding.points * scale;
    const total = localTotals.get(finding.category) ?? 0;
    if (!total) return 0;
    const policy = LOCAL_CATEGORY_POLICY[finding.category];
    return finding.points / total * Math.min(total * scale, policy.cap) * policy.multiplier;
  });
  const validKeys = new Set(keys.filter((_, index) => contributions[index] > 0));
  const validFilePaths = new Set(base.findings.filter((finding, index) => contributions[index] > 0 && finding.path !== '<project>')
    .map(finding => finding.path));
  return {
    validKeys,
    validFilePaths,
    apply(voided, voidedFiles = new Set()): Analysis {
      if (!voided.size && !voidedFiles.size) return base;
      const categoryScores = Object.fromEntries(Object.keys(base.categoryScores).map(category => [category, 0])) as Record<Category, number>;
      const findings: Finding[] = [];
      for (let index = 0; index < base.findings.length; index++) {
        if (voided.has(keys[index]) || voidedFiles.has(base.findings[index].path)) continue;
        const finding = base.findings[index];
        findings.push(finding);
        categoryScores[finding.category] += contributions[index];
      }
      const score = Object.values(categoryScores).reduce((sum, points) => sum + points, 0);
      return { files: base.files, findings, score, categoryScores, checkCoverage: base.checkCoverage, parseFailurePaths: base.parseFailurePaths };
    }
  };
}
