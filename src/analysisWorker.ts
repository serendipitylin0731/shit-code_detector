import { parentPort, workerData } from 'node:worker_threads';
import { analyze, CodeFile } from './analysis';

const input = workerData as { files: CodeFile[]; projectMode: boolean };
try {
  const result = analyze(input.files, [], input.projectMode);
  // The extension already owns the code text; return only results to limit copies.
  parentPort!.postMessage({ ok: true, result: { ...result, files: undefined } });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
