import { describe, expect, it } from 'vitest';
import { fromCsv, toCsv } from '../src/csv';
import type { Measurement } from '../src/db';

const m: Measurement = {
  id: 'a1', createdAt: 0, source: 'camera', tDevice: 1790761793000, offsetMs: -37, offsetErrMs: 12,
  latencyMs: 40, tTrue: 1790761792923, watchTime: 1790761795323, drift: 2.4, imgW: 1, imgH: 1,
  note: 'gece, "kurmalı", masada', reset: true,
};

describe('csv', () => {
  it('gidiş-dönüş', () => {
    const [r] = fromCsv(toCsv([m]));
    expect(r.id).toBe('a1');
    expect(r.tTrue).toBe(m.tTrue);
    expect(r.drift).toBeCloseTo(2.4, 9);
    expect(r.note).toBe(m.note);
    expect(r.reset).toBe(true);
  });
});
