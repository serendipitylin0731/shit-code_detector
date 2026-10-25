export type ScanScope = 'workspace' | 'files' | 'repository';
export type ScanStage = 'discovery' | 'read' | 'local' | 'baseline' | 'aiFiles' | 'aiProject' | 'report';

/** Shares one 0–100 scale across stages. Percentages describe completed work, not elapsed time. */
export class ScanProgress {
  private readonly ranges: Partial<Record<ScanStage, readonly [number, number]>>;
  private current = 0;

  constructor(scope: ScanScope, aiEnabled: boolean) {
    const baseline = scope === 'workspace';
    const projectAi = aiEnabled && scope !== 'files';
    const localEnd = aiEnabled ? baseline ? 40 : 45 : baseline ? 90 : 95;
    this.ranges = {
      discovery: [0, 10], read: [10, 25], local: [25, localEnd], report: [95, 100],
      ...(baseline ? { baseline: [localEnd, aiEnabled ? 45 : 95] as const } : {}),
      ...(aiEnabled ? { aiFiles: [45, projectAi ? 85 : 95] as const } : {}),
      ...(projectAi ? { aiProject: [85, 95] as const } : {})
    };
  }

  /** Unknown-duration stages keep the previous completed percentage. */
  stage(stage: ScanStage, completed?: number, total?: number): number {
    const range = this.ranges[stage];
    if (!range) return this.current;
    const fraction = total !== undefined && total > 0 && completed !== undefined
      ? Math.max(0, Math.min(1, completed / total)) : 0;
    this.current = Math.max(this.current, Math.min(99, range[0] + (range[1] - range[0]) * fraction));
    return this.current;
  }

  complete(): number { this.current = 100; return this.current; }
}
