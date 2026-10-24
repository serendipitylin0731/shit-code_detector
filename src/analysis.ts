import path from 'node:path';
import { inspectGeneral } from './generalChecks';
import { inspectPython } from './pythonChecks';
import { inspectTypeScript } from './tsChecks';

export type Category = 'style' | 'naming' | 'readability' | 'consistency' | 'architecture' | 'correctness';

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
}

export interface Analysis {
  files: CodeFile[];
  findings: Finding[];
  score: number;
  categoryScores: Record<Category, number>;
  checkCoverage: string;
}

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
  const sourceByDirectory = new Map<string, number>();
  let jsTsChecked = 0;
  let jsonChecked = 0;
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    const directory = path.posix.dirname(file.path.replaceAll('\\', '/'));
    sourceByDirectory.set(directory, (sourceByDirectory.get(directory) ?? 0) + 1);
    const nonblank = lines.filter(line => line.trim().length > 0);
    const tabLines = nonblank.filter(line => /^\t+\S/.test(line)).length;
    const spaceLines = nonblank.filter(line => /^ +\S/.test(line)).length;
    if (tabLines + spaceLines >= 4 && tabLines !== spaceLines) {
      const group = indentByLanguage.get(file.language) ?? { tabs: [], spaces: [] };
      (tabLines > spaceLines ? group.tabs : group.spaces).push(file);
      indentByLanguage.set(file.language, group);
    }

    const lf = (file.content.match(/(?<!\r)\n/g) ?? []).length;
    const crlf = (file.content.match(/\r\n/g) ?? []).length;
    if (lf > 0 && crlf > 0) add(file.path, undefined, 'consistency', 'mixed-eol', 2, '同一文件混用了 LF 和 CRLF 换行符');
    if (projectMode && !isTestFile(file.path) && lines.length > 800) {
      const points = Math.ceil((lines.length - 800) / 200) * 2;
      add(file.path, undefined, 'architecture', 'large-file', points, `${lines.length} 行代码集中在一个文件中，建议检查职责划分`);
    }

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
      if (!isTestFile(file.path) && supportsNameCheck(file.language)) {
        const declaration = line.match(/\b(?:const|let|var|def|function|class|fn|func|val|auto|int|string|String)\s+(foo|bar|baz|tmp|temp|thing|stuff|xxx)\b/i);
        if (declaration) add(file.path, number, 'naming', 'vague-name', 2, `声明名“${declaration[1]}”缺乏具体含义`);
      }
    }
  }

  for (const [language, group] of indentByLanguage) {
    if (!group.tabs.length || !group.spaces.length) continue;
    const minority = group.tabs.length <= group.spaces.length ? group.tabs : group.spaces;
    for (const file of minority) add(file.path, undefined, 'consistency', 'indent-style', 2, `${language} 文件与同语言其他文件的缩进风格不一致`);
  }
  if (projectMode && files.length >= 8) {
    for (const [directory, count] of sourceByDirectory) {
      if (count > 30 && !isTestFile(`${directory}/ordinary.ts`)) add(directory, undefined, 'architecture', 'crowded-directory', Math.ceil((count - 30) / 15) * 2, `同一目录放置 ${count} 个代码文件，建议检查模块边界`);
    }
  }

  const pythonFiles = files.filter(file => file.language === 'Python');
  const python = inspectPython(pythonFiles);
  findings.push(...python.findings);
  const checkCoverage = `JS/TS AST ${jsTsChecked} 个、Python AST ${python.checked}/${pythonFiles.length} 个、严格 JSON ${jsonChecked} 个${python.note ? `；${python.note}` : ''}`;

  return finalize(files, [...findings, ...extra], checkCoverage);
}

export function mergeAnalysis(base: Analysis, extra: Finding[]): Analysis {
  return finalize(base.files, [...base.findings, ...extra], base.checkCoverage);
}

function finalize(files: CodeFile[], merged: Finding[], checkCoverage: string): Analysis {
  const categoryScores: Record<Category, number> = { style: 0, naming: 0, readability: 0, consistency: 0, architecture: 0, correctness: 0 };
  for (const finding of merged) categoryScores[finding.category] += finding.points;
  return { files, findings: merged, score: merged.reduce((sum, finding) => sum + finding.points, 0), categoryScores, checkCoverage };
}

function supportsNameCheck(language: string): boolean {
  return !['JSON', 'YAML', 'TOML', 'XML', 'HTML', 'CSS', 'SCSS', 'LESS', 'SQL', 'GraphQL', 'Protobuf', 'Terraform'].includes(language);
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  const base = path.posix.basename(normalized);
  return /(?:^|\/)(?:test|tests|__tests__|spec|specs)\//i.test(normalized) || /^(?:test_|spec_)/i.test(base) || /(?:\.test|\.spec)\.[^.]+$/i.test(base);
}
