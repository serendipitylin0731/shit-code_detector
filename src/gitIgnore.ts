import type ignore from 'ignore';

const createIgnore = require('../vendor/ignore') as typeof ignore;
type Rules = ignore.Ignore;

/** Applies root and nested .gitignore files with Git's parent-directory rule. */
export class GitIgnoreMatcher {
  private readonly cache = new Map<string, Promise<Rules | undefined>>();

  constructor(private readonly readIgnore: (directory: string) => Promise<string | undefined>) {}

  async isIgnored(relativePath: string, directory = false): Promise<boolean> {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return false;
    const parts = normalized.split('/');
    for (let index = 1; index < parts.length; index++) {
      if (await this.evaluate(parts.slice(0, index).join('/') + '/')) return true;
    }
    return this.evaluate(normalized + (directory ? '/' : ''));
  }

  private async evaluate(target: string): Promise<boolean> {
    const parts = target.replace(/\/$/, '').split('/');
    const parentCount = parts.length - 1;
    let ignored = false;
    for (let index = 0; index <= parentCount; index++) {
      const scope = parts.slice(0, index).join('/');
      const rules = await this.rulesFor(scope);
      if (!rules) continue;
      const relative = parts.slice(index).join('/') + (target.endsWith('/') ? '/' : '');
      const result = rules.test(relative);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }

  private rulesFor(directory: string): Promise<Rules | undefined> {
    let existing = this.cache.get(directory);
    if (!existing) {
      existing = this.readIgnore(directory).then(contents => contents === undefined ? undefined : createIgnore().add(contents));
      this.cache.set(directory, existing);
    }
    return existing;
  }
}
