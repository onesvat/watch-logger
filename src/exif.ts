import exifr from 'exifr';

export interface ExifTime {
  ms: number; // epoch ms
  hasSubSec: boolean;
  hasOffset: boolean;
  model?: string;
}

const PICK = ['DateTimeOriginal', 'SubSecTimeOriginal', 'OffsetTimeOriginal', 'Model'];

/**
 * exifr may not recognise recent iPhone HEIC headers ("Unknown file format").
 * In that case we locate "Exif\0\0" + the TIFF header manually and parse only the TIFF block.
 */
function findTiff(buf: Uint8Array): number {
  const exifMarker = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const isTiff = (i: number) =>
    (buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 2] === 0 && buf[i + 3] === 0x2a) ||
    (buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a && buf[i + 3] === 0);
  let firstTiff = -1;
  for (let i = 0; i < buf.length - 10; i++) {
    if (isTiff(i)) {
      if (i >= 6 && exifMarker.every((b, k) => buf[i - 6 + k] === b)) return i;
      if (firstTiff < 0) firstTiff = i;
    }
  }
  return firstTiff;
}

type Raw = Record<string, unknown>;

async function parseRaw(input: Uint8Array): Promise<Raw | undefined> {
  try {
    return await exifr.parse(input, { pick: PICK, reviveValues: false });
  } catch {
    const i = findTiff(input);
    if (i < 0) return undefined;
    try {
      return await exifr.parse(input.subarray(i), { tiff: true, exif: true, pick: PICK, reviveValues: false });
    } catch {
      return undefined;
    }
  }
}

export function exifToMs(raw: Raw): ExifTime | null {
  const dto = raw.DateTimeOriginal;
  if (typeof dto !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dto);
  if (!m) return null;
  const sub = raw.SubSecTimeOriginal != null ? String(raw.SubSecTimeOriginal).trim() : '';
  const frac = /^\d+$/.test(sub) ? Number('0.' + sub) : 0;
  const off = typeof raw.OffsetTimeOriginal === 'string' ? raw.OffsetTimeOriginal.trim() : '';
  const hasOffset = /^[+-]\d{2}:\d{2}$/.test(off);
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${hasOffset ? off : ''}`;
  const base = Date.parse(iso); // without an offset this is parsed as local time
  if (Number.isNaN(base)) return null;
  return {
    ms: base + Math.round(frac * 1000),
    hasSubSec: sub !== '',
    hasOffset,
    model: typeof raw.Model === 'string' ? raw.Model : undefined,
  };
}

export async function readExifTime(input: Blob | Uint8Array): Promise<ExifTime | null> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const raw = await parseRaw(buf);
  return raw ? exifToMs(raw) : null;
}
