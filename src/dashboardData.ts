import { CodeFile, Finding } from './analysis';

export interface DashboardFinding {
  index: number;
  path: string;
  line?: number;
  category: string;
  source: string;
  points: number;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  openable: boolean;
}

export interface FileScore { path: string; score: number; findings: number }

export function fileScores(findings: Finding[], files: CodeFile[]): FileScore[] {
  const scores = new Map(files.map(file => [file.path, { path: file.path, score: 0, findings: 0 }]));
  for (const finding of findings) {
    const entry = scores.get(finding.path);
    if (entry) { entry.score += finding.points; entry.findings++; }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export function dashboardFindings(findings: Finding[], files: CodeFile[]): DashboardFinding[] {
  const available = new Set(files.filter(file => file.uri).map(file => file.path));
  return [...findings]
    .sort((a, b) => b.points - a.points || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0))
    .map((finding, index) => ({
      index,
      path: finding.path,
      line: finding.line,
      category: finding.category,
      source: finding.source,
      points: finding.points,
      message: finding.message,
      severity: finding.points >= 6 ? 'critical' : finding.points >= 4 ? 'high' : finding.points >= 2 ? 'medium' : 'low',
      openable: available.has(finding.path)
    }));
}
