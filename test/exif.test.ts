import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exifToMs, readExifTime } from '../src/exif';

describe('exifToMs', () => {
  it('alt-saniye ve ofseti uygular', () => {
    const r = exifToMs({ DateTimeOriginal: '2026:09:30 12:48:48', SubSecTimeOriginal: '794', OffsetTimeOriginal: '+03:00' })!;
    expect(new Date(r.ms).toISOString()).toBe('2026-09-30T09:48:48.794Z');
    expect(r.hasSubSec && r.hasOffset).toBe(true);
  });
  it('iki haneli alt-saniye', () => {
    const r = exifToMs({ DateTimeOriginal: '2026:09:30 12:48:48', SubSecTimeOriginal: '5', OffsetTimeOriginal: '+00:00' })!;
    expect(r.ms % 1000).toBe(500);
  });
});

// Kullanıcının örnek iPhone 17 Pro HEIC dosyaları (repo dışında, varsa)
const sample = new URL('../IMG_1445.HEIC', import.meta.url);
describe.skipIf(!existsSync(sample))('iPhone HEIC', () => {
  it('exifr HEIC başlığını tanımasa da zamanı okur', async () => {
    const r = await readExifTime(new Uint8Array(readFileSync(sample)));
    expect(r).not.toBeNull();
    expect(new Date(r!.ms).toISOString()).toBe('2026-09-30T09:48:48.794Z');
    expect(r!.model).toBe('iPhone 17 Pro');
  });
});
