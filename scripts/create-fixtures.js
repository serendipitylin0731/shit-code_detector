const fs = require('node:fs');
const path = require('node:path');
const { qualityCases } = require('../dist/test/fixtures/quality.js');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'quality-fixtures');
for (const item of qualityCases) {
  for (const file of item.files) {
    const target = path.join(output, item.name, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content + '\n');
  }
}
fs.rmSync(path.join(root, 'artifacts', 'quality-fixtures.code-workspace'), { force: true });
console.log(`已生成 ${output}；请分别打开 good、medium、bad 根目录评分。`);
