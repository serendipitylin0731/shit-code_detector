import type { CodeFile, Finding } from './analysis';

const macroLanguages = new Set(['C', 'C++', 'C/C++', 'Objective-C', 'Objective-C++']);
const cLikeSpacing = new Set(['C', 'C++', 'C/C++', 'Objective-C', 'Objective-C++', 'C#', 'Java', 'Go', 'Rust', 'Kotlin', 'Swift', 'Dart', 'Scala', 'Gleam']);
const slashComments = new Set([...cLikeSpacing, 'PHP', 'Vue', 'Svelte', 'CSS', 'SCSS', 'LESS']);

export function inspectGeneral(file: CodeFile): Finding[] {
  const findings: Finding[] = [];
  const add = (line: number, category: Finding['category'], rule: string, points: number, message: string): void => {
    findings.push({ path: file.path, line, category, rule, points, message, source: 'rules' });
  };
  const lines = file.content.split(/\r?\n/);
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const number = index + 1;
    if (macroLanguages.has(file.language) && /^\s*#\s*define\b/.test(line)) {
      inspectMacro(line, number, add);
      continue;
    }
    const masked = maskLine(line, inBlockComment);
    inBlockComment = masked.inBlockComment;
    if (slashComments.has(file.language) && masked.comment && /^\/\/(?![/!<#])\S/.test(masked.comment)) {
      add(number, 'style', 'comment-spacing', 1, '// 注释标记后应留一个空格');
    }
    if (cLikeSpacing.has(file.language) && !/^\s*#/.test(line) && !/\boperator\s*=/.test(masked.code)) {
      const pattern = /==|!=|<=|>=|\+=|-=|\*=|\/=|:=|(?<![!<>=+\-*/%&|^])=(?![=><])/g;
      for (const match of masked.code.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const before = masked.code[start - 1] ?? ' ';
        const after = masked.code[end] ?? ' ';
        if (!/\s/.test(before) || !/\s/.test(after)) add(number, 'style', 'operator-spacing', 1, `运算符“${match[0]}”两侧应留空格`);
      }
    }
  }
  return findings;
}

function inspectMacro(line: string, lineNumber: number, add: (line: number, category: Finding['category'], rule: string, points: number, message: string) => void): void {
  const match = line.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/);
  if (!match) return;
  const [, name, , parameters, rawBody] = match;
  const body = rawBody.replace(/\\\s*$/, '').trim();
  const cleanBody = maskLine(body, false).code.trim();
  if (/^(?:int|long|short|float|double|char|bool|true|false|return|class|struct|private|public)$/.test(name)) {
    add(lineNumber, 'readability', 'macro-keyword', 4, `宏“${name}”复用语言关键字或基础类型名称，阅读和维护时难以区分`);
  }
  if (!body) return;
  if (/;\s*$/.test(cleanBody) && !/^do\s*\{/.test(cleanBody)) add(lineNumber, 'readability', 'macro-semicolon', 2, `宏“${name}”内部带末尾分号，调用处的语句形态不直观`);
  const expression = /[+*/%&|^?:<>-]/.test(cleanBody) && !/^do\s*\{/.test(cleanBody);
  if (expression && !(cleanBody.startsWith('(') && cleanBody.endsWith(')'))) {
    add(lineNumber, 'readability', 'macro-expression-parens', 2, `宏“${name}”的表达式未整体加括号，展开结构不直观`);
  }
  if (parameters === undefined) return;
  const names = parameters.split(',').map(value => value.trim()).filter(value => /^[A-Za-z_]\w*$/.test(value));
  for (const parameter of names) {
    const occurrences = [...cleanBody.matchAll(new RegExp(`\\b${parameter}\\b`, 'g'))];
    if (expression && occurrences.some(found => {
      const index = found.index;
      return cleanBody[index - 1] !== '(' || cleanBody[index + parameter.length] !== ')';
    })) {
      add(lineNumber, 'readability', 'macro-argument-parens', 2, `宏“${name}”的参数“${parameter}”未逐处加括号，展开结构不直观`);
    }
    if (occurrences.length > 1) add(lineNumber, 'readability', 'macro-repeat-argument', 2, `宏“${name}”多次展开参数“${parameter}”，调用处不易看出展开次数`);
  }
}

function maskLine(line: string, startedInBlock: boolean): { code: string; comment?: string; inBlockComment: boolean } {
  const code = line.split('');
  let inBlockComment = startedInBlock;
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const current = line[index];
    const next = line[index + 1];
    if (inBlockComment) {
      code[index] = ' ';
      if (current === '*' && next === '/') { code[++index] = ' '; inBlockComment = false; }
      continue;
    }
    if (quote) {
      code[index] = ' ';
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') { quote = current; code[index] = ' '; continue; }
    if (current === '/' && next === '*') { code[index] = ' '; code[++index] = ' '; inBlockComment = true; continue; }
    if (current === '/' && next === '/') {
      for (let end = index; end < code.length; end++) code[end] = ' ';
      return { code: code.join(''), comment: line.slice(index), inBlockComment };
    }
  }
  return { code: code.join(''), inBlockComment };
}
