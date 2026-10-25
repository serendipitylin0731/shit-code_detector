import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, CodeFile } from '../src/analysis';
import { analyzeWithAi } from '../src/ai';
import { splitAiFile } from '../src/aiChunks';
import { AI_BASE_POINTS, AI_CRITERIA, FILE_AI_CRITERIA, gradePoints, PROJECT_AI_CRITERIA } from '../src/aiRubric';

const options = { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test', maxCharsPerRequest: 12000 };
const source = (path: string, content = 'def run():\n    pass'): CodeFile => ({ path, language: 'Python', content });
const cleanFile = (path: string) => FILE_AI_CRITERIA.map(criterion => ({ path, criterion: criterion.id, grade: 'A', reason: '所给代码未见该项问题。' }));
const cleanProject = () => PROJECT_AI_CRITERIA.map(criterion => ({ path: '<project>', criterion: criterion.id, grade: 'A', reason: '所给项目证据未见该项问题。' }));
const mockResponse = (assessments: unknown[]) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ assessments }) } }]
}), { status: 200 });

test('固定评分表覆盖全部条目，A–E 基础分与权重由插件计算', () => {
  assert.deepEqual(AI_BASE_POINTS, { A: 0, B: 2, C: 4, D: 6, E: 10 });
  assert.deepEqual(['A', 'B', 'C', 'D', 'E'].map(grade => gradePoints(grade as keyof typeof AI_BASE_POINTS, 2)), [0, 4, 8, 12, 20]);
  assert.equal(new Set(AI_CRITERIA.map(item => item.id)).size, AI_CRITERIA.length);
  assert.ok(['logic_correctness', 'readability_flow', 'documentation_contract'].every(id => !AI_CRITERIA.some(item => item.id === id)));
  assert.ok(AI_CRITERIA.every(item => item.weight > 0 && ['A', 'B', 'C', 'D', 'E'].every(grade => item.anchors[grade as keyof typeof item.anchors])));
});

test('约定的空值或正常抛错不能凭缺少本地恢复流程扣分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('safe.py');
    assessments[assessments.findIndex(item => item.criterion === 'boundary_safety')] = { path: 'safe.py', criterion: 'boundary_safety', grade: 'C', line: 1,
      reason: '第 1 行返回空值，但没有检查调用方是否能理解这个结果。' } as typeof assessments[number];
    assessments[assessments.findIndex(item => item.criterion === 'error_strategy')] = { path: 'safe.py', criterion: 'error_strategy', grade: 'C', line: 2,
      reason: '第 2 行直接抛出异常，没有在当前函数捕获并恢复。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('safe.py', 'def run():\n    raise ValueError()')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'boundary_safety')?.grade, 'U');
    assert.equal(result.assessments.find(item => item.criterion === 'error_strategy')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('AI 每个条目都返回等级，A 保留零分记录，C 按基础分乘权重', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.thinking, { type: 'disabled' });
    const assessments = cleanFile('app.py');
    assessments[assessments.findIndex(item => item.criterion === 'function_cohesion')] = { path: 'app.py', criterion: 'function_cohesion', grade: 'C', line: 1,
      reason: 'run 函数同时负责网络请求与文件写入，两种职责被绑在一起。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('app.py')], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.reviewedFiles, 1);
    assert.equal(result.assessments.length, FILE_AI_CRITERIA.length);
    assert.equal(result.assessments.filter(item => item.grade === 'A' && item.points === 0).length, FILE_AI_CRITERIA.length - 1);
    assert.deepEqual(result.findings.map(item => item.points), [8]);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.basePoints, 4);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.weight, 2);
  } finally { globalThis.fetch = original; }
});

