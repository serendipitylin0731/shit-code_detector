import assert from 'node:assert/strict';
import test from 'node:test';
import { Finding } from '../src/analysis';
import { dashboardFindings } from '../src/dashboardData';

test('侧边栏按内部权重排序，只暴露每条问题的严重程度', () => {
  const values = [1, 2, 4, 6];
  const findings: Finding[] = values.map((points, index) => ({
    path: 'main.py', line: index + 1, category: 'readability', rule: 'example', points,
    message: '可定位的问题', source: 'rules'
  }));
  const rows = dashboardFindings(findings, [{ path: 'main.py', language: 'Python', content: '', uri: 'file:///main.py' }]);
  assert.deepEqual(rows.map(row => row.line), [4, 3, 2, 1]);
  assert.ok(rows.every(row => !('points' in row)));
  assert.deepEqual(rows.map(row => row.severity), ['critical', 'high', 'medium', 'low']);
  assert.ok(rows.every(row => row.openable));
});

test('AI 问题的颜色依据 A–E 等级，而非加权后的内部点数', () => {
  const findings: Finding[] = [
    { path: 'main.py', line: 1, category: 'architecture', rule: 'ai-module_boundaries', points: 6, aiGrade: 'B', message: '局部问题', source: 'ai' },
    { path: 'main.py', line: 2, category: 'architecture', rule: 'ai-module_boundaries', points: 10, aiGrade: 'E', message: '严重问题', source: 'ai' }
  ];
  const rows = dashboardFindings(findings, []);
  assert.deepEqual(rows.map(item => item.severity), ['critical', 'low']);
});
