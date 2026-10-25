import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Analysis, CodeFile } from './analysis';

/** Run parser and project checks away from the VS Code extension host. */
export function analyzeInWorker(files: CodeFile[], projectMode: boolean, signal?: AbortSignal,
  onProgress?: (completed: number, total: number, phase: 'files' | 'finalize') => void): Promise<Analysis> {
  if (signal?.aborted) return Promise.reject(new Error('评分已取消'));
  const worker = new Worker(path.join(__dirname, 'analysisWorker.js'), { workerData: { files, projectMode } });
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = (): void => { signal?.removeEventListener('abort', onAbort); };
    const settle = (error?: Error, result?: Analysis): void => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = (): void => { void worker.terminate(); settle(new Error('评分已取消')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (message: { type: 'progress'; completed: number; total: number; phase: 'files' | 'finalize' } |
      { type: 'result'; ok: boolean; result?: Omit<Analysis, 'files'>; error?: string }) => {
      if (finished) return;
      if (message.type === 'progress') { onProgress?.(message.completed, message.total, message.phase); return; }
      if (!message.ok || !message.result) { settle(new Error(message.error ?? '评分工作线程没有返回结果')); return; }
      settle(undefined, { ...message.result, files });
    });
    worker.once('error', error => settle(error));
    worker.once('exit', code => settle(new Error(`评分工作线程在返回结果前退出：${code}`)));
  });
}
