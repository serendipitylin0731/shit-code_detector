/** Transform the nonnegative, unbounded raw penalty into the displayed score. */
export function finalScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore < 0) throw new RangeError('原始分必须是非负有限数');
  if (rawScore === 0) return 0;
  // This algebraic form avoids overflowing rawScore ** 3 for large projects.
  return 9 / (1 + 64000 / (rawScore * rawScore * rawScore));
}

export function formattedFinalScore(rawScore: number): string {
  const score = finalScore(rawScore);
  return score > 0 && score < 0.001 ? score.toFixed(6) : score.toFixed(3);
}
