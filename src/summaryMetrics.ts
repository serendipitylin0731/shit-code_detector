import { LOCAL_CATEGORY_POLICY, type Analysis, type Category } from './analysis';

export interface SummaryMetrics {
  effectiveLines: number;
  issueDensity: number;
  highRisk: boolean;
  uncertainAssessments: number;
  languageCoverage: { language: string; files: number; parser: string; parseFailures: number }[];
}

export function summaryMetrics(analysis: Analysis, uncertainAssessments = 0): SummaryMetrics {
  const effectiveLines = analysis.files.reduce((total, file) => total + file.content.split(/\r?\n/)
    .filter(line => line.trim() && !/^\s*(?:#|\/\/|\*|<!--)/.test(line)).length, 0);
  const local = new Map<Category, number>();
  let aiTotal = 0;
  for (const finding of analysis.findings) {
    if (finding.source === 'ai') aiTotal += finding.points;
    else local.set(finding.category, (local.get(finding.category) ?? 0) + finding.points);
  }
  const weightedWithoutSizeScale = aiTotal + [...local].reduce((sum, [category, points]) => {
    const policy = LOCAL_CATEGORY_POLICY[category];
    return sum + Math.min(points, policy.cap) * policy.multiplier;
  }, 0);
  const counts = new Map<string, number>();
  const languageByPath = new Map(analysis.files.map(file => [file.path, file.language]));
  const failedPaths = new Set(analysis.findings.filter(finding => finding.rule === 'syntax-error').map(finding => finding.path));
  const failures = new Map<string, number>();
  for (const filePath of failedPaths) {
    const language = languageByPath.get(filePath);
    if (language) failures.set(language, (failures.get(language) ?? 0) + 1);
  }
  for (const file of analysis.files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  return {
    effectiveLines,
    issueDensity: 1000 * weightedWithoutSizeScale / Math.max(effectiveLines, 200),
    highRisk: analysis.findings.some(finding =>
      ['correctness', 'security'].includes(finding.category) && finding.points >= 5 && finding.confidence === 'high'),
    uncertainAssessments,
    languageCoverage: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([language, files]) => ({
      language, files, parser: ['Python', 'JavaScript', 'TypeScript', 'JSON'].includes(language) ? '语法解析与通用规则' : '通用规则与语言专项启发式',
      parseFailures: failures.get(language) ?? 0
    }))
  };
}
