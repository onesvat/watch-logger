import { describe, expect, it } from 'vitest';
import { linearFit, pairRates, segments } from '../src/stats';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 1);

describe('linearFit', () => {
  it('recovers a known rate', () => {
    const s = [0, 1, 2, 3, 5].map((d) => ({ tTrue: t0 + d * DAY, drift: -3 + 1.8 * d }));
    const f = linearFit(s)!;
    expect(f.rate).toBeCloseTo(1.8, 9);
    expect(f.intercept).toBeCloseTo(-3, 9);
    expect(f.residualStd).toBeCloseTo(0, 9);
    expect(f.spanDays).toBe(5);
  });
  it('single point → null', () => expect(linearFit([{ tTrue: t0, drift: 1 }])).toBeNull());
});

describe('segments', () => {
  it('reset starts a new series', () => {
    const s = [
      { tTrue: t0, drift: 0 },
      { tTrue: t0 + DAY, drift: 2 },
      { tTrue: t0 + 2 * DAY, drift: 0.1, reset: true },
      { tTrue: t0 + 3 * DAY, drift: 1.9 },
    ];
    expect(segments(s).map((g) => g.length)).toEqual([2, 2]);
  });
});

describe('pairRates', () => {
  it('skips close measurements', () => {
    const s = [
      { tTrue: t0, drift: 0 },
      { tTrue: t0 + 3_600_000, drift: 0.1 },
      { tTrue: t0 + 2 * DAY, drift: 4 },
    ];
    expect(pairRates(s)).toEqual([{ from: t0, to: t0 + 2 * DAY, rate: 2 }]);
  });
});
