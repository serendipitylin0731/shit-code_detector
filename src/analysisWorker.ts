import { parentPort, workerData } from 'node:worker_threads';
import { analyze, CodeFile } from './analysis';

const input = workerData as { files: CodeFile[]; projectMode: boolean };
try {
  let lastPosted = 0;
  const result = analyze(input.files, [], input.projectMode, (completed, total, phase) => {
    const now = Date.now();
    if (phase === 'finalize' || completed === total || completed === 1 || now - lastPosted >= 100) {
      parentPort!.postMessage({ type: 'progress', completed, total, phase });
      lastPosted = now;
    }
  });
  // The extension already owns the code text; return only results to limit copies.
  parentPort!.postMessage({ type: 'result', ok: true, result: { ...result, files: undefined } });
} catch (error) {
  parentPort!.postMessage({ type: 'result', ok: false, error: error instanceof Error ? error.message : String(error) });
}
