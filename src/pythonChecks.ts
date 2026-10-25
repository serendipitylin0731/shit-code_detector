import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { CodeFile, Finding } from './analysis';

export interface PythonCheckResult {
  findings: Finding[];
  checked: number;
  parseFailurePaths: string[];
  note?: string;
}

export function inspectPython(files: CodeFile[]): PythonCheckResult {
  if (!files.length) return { findings: [], checked: 0, parseFailurePaths: [] };
  const command = process.platform === 'win32' ? 'py' : 'python3';
  const prefix = process.platform === 'win32' ? ['-3'] : [];
  const checker = path.join(__dirname, '..', 'vendor', 'python_check.py');
  const findings: Finding[] = [];
  let checked = 0;
  const parseFailurePaths: string[] = [];
  for (let start = 0; start < files.length; start += 20) {
    const chunk = files.slice(start, start + 20).map(file => ({ path: file.path, content: file.content }));
    const processResult = spawnSync(command, [...prefix, '-I', '-S', checker], {
      input: JSON.stringify(chunk), encoding: 'utf8', timeout: 30_000,
      maxBuffer: 12 * 1024 * 1024,
      env: { ...process.env, PYTHONNOUSERSITE: '1' }
    });
    if (processResult.error || processResult.status !== 0) {
      return { findings, checked, parseFailurePaths, note: 'Python 解析器不可用或检查超时；未执行 Python 代码，其余规则仍已运行。' };
    }
    try {
      const result = JSON.parse(processResult.stdout) as { checked: number; findings: Finding[]; parseFailurePaths: string[] };
      if (!Array.isArray(result.findings) || !Array.isArray(result.parseFailurePaths) || result.checked !== chunk.length) throw new Error('invalid output');
      const paths = new Set(chunk.map(file => file.path));
      if (!result.parseFailurePaths.every(filePath => typeof filePath === 'string' && paths.has(filePath))) throw new Error('invalid paths');
      parseFailurePaths.push(...result.parseFailurePaths);
      for (const finding of result.findings) {
        if (paths.has(finding.path) && Number.isInteger(finding.points) && finding.points > 0 && finding.points <= 20) findings.push(finding);
      }
      checked += result.checked;
    } catch {
      return { findings, checked, parseFailurePaths, note: 'Python 解析器返回无效结果；其余规则仍已运行。' };
    }
  }
  return { findings, checked, parseFailurePaths };
}
