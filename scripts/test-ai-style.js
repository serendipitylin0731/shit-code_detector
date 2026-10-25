const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { analyze } = require('../dist/src/analysis.js');
const { analyzeWithAi } = require('../dist/src/ai.js');

const samples = [
  { path: 'main.cpp', language: 'C++', content: `int dispatch(const std::string& command) {
    if (command == "start") return start();
    else if (command == "stop") return stop();
    else if (command == "restart") return restart();
    else if (command == "status") return status();
    else if (command == "update") return update();
    else if (command == "help") return help();
    return unknownCommand();
}` },
  { path: 'status.ts', language: 'TypeScript', content: `export async function status(repo: Repo): Promise<string> {
  const branch = await repo.currentBranch();
  const changes = await repo.changedFiles();
  const commits = await repo.recentCommits();
  return formatStatus(branch, changes, commits);
}` },
  { path: 'branches.ts', language: 'TypeScript', content: `export function process(a: boolean, b: boolean): void {
  if (a) {
    check();
    processA();
  }
  if (b) {
    check();
    processB();
  }
}` },
  { path: 'interfaceForwarder.ts', language: 'TypeScript', content: `export interface SearchService {
  search(query: string): Promise<string[]>;
}
export function search(service: SearchService, query: string): Promise<string[]> {
  return service.search(query);
}` },
  { path: 'unifiedForwarder.ts', language: 'TypeScript', content: `export class Api {
  constructor(private readonly client: Client) {}
  get(id: string) { return this.client.get(id); }
  save(value: Value) { return this.client.save(value); }
  remove(id: string) { return this.client.remove(id); }
}` },
  { path: 'overAbstracted.ts', language: 'TypeScript', content: `function userName(user: User): string { return user.name; }
function upper(value: string): string { return value.toUpperCase(); }
function upperUserName(user: User): string { return upper(userName(user)); }
export function displayName(user: User): string { return upperUserName(user); }` }
];

async function main() {
  let local = {};
  try { local = JSON.parse(await readFile(path.resolve(__dirname, '..', 'ai.local.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('开发测试配置读取失败。'); }
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || (typeof local.apiKey === 'string' ? local.apiKey.trim() : '');
  if (!apiKey || apiKey === 'YOUR_DEEPSEEK_API_KEY_HERE') throw new Error('请设置 DEEPSEEK_API_KEY 或本地 ai.local.json。');
  const ai = await analyzeWithAi(analyze(samples, [], false), {
    baseUrl: process.env.DEEPSEEK_BASE_URL || local.baseUrl || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || local.model || 'deepseek-flash',
    apiKey,
    maxCharsPerRequest: 12000
  }, false);
  const watch = {
    'main.cpp': ['control_flow_clarity', 'abstraction_fit'],
    'status.ts': ['function_cohesion', 'abstraction_fit', 'local_comprehensibility'],
    'branches.ts': ['semantic_duplication', 'abstraction_fit'],
    'interfaceForwarder.ts': ['abstraction_fit', 'expression_simplicity', 'local_comprehensibility'],
    'unifiedForwarder.ts': ['semantic_duplication', 'abstraction_fit', 'expression_simplicity', 'local_comprehensibility'],
    'overAbstracted.ts': ['abstraction_fit', 'local_comprehensibility']
  };
  for (const [file, ids] of Object.entries(watch)) {
    console.log(file);
    for (const id of ids) {
      const item = ai.assessments.find(entry => entry.path === file && entry.criterion === id);
      console.log(`  ${id}: ${item?.grade ?? 'MISSING'} ${item?.reason ?? ''}`);
      if (!item) process.exitCode = 1;
      const protectedCase = ['interfaceForwarder.ts', 'unifiedForwarder.ts'].includes(file) || (file === 'branches.ts' && id === 'semantic_duplication');
      if (protectedCase && ['B', 'C', 'D', 'E'].includes(item?.grade)) process.exitCode = 1;
      else if (file !== 'overAbstracted.ts' && ['C', 'D', 'E'].includes(item?.grade)) process.exitCode = 1;
    }
  }
  const bad = ai.assessments.filter(item => item.path === 'overAbstracted.ts' &&
    watch['overAbstracted.ts'].includes(item.criterion) && ['B', 'C', 'D', 'E'].includes(item.grade));
  if (!bad.length) process.exitCode = 1;
  if (ai.errors.length || ai.processedFiles !== ai.totalFiles || ai.processedChars !== ai.totalChars) process.exitCode = 1;
  console.log(`AI 响应 ${ai.processedFiles}/${ai.totalFiles} 文件、${ai.processedChars}/${ai.totalChars} 字符，错误 ${ai.errors.length}`);
  for (const error of ai.errors) console.log(error);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
