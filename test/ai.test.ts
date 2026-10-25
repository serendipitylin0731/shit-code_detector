import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, CodeFile } from '../src/analysis';
import { analyzeWithAi, planAiRequests } from '../src/ai';
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
  assert.ok(['logic_correctness', 'readability_flow', 'documentation_contract', 'boundary_safety', 'resource_lifecycle',
    'performance_risk', 'state_consistency', 'security_boundaries'].every(id => !AI_CRITERIA.some(item => item.id === id)));
  assert.ok(AI_CRITERIA.every(item => !['correctness', 'security'].includes(item.category)));
  assert.ok(AI_CRITERIA.every(item => item.weight > 0 && ['A', 'B', 'C', 'D', 'E'].every(grade => item.anchors[grade as keyof typeof item.anchors])));
  assert.equal(AI_CRITERIA.find(item => item.id === 'abstraction_fit')?.weight, 3);
  assert.equal(AI_CRITERIA.find(item => item.id === 'local_comprehensibility')?.weight, 3);
  assert.ok(!AI_CRITERIA.some(item => item.id === 'testability' || item.id === 'complexity_fit'));
});

test('清晰长分支、局部重复和同一目的的多个步骤不被机械扣分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('style.ts');
    const edits = [
      { criterion: 'control_flow_clarity', reason: '第 1 行使用长 if-else 分支，缺少映射表来分发命令。' },
      { criterion: 'semantic_duplication', reason: '第 2 行和第 3 行都调用 check()，因此存在重复。' },
      { criterion: 'function_cohesion', reason: '第 1 行的函数先收集状态再格式化输出，包含多个步骤。' }
    ];
    for (const edit of edits) {
      const index = assessments.findIndex(item => item.criterion === edit.criterion);
      assessments[index] = { path: 'style.ts', criterion: edit.criterion, grade: 'C', line: edit.criterion === 'semantic_duplication' ? 2 : 1,
        reason: edit.reason } as typeof assessments[number];
    }
    return mockResponse(assessments);
  };
  try {
    const base = analyze([{ path: 'style.ts', language: 'TypeScript', content: 'function status() {\n  check();\n  check();\n}' }], [], false);
    const result = await analyzeWithAi(base, options, false);
    for (const criterion of ['control_flow_clarity', 'semantic_duplication', 'function_cohesion']) {
      assert.equal(result.assessments.find(item => item.criterion === criterion)?.grade, 'U');
    }
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('接口封装与统一转发不能按多余包装或跳转计分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('api.ts');
    for (const [criterion, reason] of [
      ['abstraction_fit', '第 1 行 forward 是公共接口封装，仅转发 client.invoke，多出一层抽象。'],
      ['expression_simplicity', '第 1 行 forward 只是统一转发入口，包装一次调用显得多余。'],
      ['local_comprehensibility', '第 1 行 forward 作为接口需要跳转到实现，因此局部不够清楚。']
    ]) {
      assessments[assessments.findIndex(item => item.criterion === criterion)] =
        { path: 'api.ts', criterion, grade: 'C', line: 1, reason } as typeof assessments[number];
    }
    return mockResponse(assessments);
  };
  try {
    const code = 'export function forward(client: Client, value: string) {\n  return client.invoke(value);\n}';
    const result = await analyzeWithAi(analyze([{ path: 'api.ts', language: 'TypeScript', content: code }], [], false), options, false);
    for (const id of ['abstraction_fit', 'expression_simplicity', 'local_comprehensibility']) {
      assert.equal(result.assessments.find(item => item.criterion === id)?.grade, 'U');
    }
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('提到公共入口时仍可识别无职责的多层私有调用链', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('chain.ts');
    assessments[assessments.findIndex(item => item.criterion === 'abstraction_fit')] = {
      path: 'chain.ts', criterion: 'abstraction_fit', grade: 'C', line: 4,
      reason: '第 4 行公共入口后接三层无职责的私有辅助函数，读者须在这些函数间跳转才能看懂简单的名称转换。'
    } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const code = 'function name(user: User) { return user.name; }\nfunction upper(value: string) { return value.toUpperCase(); }\nfunction upperName(user: User) { return upper(name(user)); }\nexport function display(user: User) { return upperName(user); }';
    const result = await analyzeWithAi(analyze([{ path: 'chain.ts', language: 'TypeScript', content: code }], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'abstraction_fit')?.grade, 'C');
  } finally { globalThis.fetch = original; }
});