test('范围外、缺失、重复和机械问题不会被当作有效 AI 分项', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('main.py').filter(item => item.criterion !== 'performance_risk');
    assessments.push({ path: 'main.py', criterion: 'semantic_naming', grade: 'B', line: 2,
      reason: '第 2 行混用 Tab 和空格缩进，影响代码可读性。' } as typeof assessments[number]);
    assessments.push({ path: 'other.py', criterion: 'semantic_naming', grade: 'E', line: 1, reason: '不存在的文件不应得分。' } as typeof assessments[number]);
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('main.py', 'if True:\n \tpass')], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.reviewedFiles, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.assessments.find(item => item.criterion === 'performance_risk')?.grade, 'U');
    assert.ok(result.errors.some(error => error.includes('缺失、重复或未通过证据校验')));
  } finally { globalThis.fetch = original; }
});

test('项目级无导入推断被记为 U，而非已完成的 A', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (!String(request.messages?.[1]?.content).startsWith('评估一个 <project>')) {
      return mockResponse([...cleanFile('src/a.py'), ...cleanFile('src/b.py')]);
    }
    const assessments = cleanProject();
    assessments[0] = { path: '<project>', criterion: 'module_boundaries', grade: 'D',
      reason: 'src/a.py 与 src/b.py 的 imports 为空，因此职责孤立且缺乏清晰分层。',
      evidencePaths: ['src/a.py', 'src/b.py'] } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('src/a.py', 'value = 1'), source('src/b.py', 'result = 2')]);
    const result = await analyzeWithAi(base, options);
    assert.equal(result.reviewedFiles, 2);
    assert.equal(result.reviewedProject, false);
    assert.equal(result.findings.length, 0);
    assert.equal(result.assessments.length, FILE_AI_CRITERIA.length * 2 + PROJECT_AI_CRITERIA.length);
    assert.equal(result.assessments.find(item => item.criterion === 'module_boundaries')?.grade, 'U');
    assert.equal(result.assessments.find(item => item.criterion === 'module_boundaries')?.adjustedFrom, 'D');
  } finally { globalThis.fetch = original; }
});

test('证据行号不可见记 U，不适用记 N/A，均不伪装为 A', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('sample.py');
    assessments[assessments.findIndex(item => item.criterion === 'boundary_safety')] = { path: 'sample.py', criterion: 'boundary_safety', grade: 'D', line: 99,
      reason: '第 99 行的可达输入导致未预期失败，调用方无法识别错误状态。' } as typeof assessments[number];
    assessments[assessments.findIndex(item => item.criterion === 'performance_risk')] = { path: 'sample.py', criterion: 'performance_risk', grade: 'N/A', reason: '片段没有性能敏感路径。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('sample.py')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'boundary_safety')?.grade, 'U');
    assert.equal(result.assessments.find(item => item.criterion === 'performance_risk')?.grade, 'N/A');
    assert.equal(result.reviewedFiles, 0);
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('同一 AI 条目的独立问题逐条显示，但权重只计算一次', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('sample.py');
    assessments[assessments.findIndex(item => item.criterion === 'semantic_duplication')] = { path: 'sample.py', criterion: 'semantic_duplication', grade: 'D', line: 1,
      reason: '第 1 行与第 2 行保留两份相同转换逻辑，修改时必须同步。',
      issues: [{ line: 1, reason: '第 1 行复制了同一转换步骤，需要同步维护。' },
        { line: 2, reason: '第 2 行又实现相同转换，修改时存在分叉风险。' }] } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('sample.py', 'def run(x):\n    return x')], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.findings.length, 2);
    assert.equal(result.findings.reduce((sum, item) => sum + item.points, 0), 12);
    assert.deepEqual(result.findings.map(item => item.aiGrade), ['D', 'D']);
  } finally { globalThis.fetch = original; }
});

