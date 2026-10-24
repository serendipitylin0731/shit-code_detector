import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LocalAiConfig {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export const localConfigName = 'ai.local.json';

export function parseLocalAiConfig(raw: string): LocalAiConfig {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('ai.local.json 格式无效，请检查 JSON 语法。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ai.local.json 必须是 JSON 对象。');
  const input = value as Record<string, unknown>;
  const output: LocalAiConfig = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new Error('ai.local.json 的 enabled 必须是布尔值。');
    output.enabled = input.enabled;
  }
  for (const key of ['baseUrl', 'model', 'apiKey'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error(`ai.local.json 的 ${key} 必须是字符串。`);
      output[key] = input[key].trim();
    }
  }
  if (output.apiKey === 'YOUR_DEEPSEEK_API_KEY_HERE') output.apiKey = undefined;
  return output;
}

export async function readLocalAiConfig(workspacePath?: string): Promise<LocalAiConfig> {
  if (!workspacePath) return {};
  try {
    return parseLocalAiConfig(await readFile(path.join(workspacePath, localConfigName), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
