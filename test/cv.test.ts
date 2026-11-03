// End-to-end auto-read on the sample photos (local only; skipped if the files or tools are missing).
// The 6 photos were taken within 10 s: the watch drift must be the same in all of them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromU8 } from '../src/cv/image';
import { readWatch } from '../src/cv/read';
import { readExifTime } from '../src/exif';

const IDS = [1445, 1446, 1447, 1448, 1449, 1450];
const root = new URL('..', import.meta.url).pathname;
const has = (cmd: string) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const available = IDS.every((n) => existsSync(join(root, `IMG_${n}.HEIC`))) && has('heif-convert') && has('magick');

describe.skipIf(!available)('auto-read (sample photos)', () => {
  it('same drift in every photo (±0.25 s)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-'));
    const drifts: number[] = [];
    for (const n of IDS) {
      const heic = join(root, `IMG_${n}.HEIC`);
      const jpg = join(dir, `${n}.jpg`);
      execFileSync('heif-convert', ['-q', '95', heic, jpg], { stdio: 'ignore' });
      const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', jpg]).toString().split(' ').map(Number);
      const raw = execFileSync('magick', [jpg, '-colorspace', 'gray', '-depth', '8', 'gray:-'], { maxBuffer: 1 << 28 });
      const exif = (await readExifTime(new Uint8Array(readFileSync(heic))))!;
      const d = new Date(exif.ms);
      const ref = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
      const r = readWatch(fromU8(new Uint8Array(raw), w, h), { refTodSeconds: ref });
      drifts.push(r.todSeconds - ref);
    }
    const med = [...drifts].sort((a, b) => a - b)[3];
    for (const d of drifts) expect(Math.abs(d - med)).toBeLessThan(0.25);
    expect(med).toBeGreaterThan(-15.6);
    expect(med).toBeLessThan(-14.9);
  }, 180_000);
});
