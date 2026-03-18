import { describe, it, expect } from 'vitest';
import { crossCorrelation, pearsonCorrelation } from '../src/analysis/correlation.js';

describe('pearsonCorrelation', () => {
  it('returns 1 for perfectly correlated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for perfectly inversely correlated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for uncorrelated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [5, 5, 5, 5, 5]);
    expect(r).toBeCloseTo(0, 5);
  });

  it('returns null for arrays shorter than 3', () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
  });
});

describe('crossCorrelation', () => {
  it('computes correlation at each lag', () => {
    const tsA = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const valA = [1, 3, 2, 5, 4, 7, 3, 8, 2, 6];
    const tsB = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    const valB = [1, 3, 2, 5, 4, 7, 3, 8, 2, 6];

    const result = crossCorrelation(
      tsA.map((t, i) => ({ ts: t, value: valA[i] })),
      tsB.map((t, i) => ({ ts: t, value: valB[i] })),
      500, 100,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('lag');
    expect(result[0]).toHaveProperty('correlation');
    const peak = result.reduce((a, b) =>
      (b.correlation !== null && (a.correlation === null || b.correlation > a.correlation)) ? b : a
    );
    expect(peak.lag).toBe(-100);
  });
});
