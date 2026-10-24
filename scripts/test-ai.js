const path = require('node:path');
const { analyze, mergeAnalysis } = require('../dist/src/analysis.js');
const { analyzeWithAi } = require('../dist/src/ai.js');
const { formattedFinalScore } = require('../dist/src/scoreTransform.js');
const { readLocalAiConfig } = require('../dist/src/localConfig.js');
const { qualityCases } = require('../dist/test/fixtures/quality.js');

async function main() {
  const config = await readLocalAiConfig(path.resolve(__dirname, '..'));
  if (!config.enabled || !config.apiKey) {
    throw new Error('请先在仓库根目录 ai.local.json 中填写 apiKey，并设置 enabled 为 true。');
  }
  const selected = process.argv[2] ? qualityCases.filter(item => item.name === process.argv[2]) : qualityCases;
  if (!selected.length) throw new Error('样本名称只能是 good、medium 或 bad。');
  for (const item of selected) {
    const local = analyze(item.files);
    const ai = await analyzeWithAi(local, {
      baseUrl: config.baseUrl || 'https://api.deepseek.com',
      model: config.model || 'deepseek-v4-flash',
      apiKey: config.apiKey,
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