test('一个可见全局配置也可支撑项目安全问题', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (!String(request.messages?.[1]?.content).startsWith('评估一个 <project>')) return mockResponse(cleanFile('config.ts'));
    const assessments = cleanProject();
    const index = assessments.findIndex(item => item.criterion === 'security_boundaries');
    assessments[index] = { path: '<project>', criterion: 'security_boundaries', grade: 'D',
      reason: 'config.ts 第 1 行全局禁用认证，所有路由均可被未授权访问敏感数据。', evidencePaths: ['config.ts'] } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([{ path: 'config.ts', language: 'TypeScript', content: 'export const authRequired = false;' }]);
    const result = await analyzeWithAi(base, options);
    assert.equal(result.assessments.find(item => item.criterion === 'security_boundaries')?.grade, 'D');
    assert.ok(result.findings.some(item => item.category === 'security'));
  } finally { globalThis.fetch = original; }
});

test('大项目全部文件逐片审查，项目代码也覆盖全部文件', async () => {
  const original = globalThis.fetch;
  const projectInputs: { totalFiles: number; codeParts: { path: string }[] }[] = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const user = String(request.messages[1].content);
    const data = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    if (user.startsWith('评估一个 <project>')) {
      projectInputs.push(data);
      return mockResponse(cleanProject());
    }
    return mockResponse((data as { path: string }[]).flatMap(file => cleanFile(file.path)));
  };
  try {
    const files = Array.from({ length: 20 }, (_, index) => source(`src/module_${index}.py`, `def item_${index}():\n    return ${index}\n` + '# sample\n'.repeat(150)));
    const result = await analyzeWithAi(analyze(files), { ...options, maxCharsPerRequest: 1000 });
    assert.equal(result.totalFiles, 20);
    assert.equal(result.reviewedFiles, 20);
    assert.equal(result.processedFiles, 20);
    assert.equal(result.processedChars, result.totalChars);
    assert.ok(result.fileRequests > files.length);
    assert.ok(projectInputs.every(input => input.totalFiles === 20));
    assert.deepEqual([...new Set(projectInputs.flatMap(input => input.codeParts.map(item => item.path)))].sort(), files.map(file => file.path).sort());
    assert.ok(JSON.stringify(projectInputs).includes('def item_19'));
    assert.equal(result.reviewedProject, false);
    assert.equal(result.assessments.find(item => item.criterion === 'dependency_direction')?.grade, 'U');
  } finally { globalThis.fetch = original; }
});

test('长文件中间行被实际送审，未展示行号仍降为 U', async () => {
  const original = globalThis.fetch;
  const file = source('large.py', Array.from({ length: 220 }, (_, index) => `value_${index} = ${index}`).join('\n'));
  const chunks = splitAiFile(file, 900);
  assert.ok(chunks.length > 1);
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(String(request.messages[1].content).split('\n\n').at(-1) ?? '[]');
    const visible = new Set(String(input[0].code).split('\n').map(line => Number(line.match(/^(\d+)/)?.[1])));
    const omitted = Array.from({ length: 220 }, (_, index) => index + 1).find(line => !visible.has(line));
    if (!omitted) throw new Error('测试分片必须有片段外行号');
    const assessments = cleanFile(file.path);
    assessments[assessments.findIndex(item => item.criterion === 'semantic_naming')] = { path: file.path, criterion: 'semantic_naming', grade: 'D', line: omitted,
      reason: `第 ${omitted} 行关键变量名称误导维护者理解实际职责。` } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([file], [], false), { ...options, maxCharsPerRequest: 900 }, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'U');
    assert.equal(result.reviewedFiles, 0);
    assert.equal(result.fileRequests, chunks.length);
  } finally { globalThis.fetch = original; }
});

test('任一代码分片请求失败时不把该文件标成完整审查', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 2) return new Response('rate limited', { status: 429 });
    return mockResponse(cleanFile('large.py'));
  };
  try {
    const file = source('large.py', 'value = 1\n'.repeat(150));
    const result = await analyzeWithAi(analyze([file], [], false), { ...options, maxCharsPerRequest: 500 }, false);
    assert.ok(result.fileRequests > 1);
    assert.equal(result.reviewedFiles, 0);
    assert.ok(result.processedChars < result.totalChars);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_duplication')?.grade, 'U');
    assert.ok(result.errors.some(error => error.includes('HTTP 429')));
  } finally { globalThis.fetch = original; }
});

