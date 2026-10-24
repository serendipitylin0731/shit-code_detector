import assert from 'node:assert/strict';
import test from 'node:test';
import { Finding } from '../src/analysis';
import { dashboardFindings } from '../src/dashboardData';
import { parseLocalAiConfig } from '../src/localConfig';

test('侧边栏按分数排序，并为每条分数标记严重程度', () => {
  const values = [1, 2, 4, 6];
  const findings: Finding[] = values.map((points, index) => ({
    path: 'main.py', line: index + 1, category: 'readability', rule: 'example', points,
    message: '可定位的问题', source: 'rules'
  }));
  const rows = dashboardFindings(findings, [{ path: 'main.py', language: 'Python', content: '', uri: 'file:///main.py' }]);
  assert.deepEqual(rows.map(row => row.points), [6, 4, 2, 1]);
  assert.deepEqual(rows.map(row => row.severity), ['critical', 'high', 'medium', 'low']);
  assert.ok(rows.every(row => row.openable));
});

test('本地 AI 配置将占位符视为未填写', () => {
  assert.deepEqual(parseLocalAiConfig('{"enabled":true,"apiKey":"YOUR_DEEPSEEK_API_KEY_HERE"}'), { enabled: true, apiKey: undefined });
  assert.throws(() => parseLocalAiConfig('{"enabled":"yes"}'), /enabled/);
});
