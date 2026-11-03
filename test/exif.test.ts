import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exifToMs, readExifTime } from '../src/exif';

describe('exifToMs', () => {
  it('applies sub-seconds and offset', () => {
    const r = exifToMs({ DateTimeOriginal: '2026:09:30 12:48:48', SubSecTimeOriginal: '794', OffsetTimeOriginal: '+03:00' })!;
    expect(new Date(r.ms).toISOString()).toBe('2026-09-30T09:48:48.794Z');
    expect(r.hasSubSec && r.hasOffset).toBe(true);
  });
  it('two-digit sub-seconds', () => {
    const r = exifToMs({ DateTimeOriginal: '2026:09:30 12:48:48', SubSecTimeOriginal: '5', OffsetTimeOriginal: '+00:00' })!;
    expect(r.ms % 1000).toBe(500);
  });
});

// The user's sample iPhone 17 Pro HEIC files (kept out of the repo, used if present)
const sample = new URL('../IMG_1445.HEIC', import.meta.url);
describe.skipIf(!existsSync(sample))('iPhone HEIC', () => {
  it('reads the time even when exifr does not recognise the HEIC header', async () => {
    const r = await readExifTime(new Uint8Array(readFileSync(sample)));
    expect(r).not.toBeNull();
    expect(new Date(r!.ms).toISOString()).toBe('2026-09-30T09:48:48.794Z');
    expect(r!.model).toBe('iPhone 17 Pro');
  });
});
