import path from 'node:path';
import { inspectGeneral } from './generalChecks';
import { inspectPython } from './pythonChecks';
import { inspectTypeScript } from './tsChecks';
import { inspectDuplication, inspectImportCycles } from './projectChecks';

export type Category = 'style' | 'naming' | 'readability' | 'complexity' | 'duplication' | 'consistency' | 'architecture' | 'correctness' | 'security';

export interface CodeFile {
  path: string;
  language: string;
  content: string;
  uri?: string;
}

export interface Finding {
  path: string;
  line?: number;
  category: Category;
  rule: string;
  points: number;
  message: string;
  source: 'rules' | 'ai';
  aiGrade?: 'B' | 'C' | 'D' | 'E';
  confidence?: 'high' | 'medium' | 'low';
  evidenceType?: 'static-confirmed' | 'ai-inference';
}

export interface Analysis {
  files: CodeFile[];
  findings: Finding[];
  score: number;
  categoryScores: Record<Category, number>;
  checkCoverage: string;
}

/** Local heuristic signals have different reliability and cannot grow equally without bound. */
export const LOCAL_CATEGORY_POLICY: Readonly<Record<Category, { cap: number; multiplier: number }>> = {
  style: { cap: 24, multiplier: 0.5 },
  consistency: { cap: 16, multiplier: 0.75 },
  naming: { cap: 30, multiplier: 0.75 },
  readability: { cap: 50, multiplier: 0.75 },
  complexity: { cap: 60, multiplier: 0.6 },
  duplication: { cap: 40, multiplier: 0.75 },
  architecture: { cap: Infinity, multiplier: 1 },
  correctness: { cap: Infinity, multiplier: 1 },
  security: { cap: Infinity, multiplier: 1 }
};

const languageByExtension: Record<string, string> = {
  '.py': 'Python', '.pyi': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.c': 'C', '.h': 'C/C++', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++',
  '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby', '.swift': 'Swift', '.scala': 'Scala',
  '.dart': 'Dart', '.lua': 'Lua', '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell', '.r': 'R', '.jl': 'Julia', '.ex': 'Elixir', '.exs': 'Elixir',
  '.erl': 'Erlang', '.hs': 'Haskell', '.pl': 'Perl', '.sql': 'SQL', '.vue': 'Vue',
  '.svelte': 'Svelte', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.less': 'LESS', '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.xml': 'XML', '.proto': 'Protobuf', '.graphql': 'GraphQL', '.tf': 'Terraform',
  '.nix': 'Nix', '.gleam': 'Gleam', '.zig': 'Zig', '.m': 'Objective-C', '.mm': 'Objective-C++'
};

const specialNames: Record<string, string> = {
  Dockerfile: 'Dockerfile', Makefile: 'Makefile', Jenkinsfile: 'Groovy',
  Gemfile: 'Ruby', Rakefile: 'Ruby'
};

export function languageOf(filePath: string): string | undefined {
  const base = path.basename(filePath);
  return specialNames[base] ?? languageByExtension[path.extname(base).toLowerCase()];
}

