import { type Analysis, effectiveCodeLines, REFERENCE_CODE_LINES } from './analysis';

export interface SummaryMetrics {
  effectiveLines: number;
  issueDensity: number;
  uncertainAssessments: number;
  languageCoverage: { language: string; files: number; parser: string; parseFailures: number }[];
}

export function summaryMetrics(analysis: Analysis, uncertainAssessments = 0): SummaryMetrics {
  const effectiveLines = effectiveCodeLines(analysis.files);
  const counts = new Map<string, number>();
  const languageByPath = new Map(analysis.files.map(file => [file.path, file.language]));
  const failedPaths = new Set(analysis.parseFailurePaths ?? []);
  const failures = new Map<string, number>();
  for (const filePath of failedPaths) {
    const language = languageByPath.get(filePath);
    if (language) failures.set(language, (failures.get(language) ?? 0) + 1);
  }
  for (const file of analysis.files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  return {
    effectiveLines,
    issueDensity: 1000 * analysis.findings.length / Math.max(effectiveLines, REFERENCE_CODE_LINES),
    uncertainAssessments,
    languageCoverage: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([language, files]) => ({
      language, files, parser: ['Python', 'JavaScript', 'TypeScript', 'JSON'].includes(language) ? '语法解析与通用规则' : '通用规则与语言专项启发式',
      parseFailures: failures.get(language) ?? 0
    }))
  };
}
