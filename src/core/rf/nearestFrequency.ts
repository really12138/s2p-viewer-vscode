export function nearestFrequencyIndex(
  frequencies: readonly number[],
  targetHz: number,
): number | undefined {
  if (frequencies.length === 0) return undefined;
  if (targetHz <= frequencies[0]!) return 0;
  const lastIndex = frequencies.length - 1;
  if (targetHz >= frequencies[lastIndex]!) return lastIndex;

  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frequencies[middle]! <= targetHz) low = middle;
    else high = middle;
  }

  const lowDistance = targetHz - frequencies[low]!;
  const highDistance = frequencies[high]! - targetHz;
  return lowDistance <= highDistance ? low : high;
}
