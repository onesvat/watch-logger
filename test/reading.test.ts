import { describe, expect, it } from 'vitest';
import { fmtTod, localMidnight, parseTimeOfDay, watchTimeFromTimeOfDay } from '../src/reading';

describe('parseTimeOfDay', () => {
  it('fractional seconds', () => expect(parseTimeOfDay('12:48:41.8')).toBe(((12 * 60 + 48) * 60 + 41) * 1000 + 800));
  it('comma and dot separators', () => expect(parseTimeOfDay('12.48.41,25')).toBe(46121250));
  it('no fraction', () => expect(parseTimeOfDay('0:0:5')).toBe(5000));
  it('invalid', () => {
    expect(parseTimeOfDay('24:00:00')).toBeNull();
    expect(parseTimeOfDay('12:60:00')).toBeNull();
    expect(parseTimeOfDay('abc')).toBeNull();
  });
});

describe('fmtTod', () => {
  it('formats and truncates', () => expect(fmtTod(46121890)).toBe('12:48:41.8'));
  it('wraps around the day', () => expect(fmtTod(-100)).toBe('23:59:59.9'));
  it('two digits', () => expect(fmtTod(5250, 2)).toBe('00:00:05.25'));
});

describe('watchTimeFromTimeOfDay', () => {
  const noon = new Date(2026, 8, 30, 12, 48, 57, 231).getTime();
  it('same day, watch behind', () => {
    const tod = parseTimeOfDay('12:48:41.8')!;
    expect((watchTimeFromTimeOfDay(noon, tod) - noon) / 1000).toBeCloseTo(-15.431, 6);
  });
  it('midnight crossing', () => {
    const t = new Date(2026, 8, 30, 23, 59, 59, 0).getTime();
    const w = watchTimeFromTimeOfDay(t, parseTimeOfDay('00:00:02.0')!);
    expect(w - t).toBe(3000);
    expect(localMidnight(w)).toBeGreaterThan(localMidnight(t));
  });
});
