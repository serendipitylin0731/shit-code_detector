const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { name, version } = require(path.join(root, 'package.json'));
const outputDir = path.join(root, 'artifacts');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `${name}-${version}.vsix`);
const result = spawnSync('vsce', ['package', '--no-dependencies', '--out', output], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