test('同一文件跨片段缺陷只计最严重的一次，问题明细仍保留', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(String(request.messages[1].content).split('\n\n').at(-1) ?? '[]');
    const part = input[0].part as number;
    const line = Number(String(input[0].code).match(/^(\d+)/)?.[1]);
    const assessments = cleanFile('large.py');
    assessments[assessments.findIndex(item => item.criterion === 'semantic_duplication')] = { path: 'large.py', criterion: 'semantic_duplication', grade: part === 1 ? 'B' : 'D', line,
      reason: `第 ${line} 行重复了相同的赋值步骤，修改时需要在多处同步。` } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const file = source('large.py', 'value = 1\n'.repeat(110));
    const result = await analyzeWithAi(analyze([file], [], false), { ...options, maxCharsPerRequest: 500 }, false);
    assert.equal(result.reviewedFiles, 1);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_duplication')?.grade, 'D');
    assert.equal(result.findings.filter(item => item.rule === 'ai-semantic_duplication').length, result.fileRequests);
    assert.equal(result.findings.filter(item => item.rule === 'ai-semantic_duplication').reduce((sum, item) => sum + item.points, 0), 12);
  } finally { globalThis.fetch = original; }
});

test('短作用域临时名不会升为严重命名问题，未证明输入契约的边界建议记 U', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('small.py');
    const naming = assessments.findIndex(item => item.criterion === 'semantic_naming');
    const boundary = assessments.findIndex(item => item.criterion === 'boundary_safety');
    assessments[naming] = { path: 'small.py', criterion: 'semantic_naming', grade: 'C', line: 2,
      reason: '局部变量 temp 仅承接计算结果，名称较泛，需要回看赋值。' } as typeof assessments[number];
    assessments[boundary] = { path: 'small.py', criterion: 'boundary_safety', grade: 'C', line: 2,
      reason: '若传入 None 会抛出异常，但当前代码没有提供这类输入契约。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('small.py', 'def calc(values):\n    temp = sum(values)\n    return temp')], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'B');
    assert.equal(result.assessments.find(item => item.criterion === 'boundary_safety')?.grade, 'U');
  } finally { globalThis.fetch = original; }
});

test('AI 行号采用安全数字字符串或理由中的明确行号时仍可校验', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('small.py');
    const naming = assessments.findIndex(item => item.criterion === 'semantic_naming');
    assessments[naming] = { path: 'small.py', criterion: 'semantic_naming', grade: 'B', line: '2',
      reason: '第 2 行的局部变量 temp 略泛，但短函数上下文仍能辨认。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('small.py', 'def calc():\n    temp = 1\n    return temp')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'B');
  } finally { globalThis.fetch = original; }
});

test('AI 不对本地已确认的空值访问和空 catch 重复计分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('unsafe.ts');
    const boundary = assessments.findIndex(item => item.criterion === 'boundary_safety');
    const errors = assessments.findIndex(item => item.criterion === 'error_strategy');
    assessments[boundary] = { path: 'unsafe.ts', criterion: 'boundary_safety', grade: 'E', line: 1,
      reason: '第 1 行 null.value 必然抛出未预期异常，核心函数无法继续执行。' } as typeof assessments[number];
    assessments[errors] = { path: 'unsafe.ts', criterion: 'error_strategy', grade: 'D', line: 2,
      reason: '第 2 行 catch 块为空，异常被完全吞掉，没有可观察结果。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([{ path: 'unsafe.ts', language: 'TypeScript', content: 'null.value;\ntry {} catch (e) {}' }], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'boundary_safety')?.grade, 'U');
    assert.equal(result.assessments.find(item => item.criterion === 'error_strategy')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});
