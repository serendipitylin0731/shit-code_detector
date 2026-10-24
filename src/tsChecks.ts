import type * as Ts from 'typescript';
import type { CodeFile, Finding } from './analysis';

// 编译时将解析器复制到 dist/vendor，VSIX 无需在运行时安装 npm 依赖。
const ts = require('../vendor/typescript') as typeof import('typescript');

const spacedOperators = new Set<number>([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken
]);

export function inspectTypeScript(file: CodeFile): Finding[] {
  const findings: Finding[] = [];
  const add = (line: number, category: Finding['category'], rule: string, points: number, message: string): void => {
    findings.push({ path: file.path, line, category, rule, points, message, source: 'rules' });
  };
  const scriptKind = /\.tsx$/i.test(file.path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file.path) ? ts.ScriptKind.JSX : file.language === 'TypeScript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind);
  const lineAt = (position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
  const diagnostics = (source as Ts.SourceFile & { parseDiagnostics?: readonly Ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const diagnostic of diagnostics.slice(0, 5)) {
    add(lineAt(diagnostic.start ?? 0), 'correctness', 'syntax-error', 5, `语法错误：${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  if (diagnostics.length) return findings;

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false,
    scriptKind === ts.ScriptKind.TSX || scriptKind === ts.ScriptKind.JSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    file.content);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\/\/(?![/!<#])\S/.test(scanner.getTokenText())) {
      const line = lineAt(scanner.getTokenPos());
      add(line, 'style', 'comment-spacing', 1, '// 注释标记后应留一个空格');
    }
  }

  function visit(node: Ts.Node): void {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isEnumMember(node)) && node.initializer) {
      const betweenStart = node.name.end;
      const betweenEnd = node.initializer.getStart(source);
      const between = file.content.slice(betweenStart, betweenEnd);
      const equals = between.lastIndexOf('=');
      if (equals >= 0 && !/\/\*|\/\//.test(between)) {
        const position = betweenStart + equals;
        if (!/\s/.test(file.content[position - 1] ?? ' ') || !/\s/.test(file.content[position + 1] ?? ' ')) {
          add(lineAt(position), 'style', 'operator-spacing', 1, '赋值运算符“=”两侧应留空格');
        }
      }
    }
    if (ts.isBinaryExpression(node) && spacedOperators.has(node.operatorToken.kind)) {
      const start = node.operatorToken.getStart(source);
      const end = node.operatorToken.end;
      const leftEnd = node.left.end;
      const rightStart = node.right.getStart(source);
      const sameLine = lineAt(Math.max(0, leftEnd - 1)) === lineAt(start) && lineAt(start) === lineAt(rightStart);
      const trivia = file.content.slice(leftEnd, start) + file.content.slice(end, rightStart);
      if (sameLine && !/\/\*|\/\//.test(trivia) && (!/\s/.test(file.content[start - 1] ?? ' ') || !/\s/.test(file.content[end] ?? ' '))) {
        add(lineAt(start), 'style', 'operator-spacing', 1, `运算符“${node.operatorToken.getText(source)}”两侧应留空格`);
      }
    }
    if (isFunction(node)) {
      const first = lineAt(node.getStart(source));
      const length = lineAt(node.end) - first + 1;
      // Length is only a supporting signal when control flow is also complex.
      const name = functionName(node);
      const body = (node as Ts.FunctionLikeDeclaration).body;
      if (body) {
        const { complexity, nesting, cognitive } = functionComplexity(body);
        if (length > 180 && complexity > 10) add(first, 'readability', 'long-function', 2, `函数长 ${length} 行且分支较多，建议检查职责划分`);
        if (cognitive > 15) add(first, 'complexity', 'cognitive-complexity', Math.ceil((cognitive - 15) / 5) * 2, `函数“${name}”认知复杂度 ${cognitive}，阅读控制流较困难`);
        else if (complexity > 10) add(first, 'complexity', 'cyclomatic-complexity', Math.ceil((complexity - 10) / 3) * 2, `函数“${name}”圈复杂度 ${complexity}，超过阈值 10`);
        if (nesting > 4 && cognitive <= 15) add(first, 'complexity', 'control-nesting', (nesting - 4) * 2, `函数“${name}”控制流嵌套 ${nesting} 层，超过阈值 4`);
      }
    }
    if (ts.isCatchClause(node)) {
      const statements = node.block.statements;
      if (!statements.length) add(lineAt(node.getStart(source)), 'correctness', 'swallowed-error', 5, '空 catch 块吞掉异常，失败时没有可观察结果');
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isNullishLiteral(node.expression)) {
      add(lineAt(node.getStart(source)), 'correctness', 'null-dereference', 5, '直接访问 null/undefined 的成员会抛出 TypeError');
    }
    if (ts.isCallExpression(node) && isNullishLiteral(node.expression)) {
      add(lineAt(node.getStart(source)), 'correctness', 'null-call', 5, '直接调用 null/undefined 会抛出 TypeError');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'JSON' &&
        node.expression.name.text === 'parse' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      try { JSON.parse(node.arguments[0].text); }
      catch { add(lineAt(node.getStart(source)), 'correctness', 'invalid-json-parse', 4, 'JSON.parse 的字面量参数不是合法 JSON，执行时会抛出 SyntaxError'); }
    }
    if (ts.isBlock(node)) {
      for (let index = 1; index < node.statements.length; index++) {
        const previous = node.statements[index - 1];
        if (ts.isReturnStatement(previous) || ts.isThrowStatement(previous) || ts.isBreakStatement(previous) || ts.isContinueStatement(previous)) {
          add(lineAt(node.statements[index].getStart(source)), 'correctness', 'unreachable-code', 4, '前一条语句已终止当前控制流，后续代码不可达');
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

function isNullishLiteral(node: Ts.Node): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');
}

function isFunction(node: Ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function functionName(node: Ts.Node): string {
  if ('name' in node && node.name && typeof node.name === 'object' && 'getText' in node.name) return (node.name as Ts.Node).getText();
  return '<匿名函数>';
}

function functionComplexity(body: Ts.Node): { complexity: number; nesting: number; cognitive: number } {
  let complexity = 1;
  let nesting = 0;
  let cognitive = 0;
  function visit(node: Ts.Node, depth: number): void {
    if (node !== body && isFunction(node)) return;
    const branch = ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) ||
      ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) ||
      ts.isCatchClause(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node);
    if (branch) { complexity++; cognitive += 1 + depth; }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { complexity++; cognitive++; }
    const next = branch ? depth + 1 : depth;
    nesting = Math.max(nesting, next);
    ts.forEachChild(node, child => visit(child, next));
  }
  visit(body, 0);
  return { complexity, nesting, cognitive };
}
