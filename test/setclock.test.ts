import { describe, expect, it } from 'vitest';
import { fmtCountdown, nextSetTarget, SET_STEP_MS } from '../src/setclock';

describe('nextSetTarget', () => {
  const base = Date.UTC(2026, 10, 3, 14, 20, 0);
  it('picks the next full 5 minutes', () => {
    expect(nextSetTarget(base + 2 * 60_000 + 41_000)).toBe(base + SET_STEP_MS);
  });
  it('skips ahead when less than 1 minute is left', () => {
    expect(nextSetTarget(base + 4 * 60_000 + 30_000)).toBe(base + 2 * SET_STEP_MS);
  });
  it('returns the next step when exactly on a boundary', () => {
    expect(nextSetTarget(base)).toBe(base + SET_STEP_MS);
  });
});

describe('fmtCountdown', () => {
  it('formats', () => {
    expect(fmtCountdown(139_000)).toBe('2:19');
    expect(fmtCountdown(4_200)).toBe('5');
    expect(fmtCountdown(60_000)).toBe('1:00');
    expect(fmtCountdown(-5)).toBe('0');
  });
});
