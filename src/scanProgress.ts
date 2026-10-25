export type ScanScope = 'workspace' | 'files' | 'repository';
export type ScanStage = 'discovery' | 'read' | 'local' | 'baseline' | 'aiFiles' | 'aiProject' | 'report';

/** Reading owns 0–10%; each subsequent file or AI request owns an equal share of 10–100%. */
export class ScanProgress {
  private current = 0;
  private localCount = 0;
  private aiFileCount = 0;
  private aiProjectCount = 0;

  configure(localFiles: number, aiFileRequests = 0, aiProjectRequests = 0): void {
    if (![localFiles, aiFileRequests, aiProjectRequests].every(value => Number.isSafeInteger(value) && value >= 0) || localFiles < 1) {
      throw new Error('评分进度需要有效的任务数量。');
    }
    this.localCount = localFiles;
    this.aiFileCount = aiFileRequests;
    this.aiProjectCount = aiProjectRequests;
  }

  /** Unknown-duration stages keep the previous completed percentage. */
  stage(stage: ScanStage, completed?: number, total?: number): number {
    if (stage === 'discovery' || stage === 'baseline' || stage === 'report') return this.current;
    const fraction = total !== undefined && total > 0 && completed !== undefined
      ? Math.max(0, Math.min(1, completed / total)) : 0;
    if (stage === 'read') this.current = Math.max(this.current, 10 * fraction);
    else {
      const work = this.localCount + this.aiFileCount + this.aiProjectCount;
      if (!work) return this.current;
      const before = stage === 'local' ? 0 : stage === 'aiFiles' ? this.localCount : this.localCount + this.aiFileCount;
      const count = stage === 'local' ? this.localCount : stage === 'aiFiles' ? this.aiFileCount : this.aiProjectCount;
      this.current = Math.max(this.current, 10 + 90 * (before + count * fraction) / work);
    }
    return this.current;
  }

  complete(): number { this.current = 100; return this.current; }
}