test('三次单行调用仍属于小重复，不计入 AI 分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('calls.py');
    assessments[assessments.findIndex(item => item.criterion === 'semantic_duplication')] = {
      path: 'calls.py', criterion: 'semantic_duplication', grade: 'C', line: 2,
      reason: '第 2、8、14 行三处重复调用 check()，修改时需要同步。',
      issues: [2, 8, 14].map(line => ({ line, reason: `第 ${line} 行重复调用 check()，需要同步维护。` }))
    } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const lines = Array.from({ length: 20 }, (_, index) => [1, 7, 13].includes(index) ? 'check()' : `value_${index} = ${index}`);
    const result = await analyzeWithAi(analyze([source('calls.py', lines.join('\n'))], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_duplication')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('约定的空值或正常抛错不能凭缺少本地恢复流程扣分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('safe.py');
    assessments[assessments.findIndex(item => item.criterion === 'error_strategy')] = { path: 'safe.py', criterion: 'error_strategy', grade: 'C', line: 2,
      reason: '第 2 行直接抛出异常，没有在当前函数捕获并恢复。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('safe.py', 'def run():\n    raise ValueError()')], [], false), options, false);
    assert.ok(!result.assessments.some(item => item.criterion === 'boundary_safety'));
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
    assert.deepEqual(result.findings.map(item => item.points), [4]);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.basePoints, 4);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.weight, 1);
  } finally { globalThis.fetch = original; }
});

test('范围外、缺失、重复和机械问题不会被当作有效 AI 分项', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('main.py').filter(item => item.criterion !== 'control_flow_clarity');
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
    assert.equal(result.assessments.find(item => item.criterion === 'control_flow_clarity')?.grade, 'U');
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
    assessments[assessments.findIndex(item => item.criterion === 'semantic_naming')] = { path: 'sample.py', criterion: 'semantic_naming', grade: 'D', line: 99,
      reason: '第 99 行的主要变量名称与其用途不符，阅读时需要反复确认。' } as typeof assessments[number];
    assessments[assessments.findIndex(item => item.criterion === 'semantic_duplication')] = { path: 'sample.py', criterion: 'semantic_duplication', grade: 'N/A', reason: '片段没有重复结构。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('sample.py')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'U');
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_duplication')?.grade, 'N/A');
    assert.equal(result.reviewedFiles, 0);
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('同一 AI 条目的独立问题逐条显示，但权重只计算一次', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('sample.py');
    assessments[assessments.findIndex(item => item.criterion === 'semantic_duplication')] = { path: 'sample.py', criterion: 'semantic_duplication', grade: 'D', line: 1,
      reason: '第 1、7、13 行三处反复实现相同的六步转换逻辑，统一处理能减轻维护负担。',
      issues: [{ line: 1, reason: '第 1 行开始第一组六步转换，需要同步维护。' },
        { line: 7, reason: '第 7 行开始第二组六步转换，修改时存在分叉风险。' },
        { line: 13, reason: '第 13 行开始第三组六步转换，修改时存在分叉风险。' }] } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const block = (prefix: string) => [`${prefix}1 = load_${prefix}()`, `${prefix}2 = normalize(${prefix}1)`,
      `${prefix}3 = validate(${prefix}2)`, `${prefix}4 = render(${prefix}3)`, `${prefix}5 = publish(${prefix}4)`,
      `${prefix}6 = record(${prefix}5)`].join('\n');
    const base = analyze([source('sample.py', [block('a'), block('b'), block('c')].join('\n'))], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.findings.length, 3);
    assert.equal(result.findings.reduce((sum, item) => sum + item.points, 0), 6);
    assert.deepEqual(result.findings.map(item => item.aiGrade), ['D', 'D', 'D']);
  } finally { globalThis.fetch = original; }
});

