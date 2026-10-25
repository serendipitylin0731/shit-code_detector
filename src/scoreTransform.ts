/** Transform the nonnegative, unbounded raw penalty into the displayed score. */
export function finalScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore < 0) throw new RangeError('原始分必须是非负有限数');
  const x = rawScore;
  if (x < 0.1) return x;
  if (x < 45) {
    const u = (x - 0.1) / 44.9;
    return 0.1 + (20319 * u ** 2 - 12199 * u ** 3) / 2800;
  }
  if (x < 150) return 3 + 9 * (x - 45) / 280 - (x - 45) ** 2 / 29400;
  if (x < 250) return 6 + (x - 150) / 40 - (x - 150) ** 2 / 20000;
  return 9 - Math.exp(-3 * (x - 250) / 200);
}

export const SCORE_FORMULA = 'x<0.1: x; 0.1<=x<45: 0.1+(20319u²-12199u³)/2800, u=(x-0.1)/44.9; 45<=x<150: 3+9(x-45)/280-(x-45)²/29400; 150<=x<250: 6+(x-150)/40-(x-150)²/20000; x>=250: 9-exp(-3(x-250)/200)';

export function formattedFinalScore(rawScore: number): string {
  const score = finalScore(rawScore);
  return score > 0 && score < 0.001 ? score.toFixed(6) : score.toFixed(3);
}
