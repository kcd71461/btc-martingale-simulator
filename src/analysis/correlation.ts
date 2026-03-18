export interface TimeValue {
  ts: number;
  value: number;
}

export interface CorrelationResult {
  lag: number;
  correlation: number | null;
}

export function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  return num / den;
}

export function crossCorrelation(
  seriesA: TimeValue[],
  seriesB: TimeValue[],
  lagRangeMs: number,
  stepMs: number,
): CorrelationResult[] {
  const results: CorrelationResult[] = [];

  for (let lag = -lagRangeMs; lag <= lagRangeMs; lag += stepMs) {
    const shiftedB = seriesB.map(p => ({ ts: p.ts + lag, value: p.value }));

    const minTs = Math.max(
      seriesA[0]?.ts ?? Infinity,
      shiftedB[0]?.ts ?? Infinity,
    );
    const maxTs = Math.min(
      seriesA[seriesA.length - 1]?.ts ?? -Infinity,
      shiftedB[shiftedB.length - 1]?.ts ?? -Infinity,
    );

    if (minTs >= maxTs) {
      results.push({ lag, correlation: null });
      continue;
    }

    const binSize = stepMs;
    const alignedA: number[] = [];
    const alignedB: number[] = [];

    let idxA = 0, idxB = 0;
    for (let t = minTs; t <= maxTs; t += binSize) {
      while (idxA < seriesA.length - 1 && seriesA[idxA + 1].ts <= t) idxA++;
      while (idxB < shiftedB.length - 1 && shiftedB[idxB + 1].ts <= t) idxB++;

      if (seriesA[idxA].ts <= t && shiftedB[idxB].ts <= t) {
        alignedA.push(seriesA[idxA].value);
        alignedB.push(shiftedB[idxB].value);
      }
    }

    results.push({ lag, correlation: pearsonCorrelation(alignedA, alignedB) });
  }

  return results;
}