test('项目级评分只接受结构风格，不接受安全问题条目', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (!String(request.messages?.[1]?.content).startsWith('评估一个 <project>')) return mockResponse(cleanFile('config.ts'));
    const assessments = cleanProject();
    assessments.push({ path: '<project>', criterion: 'security_boundaries', grade: 'D',
      reason: 'config.ts 第 1 行全局禁用认证，所有路由均可被未授权访问敏感数据。', evidencePaths: ['config.ts'] } as typeof assessments[number]);
    return mockResponse(assessments);
  };
  try {
    const base = analyze([{ path: 'config.ts', language: 'TypeScript', content: 'export const authRequired = false;' }]);
    const result = await analyzeWithAi(base, options);
    assert.ok(!result.assessments.some(item => item.criterion === 'security_boundaries'));
    assert.equal(result.findings.length, 0);
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
    assert.deepEqual(await planAiRequests(files, 1000, true), { fileRequests: result.fileRequests, projectRequests: result.projectRequests });
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
    assessments[assessments.findIndex(item => item.criterion === 'semantic_naming')] = { path: 'large.py', criterion: 'semantic_naming', grade: part === 1 ? 'B' : 'D', line,
      reason: `第 ${line} 行关键名称含糊，读者需要反复确认该值的职责。` } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const file = source('large.py', 'value = 1\n'.repeat(110));
    const result = await analyzeWithAi(analyze([file], [], false), { ...options, maxCharsPerRequest: 500 }, false);
    assert.equal(result.reviewedFiles, 1);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'D');
    assert.equal(result.findings.filter(item => item.rule === 'ai-semantic_naming').length, result.fileRequests);
    assert.equal(result.findings.filter(item => item.rule === 'ai-semantic_naming').reduce((sum, item) => sum + item.points, 0), 6);
  } finally { globalThis.fetch = original; }
});

test('短作用域临时名不会升为严重命名问题，正确性建议不进入固定评分表', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('small.py');
    const naming = assessments.findIndex(item => item.criterion === 'semantic_naming');
    assessments[naming] = { path: 'small.py', criterion: 'semantic_naming', grade: 'C', line: 2,
      reason: '局部变量 temp 仅承接计算结果，名称较泛，需要回看赋值。' } as typeof assessments[number];
    assessments.push({ path: 'small.py', criterion: 'boundary_safety', grade: 'C', line: 2,
      reason: '若传入 None 会抛出异常，但当前代码没有提供这类输入契约。' } as typeof assessments[number]);
    return mockResponse(assessments);
  };
  try {
    const base = analyze([source('small.py', 'def calc(values):\n    temp = sum(values)\n    return temp')], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'B');
    assert.ok(!result.assessments.some(item => item.criterion === 'boundary_safety'));
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

test('AI 不对本地空 catch 重复计分，也不接纳正确性问题', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('unsafe.ts');
    const errors = assessments.findIndex(item => item.criterion === 'error_strategy');
    assessments.push({ path: 'unsafe.ts', criterion: 'boundary_safety', grade: 'E', line: 1,
      reason: '第 1 行 null.value 必然抛出未预期异常，核心函数无法继续执行。' } as typeof assessments[number]);
    assessments[errors] = { path: 'unsafe.ts', criterion: 'error_strategy', grade: 'D', line: 2,
      reason: '第 2 行 catch 块为空，异常被完全吞掉，没有可观察结果。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const base = analyze([{ path: 'unsafe.ts', language: 'TypeScript', content: 'null.value;\ntry {} catch (e) {}' }], [], false);
    const result = await analyzeWithAi(base, options, false);
    assert.ok(!result.assessments.some(item => item.criterion === 'boundary_safety'));
    assert.equal(result.assessments.find(item => item.criterion === 'error_strategy')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('AI 即使把安全问题塞进风格条目也不计分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('sample.py');
    const index = assessments.findIndex(item => item.criterion === 'semantic_naming');
    assessments[index] = { path: 'sample.py', criterion: 'semantic_naming', grade: 'E', line: 1,
      reason: '第 1 行存在注入漏洞，访问未经授权的数据，属于安全风险。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('sample.py')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'semantic_naming')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('单一职责的重复语句不能作为函数职责混杂计分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('repeat.py');
    const index = assessments.findIndex(item => item.criterion === 'function_cohesion');
    assessments[index] = { path: 'repeat.py', criterion: 'function_cohesion', grade: 'D', line: 2,
      reason: '第 2 行开始重复同一赋值语句数百次，函数缺少可辨认的步骤。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('repeat.py', 'def run():\n    value = 1')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});

test('函数名不贴切只能进入命名条目，不能作为函数内聚重复计分', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const assessments = cleanFile('single.py');
    const index = assessments.findIndex(item => item.criterion === 'function_cohesion');
    assessments[index] = { path: 'single.py', criterion: 'function_cohesion', grade: 'B', line: 1,
      reason: '函数仅做简单加法，主职责单一，但函数名 save 与计算行为不符。' } as typeof assessments[number];
    return mockResponse(assessments);
  };
  try {
    const result = await analyzeWithAi(analyze([source('single.py', 'def save():\n    return 1 + 2')], [], false), options, false);
    assert.equal(result.assessments.find(item => item.criterion === 'function_cohesion')?.grade, 'U');
    assert.equal(result.findings.length, 0);
  } finally { globalThis.fetch = original; }
});
