const path = require('node:path');
const { analyze } = require('../dist/src/analysis.js');
const { analyzeWithAi } = require('../dist/src/ai.js');
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
    const total = analyze(item.files, ai.findings);
    console.log(`${item.name}: 本地 ${local.score} + AI ${total.score - local.score} = ${total.score}；AI 问题 ${ai.findings.length} 条，审核文件 ${ai.reviewedFiles}/${item.files.length}`);
    for (const finding of ai.findings) console.log(`  +${finding.points} ${finding.category} ${finding.path}${finding.line ? `:${finding.line}` : ''} ${finding.message}`);
    for (const error of ai.errors) console.log(`  AI 未完成：${error}`);
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
