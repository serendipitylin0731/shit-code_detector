const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { analyze, mergeAnalysis } = require('../dist/src/analysis.js');
const { analyzeWithAi } = require('../dist/src/ai.js');
const { formattedFinalScore } = require('../dist/src/scoreTransform.js');
const { qualityCases } = require('../dist/test/fixtures/quality.js');

async function main() {
  let local = {};
  try { local = JSON.parse(await readFile(path.resolve(__dirname, '..', 'ai.local.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('开发测试配置 ai.local.json 读取或解析失败。'); }
  const localKey = typeof local.apiKey === 'string' && local.apiKey !== 'YOUR_DEEPSEEK_API_KEY_HERE' ? local.apiKey.trim() : '';
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || localKey;
  if (!apiKey) throw new Error('请设置 DEEPSEEK_API_KEY，或填写本仓库开发测试用的 ai.local.json。');
  const selected = process.argv[2] ? qualityCases.filter(item => item.name === process.argv[2]) : qualityCases;
  if (!selected.length) throw new Error('样本名称只能是 good、medium 或 bad。');
  for (const item of selected) {
    const local = analyze(item.files);
    const ai = await analyzeWithAi(local, {
      baseUrl: process.env.DEEPSEEK_BASE_URL || local.baseUrl || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || local.model || 'deepseek-v4-flash',
      apiKey,
      maxFiles: 30,
      maxCharsPerFile: 12000
    });
    const total = mergeAnalysis(local, ai.findings);
    console.log(`${item.name}: 本地 ${formattedFinalScore(local.score)} / 9；最终 ${formattedFinalScore(total.score)} / 9；AI 条目记录 ${ai.assessments.length}（U ${ai.assessments.filter(entry => entry.grade === 'U').length}、校验排除 ${ai.assessments.filter(entry => entry.adjustedFrom).length}），完整审核文件 ${ai.reviewedFiles}/${item.files.length}`);
    for (const assessment of ai.assessments.filter(entry => entry.grade !== 'A')) console.log(`  ${assessment.grade} ${assessment.title} ${assessment.path}${assessment.line ? `:${assessment.line}` : ''} ${assessment.reason}`);
    for (const error of ai.errors) console.log(`  AI 未完成：${error}`);
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
