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
const workspace = {
  folders: qualityCases.map(item => ({ name: item.name, path: `quality-fixtures/${item.name}` }))
};
fs.writeFileSync(path.join(root, 'artifacts', 'quality-fixtures.code-workspace'), JSON.stringify(workspace, null, 2) + '\n');
console.log(`已生成 ${output} 和多根工作区文件。`);
