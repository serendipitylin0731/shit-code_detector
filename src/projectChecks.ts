import path from 'node:path';
import type * as Ts from 'typescript';
import type { CodeFile, Finding } from './analysis';

const ts = require('../vendor/typescript') as typeof import('typescript');

const duplicateLanguages = new Set(['Python', 'JavaScript', 'TypeScript', 'Java', 'C', 'C++', 'C/C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin']);
const blockSize = 6;

/** Find only exact, substantial blocks. Fuzzy signatures produce too many false positives. */
export function inspectDuplication(files: CodeFile[]): Finding[] {
  const findings: Finding[] = [];
  const occurrences = new Map<string, { path: string; line: number }[]>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!duplicateLanguages.has(file.language) || isTestPath(file.path)) continue;
    const lines = file.content.split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' '));
    for (let index = 0; index + blockSize <= lines.length; index++) {
      const block = lines.slice(index, index + blockSize);
      if (block.some(line => !line || /^(?:#|\/\/|\/\*|\*|import\b|from\b|using\b|#include\b)/.test(line))) continue;
      if (block.join('').length < 120 || new Set(block).size < 3) continue;
      const executable = block.filter(line => /\b(?:if|for|while|return|raise|throw|await|const|let|var)\b|(?<![=!<>])=(?!=)|\b\w+\s*\(/.test(line));
      if (executable.length < 4) continue;
      const signature = `${file.language}\0${block.join('\n')}`;
      const seen = occurrences.get(signature) ?? [];
      const previous = seen.at(-1);
      if (previous?.path === file.path && index + 1 - previous.line < blockSize) continue;
      seen.push({ path: file.path, line: index + 1 });
      occurrences.set(signature, seen);
    }
  }
  const reportedUntil = new Map<string, number>();
  for (const seen of occurrences.values()) {
    if (seen.length < 3) continue;
    for (const occurrence of seen.slice(2)) {
      if (occurrence.line <= (reportedUntil.get(occurrence.path) ?? 0)) continue;
      findings.push({ path: occurrence.path, line: occurrence.line, category: 'duplication', rule: 'duplicate-block', points: 4,
        message: `连续 ${blockSize} 行在至少三处相同（最早见 ${seen[0].path}:${seen[0].line}）；请检查是否属于不必要的复制`, source: 'rules' });
      reportedUntil.set(occurrence.path, occurrence.line + blockSize - 1);
    }
  }
  return findings;
}

/** Build an import graph from imports that resolve to collected local files. */
export function inspectImportCycles(files: CodeFile[]): Finding[] {
  const byPath = new Map(files.map(file => [file.path.replaceAll('\\', '/'), file]));
  const edges = new Map<string, Set<string>>();
  for (const file of files) {
    const name = file.path.replaceAll('\\', '/');
    const imports = new Set<string>();
    const add = (base: string, extensions: string[]): void => {
      for (const candidate of [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => `${base}/index${ext}`), `${base}/__init__.py`]) {
        if (candidate !== name && !candidate.endsWith('/__init__.py') && byPath.has(candidate)) { imports.add(candidate); break; }
      }
    };
    if (file.language === 'JavaScript' || file.language === 'TypeScript') {
      for (const specifier of staticModuleSpecifiers(file)) {
        if (!specifier.startsWith('.')) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
        add(base, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
      }
    } else if (file.language === 'Python') {
      if (name.endsWith('/__init__.py')) { edges.set(name, imports); continue; }
      // Only module-level imports are definite initialization dependencies.
      for (const line of file.content.split(/\r?\n/)) {
        const match = line.match(/^from[ \t]+(\.+)([\w.]*)[ \t]+import[ \t]+([\w, ]+)/);
        if (!match) continue;
        const up = '../'.repeat(match[1].length - 1);
        const modulePath = match[2].replaceAll('.', '/');
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(name), up, modulePath));
        if (modulePath) add(base, ['.py']);
        else for (const imported of match[3].split(',').map(item => item.trim()).filter(Boolean)) {
          if (/^[A-Za-z_]\w*$/.test(imported)) add(path.posix.join(base, imported), ['.py']);
        }
      }
    }
    edges.set(name, imports);
  }

  const visited = new Set<string>();
  const order: string[] = [];
  for (const node of edges.keys()) {
    if (visited.has(node)) continue;
    const work: { node: string; expanded: boolean }[] = [{ node, expanded: false }];
    while (work.length) {
      const item = work.pop()!;
      if (item.expanded) { order.push(item.node); continue; }
      if (visited.has(item.node)) continue;
      visited.add(item.node);
      work.push({ node: item.node, expanded: true });
      for (const neighbor of edges.get(item.node) ?? []) if (!visited.has(neighbor)) work.push({ node: neighbor, expanded: false });
    }
  }
  const reverse = new Map<string, Set<string>>();
  for (const node of edges.keys()) reverse.set(node, new Set());
  for (const [node, imports] of edges) for (const imported of imports) reverse.get(imported)?.add(node);
  const components: string[][] = [];
  const assigned = new Set<string>();
  for (const node of order.reverse()) {
    if (assigned.has(node)) continue;
    const component: string[] = [];
    const work = [node]; assigned.add(node);
    while (work.length) {
      const member = work.pop()!; component.push(member);
      for (const neighbor of reverse.get(member) ?? []) if (!assigned.has(neighbor)) { assigned.add(neighbor); work.push(neighbor); }
    }
    if (component.length > 1) components.push(component.sort());
  }
  return components.sort((a, b) => a[0].localeCompare(b[0])).map(component => ({
    path: component[0], category: 'architecture', rule: 'import-cycle', points: 6 + (component.length - 2) * 2,
    message: `${component.length} 个本地模块形成循环依赖：${component.slice(0, 6).join(' → ')}${component.length > 6 ? ' 等' : ''}`,
    source: 'rules'
  }));
}

function staticModuleSpecifiers(file: CodeFile): string[] {
  const kind = /\.tsx$/.test(file.path) ? ts.ScriptKind.TSX : /\.jsx$/.test(file.path) ? ts.ScriptKind.JSX :
    file.language === 'TypeScript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, false, kind);
  if ((source as Ts.SourceFile & { parseDiagnostics?: readonly Ts.Diagnostic[] }).parseDiagnostics?.length) return [];
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const named = clause?.namedBindings;
      if (clause?.isTypeOnly || (named && ts.isNamedImports(named) && !clause.name && named.elements.every(item => item.isTypeOnly))) continue;
      imports.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly &&
        !(statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every(item => item.isTypeOnly)) &&
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (value && ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'require' &&
            value.arguments.length === 1 && ts.isStringLiteral(value.arguments[0])) imports.push(value.arguments[0].text);
      }
    }
  }
  return imports;
}

function isTestPath(filePath: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__|spec|specs)\/|(?:\.test|\.spec)\.[^.]+$|(?:^|\/)(?:test_|spec_)/i.test(filePath);
}