export function analyze(files: CodeFile[], extra: Finding[] = [], projectMode = true): Analysis {
  const findings: Finding[] = [];
  const add = (file: string, line: number | undefined, category: Category, rule: string, points: number, message: string): void => {
    findings.push({ path: file, line, category, rule, points, message, source: 'rules' });
  };

  const indentByLanguage = new Map<string, { tabs: CodeFile[]; spaces: CodeFile[] }>();
  let jsTsChecked = 0;
  let jsonChecked = 0;
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    const nonblank = lines.filter(line => line.trim().length > 0);
    const tabLines = nonblank.filter(line => /^\t+\S/.test(line)).length;
    const spaceLines = nonblank.filter(line => /^ +\S/.test(line)).length;
    if (tabLines + spaceLines >= 4 && tabLines !== spaceLines) {
      const styleGroup = `${path.posix.dirname(file.path.replaceAll('\\', '/'))}\0${file.language}`;
      const group = indentByLanguage.get(styleGroup) ?? { tabs: [], spaces: [] };
      (tabLines > spaceLines ? group.tabs : group.spaces).push(file);
      indentByLanguage.set(styleGroup, group);
    }

    const lf = (file.content.match(/(?<!\r)\n/g) ?? []).length;
    const crlf = (file.content.match(/\r\n/g) ?? []).length;
    if (lf > 0 && crlf > 0) add(file.path, undefined, 'consistency', 'mixed-eol', 2, '同一文件混用了 LF 和 CRLF 换行符');
    // File size alone does not establish an architecture defect.

    findings.push(...inspectGeneral(file));
    if (file.language === 'TypeScript' || file.language === 'JavaScript') {
      findings.push(...inspectTypeScript(file));
      jsTsChecked++;
    }
    if (file.language === 'JSON' && !/(?:^|\/)(?:tsconfig|jsconfig|settings|launch|tasks)\b/i.test(file.path)) {
      jsonChecked++;
      try { JSON.parse(file.content); }
      catch { add(file.path, undefined, 'correctness', 'syntax-error', 5, 'JSON 语法无效，按严格 JSON 读取时会失败'); }
    }

    let blankRun = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const number = index + 1;
      if (/\s+$/.test(line) && line.trim().length > 0) add(file.path, number, 'style', 'trailing-space', 1, '行尾存在多余空白');
      const indent = line.match(/^[ \t]*/)?.[0] ?? '';
      if (file.language !== 'Makefile' && indent.includes(' ') && indent.includes('\t')) {
        add(file.path, number, 'style', 'mixed-indent', 2, '同一行缩进混用 Tab 与空格');
      }
      if (line.length > 120 && !/^\s*(?:\/\/|#|\*|<!--)/.test(line)) add(file.path, number, 'readability', 'long-line', 1, `代码行长 ${line.length} 字符，超过 120`);
      blankRun = line.trim() ? 0 : blankRun + 1;
      if (blankRun >= 5) add(file.path, number, 'style', 'blank-run', 1, '连续空行超过 4 行');
    }
  }

  for (const [styleGroup, group] of indentByLanguage) {
    if (!group.tabs.length || !group.spaces.length) continue;
    const minority = group.tabs.length <= group.spaces.length ? group.tabs : group.spaces;
    for (const file of minority) add(file.path, undefined, 'consistency', 'indent-style', 2, `${styleGroup.split('\0')[1]} 文件与同目录同语言文件的缩进风格不一致`);
  }

  const pythonFiles = files.filter(file => file.language === 'Python');
  const python = inspectPython(pythonFiles);
  findings.push(...python.findings);
  findings.push(...inspectDuplication(files));
  if (projectMode) findings.push(...inspectImportCycles(files));
  const syntaxFailureFiles = new Set(findings.filter(finding => finding.rule === 'syntax-error').map(finding => finding.path)).size;
  const checkCoverage = `JS/TS AST ${jsTsChecked} 个、Python AST ${python.checked}/${pythonFiles.length} 个、严格 JSON ${jsonChecked} 个、语法解析失败 ${syntaxFailureFiles} 个文件${python.note ? `；${python.note}` : ''}`;

  return finalize(files, [...findings, ...extra], checkCoverage);
}

export function mergeAnalysis(base: Analysis, extra: Finding[]): Analysis {
  return finalize(base.files, [...base.findings, ...extra], base.checkCoverage);
}

function finalize(files: CodeFile[], merged: Finding[], checkCoverage: string): Analysis {
  const confirmed = new Set(['syntax-error', 'zero-division', 'none-dereference', 'empty-index', 'null-dereference', 'null-call', 'invalid-json-parse', 'unreachable-code']);
  for (const finding of merged) {
    finding.evidenceType ??= finding.source === 'ai' ? 'ai-inference' : 'static-confirmed';
    finding.confidence ??= finding.source === 'ai' ? 'medium' : confirmed.has(finding.rule) ? 'high' : 'medium';
  }
  const categoryScores: Record<Category, number> = { style: 0, naming: 0, readability: 0, complexity: 0, duplication: 0, consistency: 0, architecture: 0, correctness: 0, security: 0 };
  const localTotals = { ...categoryScores };
  const effectiveLines = files.reduce((total, file) => total + file.content.split(/\r?\n/)
    .filter(line => line.trim() && !/^\s*(?:#|\/\/|\*|<!--)/.test(line)).length, 0);
  const heuristicScale = Math.min(1, Math.sqrt(1000 / Math.max(effectiveLines, 1)));
  for (const finding of merged) {
    if (finding.source === 'ai') categoryScores[finding.category] += finding.points;
    else localTotals[finding.category] += finding.points;
  }
  for (const category of Object.keys(categoryScores) as Category[]) {
    const policy = LOCAL_CATEGORY_POLICY[category];
    const scale = ['architecture', 'correctness', 'security'].includes(category) ? 1 : heuristicScale;
    categoryScores[category] += Math.min(localTotals[category], policy.cap) * policy.multiplier * scale;
  }
  return { files, findings: merged, score: Object.values(categoryScores).reduce((sum, points) => sum + points, 0), categoryScores, checkCoverage };
}
