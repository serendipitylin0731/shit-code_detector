import { Analysis, Category, Finding, LOCAL_CATEGORY_POLICY } from './analysis';

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
  apply(voided: ReadonlySet<string>): Analysis;
}

/** Allocate capped local-category contributions once so voiding any positive item reduces the score. */
export function buildVoidScoreModel(base: Analysis): VoidScoreModel {
  const localTotals = new Map<Category, number>();
  for (const finding of base.findings) if (finding.source === 'rules') {
    localTotals.set(finding.category, (localTotals.get(finding.category) ?? 0) + finding.points);
  }
  const effectiveLines = base.files.reduce((sum, file) => sum + file.content.split(/\r?\n/)
    .filter(line => line.trim() && !/^\s*(?:#|\/\/|\*|<!--)/.test(line)).length, 0);
  const heuristicScale = Math.min(1, Math.sqrt(1000 / Math.max(effectiveLines, 1)));
  const keys = base.findings.map(findingVoidKey);
  const contributions = base.findings.map(finding => {
    if (finding.source === 'ai') return finding.points;
    const total = localTotals.get(finding.category) ?? 0;
    if (!total) return 0;
    const policy = LOCAL_CATEGORY_POLICY[finding.category];
    const scale = ['architecture', 'correctness', 'security'].includes(finding.category) ? 1 : heuristicScale;
    return finding.points / total * Math.min(total, policy.cap) * policy.multiplier * scale;
  });
  const validKeys = new Set(keys.filter((_, index) => contributions[index] > 0));
  return {
    validKeys,
    apply(voided): Analysis {
      if (!voided.size) return base;
      const categoryScores = Object.fromEntries(Object.keys(base.categoryScores).map(category => [category, 0])) as Record<Category, number>;
      const findings: Finding[] = [];
      for (let index = 0; index < base.findings.length; index++) {
        if (voided.has(keys[index])) continue;
        const finding = base.findings[index];
        findings.push(finding);
        categoryScores[finding.category] += contributions[index];
      }
      const score = Object.values(categoryScores).reduce((sum, points) => sum + points, 0);
      return { files: base.files, findings, score, categoryScores, checkCoverage: base.checkCoverage };
    }
  };
}
