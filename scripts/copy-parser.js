const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'dist', 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(require.resolve('typescript'), path.join(vendor, 'typescript.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'typescript', 'LICENSE.txt'), path.join(vendor, 'typescript-LICENSE.txt'));
fs.copyFileSync(path.join(root, 'src', 'python_check.py'), path.join(vendor, 'python_check.py'));
fs.copyFileSync(require.resolve('ignore'), path.join(vendor, 'ignore.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'ignore', 'LICENSE-MIT'), path.join(vendor, 'ignore-LICENSE.txt'));
fs.cpSync(path.join(root, 'node_modules', 'undici'), path.join(vendor, 'undici'), { recursive: true });
