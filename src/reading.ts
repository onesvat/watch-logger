// Compares a watch reading (hh:mm:ss.f) with true time.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "hh:mm:ss.f", "hh:mm:ss" or "hh.mm.ss,f" → ms of day. null if invalid. */
export function parseTimeOfDay(text: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{1,2})[:.](\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || mi > 59 || s > 59) return null;
  const frac = m[4] ? Number('0.' + m[4]) : 0;
  return ((h * 60 + mi) * 60 + s) * 1000 + Math.round(frac * 1000);
}

/** ms of day → "hh:mm:ss.f..." (digits = fraction digits, truncated). */
export function fmtTod(todMs: number, digits = 1): string {
  const day = 86_400_000;
  const t = ((Math.round(todMs) % day) + day) % day;
  const s = Math.floor(t / 1000);
  const f = digits > 0 ? '.' + pad(Math.floor(((t % 1000) / 1000) * 10 ** digits), digits) : '';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${f}`;
}

export function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Places the time of day shown by the watch at the absolute instant closest to true time
 * (tries ±1 day around midnight).
 */
export function watchTimeFromTimeOfDay(tTrueMs: number, todMs: number): number {
  const base = localMidnight(tTrueMs) + todMs;
  const candidates = [base - 86_400_000, base, base + 86_400_000];
  return candidates.reduce((best, c) => (Math.abs(c - tTrueMs) < Math.abs(best - tTrueMs) ? c : best));
}

/** Local time hh:mm:ss.f (digits = fraction digits, truncated). */
export function fmtTime(ms: number, digits = 1): string {
  const whole = Math.floor(ms / 1000) * 1000;
  const d = new Date(whole);
  const f = digits > 0 ? '.' + pad(Math.floor(((ms - whole) / 1000) * 10 ** digits), digits) : '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${f}`;
}

/** hh:mm:ss.f rounded to 0.1 s (for form prefill). */
export function fmtTimeRounded(ms: number): string {
  return fmtTime(Math.round(ms / 100) * 100, 1);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtSigned(v: number, digits = 1, unit = ''): string {
  let s = v.toFixed(digits);
  if (Number(s) === 0) s = (0).toFixed(digits); // "-0.0" → "0.0"
  return (s.startsWith('-') ? '' : '+') + s + unit;
}
