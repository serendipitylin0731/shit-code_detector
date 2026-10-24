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
  let spacedComments = 0;
  let compactComments = 0;
  let firstCompactLine = 0;
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
      compactComments++;
      firstCompactLine ||= number;
      add(number, 'style', 'comment-spacing', 1, '// 注释标记后应留一个空格');
    } else if (slashComments.has(file.language) && masked.comment && /^\/\/\s+\S/.test(masked.comment)) {
      spacedComments++;
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
  if (spacedComments && compactComments) add(firstCompactLine, 'consistency', 'comment-style', 2, '同一文件的普通注释混用了带空格和不带空格的标记格式');
  return findings;
}

function inspectMacro(line: string, lineNumber: number, add: (line: number, category: Finding['category'], rule: string, points: number, message: string) => void): void {
  const match = line.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/);
  if (!match) return;
  const [, name, , parameters, rawBody] = match;
  const body = rawBody.replace(/\\\s*$/, '').trim();
  const cleanBody = maskLine(body, false).code.trim();
  if (/^(?:int|long|short|float|double|char|bool|true|false|return|class|struct|private|public)$/.test(name)) {
    add(lineNumber, 'correctness', 'macro-keyword', 6, `宏“${name}”替换语言关键字或基础类型，可能改变大量代码的含义`);
  }
  if (!body) return;
  if (/;\s*$/.test(cleanBody) && !/^do\s*\{/.test(cleanBody)) add(lineNumber, 'correctness', 'macro-semicolon', 2, `宏“${name}”末尾带分号，作为表达式使用时容易改变语句结构`);
  const expression = /[+*/%&|^?:<>-]/.test(cleanBody) && !/^do\s*\{/.test(cleanBody);
  if (expression && !(cleanBody.startsWith('(') && cleanBody.endsWith(')'))) {
    add(lineNumber, 'correctness', 'macro-expression-parens', 3, `宏“${name}”的表达式未整体加括号，可能产生优先级错误`);
  }
  if (parameters === undefined) return;
  const names = parameters.split(',').map(value => value.trim()).filter(value => /^[A-Za-z_]\w*$/.test(value));
  for (const parameter of names) {
    const occurrences = [...cleanBody.matchAll(new RegExp(`\\b${parameter}\\b`, 'g'))];
    if (expression && occurrences.some(found => {
      const index = found.index;
      return cleanBody[index - 1] !== '(' || cleanBody[index + parameter.length] !== ')';
    })) {
      add(lineNumber, 'correctness', 'macro-argument-parens', 3, `宏“${name}”的参数“${parameter}”未逐处加括号，传入表达式时可能改变优先级`);
    }
    if (occurrences.length > 1) add(lineNumber, 'correctness', 'macro-repeat-argument', 2, `宏“${name}”多次展开参数“${parameter}”，传入带副作用的表达式时可能重复求值`);
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
