export function removeOutliers(values: number[]): { kept: number[]; removed: number[] } {
  if (values.length < 4) {
    return { kept: [...values], removed: [] };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;

  const kept = sorted.filter((value) => value >= low && value <= high);
  const removed = sorted.filter((value) => value < low || value > high);

  return { kept, removed };
}
