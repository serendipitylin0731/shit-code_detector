import assert from 'node:assert/strict';
import test from 'node:test';
import { GitIgnoreMatcher } from '../src/gitIgnore';

test('根目录与子目录 .gitignore 的排除和否定规则生效', async () => {
  const contents = new Map([
    ['', '*.log\n!keep.log\nbuild/\nsrc/*.tmp\n'],
    ['src', '!keep.tmp\nignored.py\n'],
    ['build', '!keep.py\n']
  ]);
  const matcher = new GitIgnoreMatcher(async directory => contents.get(directory));
  assert.equal(await matcher.isIgnored('errors.log'), true);
  assert.equal(await matcher.isIgnored('keep.log'), false);
  assert.equal(await matcher.isIgnored('src/a.tmp'), true);
  assert.equal(await matcher.isIgnored('src/keep.tmp'), false);
  assert.equal(await matcher.isIgnored('src/ignored.py'), true);
  assert.equal(await matcher.isIgnored('build/keep.py'), true, '忽略的父目录不能由子目录规则重新纳入');
});
