import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { analyze, CodeFile, mergeAnalysis } from '../src/analysis';
import { compareGitBaseline } from '../src/gitBaseline';
import { summaryMetrics } from '../src/summaryMetrics';

const code = (name: string, content: string): CodeFile => ({ path: name, language: 'TypeScript', content });

test('正确性问题不计分，解析失败仅列入覆盖范围', () => {
  const analysis = analyze([code('src/main.ts', 'null.value;')], [], false);
  const metrics = summaryMetrics(analysis);
  assert.equal(analysis.score, 0);
  assert.equal(metrics.issueDensity, 0);
  assert.equal(metrics.languageCoverage[0].parser, '语法解析与通用规则');
  const broken = summaryMetrics(analyze([code('src/broken.ts', 'const value = ;')], [], false));
  assert.equal(broken.languageCoverage[0].parseFailures, 1);
});

test('本地类别系数不改变 AI 固定条目的基础分乘权重', () => {
  const local = analyze([code('src/main.ts', 'export const value=1;')], [], false);
  const merged = mergeAnalysis(local, [{ path: 'src/main.ts', line: 1, category: 'architecture', rule: 'ai-function_cohesion',
    points: 30, message: '函数职责混杂', source: 'ai', aiGrade: 'E' }]);
  assert.equal(merged.score - local.score, 30);
});

test('Git HEAD 基线只标记新增的本地规则问题', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scd-baseline-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(root, 'main.ts'), 'export const value = 1;\n');
    git('add', 'main.ts'); git('commit', '-qm', 'base');
    const changed = 'export const value=1;\n';
    await writeFile(path.join(root, 'main.ts'), changed);
    const comparison = await compareGitBaseline(root, analyze([code('main.ts', changed)], [], false));
    assert.equal(comparison.baselineAvailable, true);
    assert.deepEqual(comparison.changedPaths, ['main.ts']);
    assert.ok(comparison.introduced.some(item => item.rule === 'operator-spacing'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
