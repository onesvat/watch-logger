// Elle girilen saat okumasını (hh:mm:ss.f) gerçek zamanla karşılaştırır.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "hh:mm:ss.f", "hh:mm:ss" veya "hh.mm.ss,f" → gün içi ms. Geçersizse null. */
export function parseTimeOfDay(text: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{1,2})[:.](\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || mi > 59 || s > 59) return null;
  const frac = m[4] ? Number('0.' + m[4]) : 0;
  return ((h * 60 + mi) * 60 + s) * 1000 + Math.round(frac * 1000);
}

/** Gün içi ms → "hh:mm:ss.f..." (digits kesir basamağı, kesilir). */
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
 * Saatin gösterdiği gün içi zamanı, gerçek zamana en yakın mutlak ana yerleştirir
 * (gece yarısı geçişlerinde ±1 gün dener).
 */
export function watchTimeFromTimeOfDay(tTrueMs: number, todMs: number): number {
  const base = localMidnight(tTrueMs) + todMs;
  const candidates = [base - 86_400_000, base, base + 86_400_000];
  return candidates.reduce((best, c) => (Math.abs(c - tTrueMs) < Math.abs(best - tTrueMs) ? c : best));
}

/** Yerel saat hh:mm:ss.f (digits = kesir basamak sayısı, kesilir). */
export function fmtTime(ms: number, digits = 1): string {
  const whole = Math.floor(ms / 1000) * 1000;
  const d = new Date(whole);
  const f = digits > 0 ? '.' + pad(Math.floor(((ms - whole) / 1000) * 10 ** digits), digits) : '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${f}`;
}

/** 0,1 s'ye yuvarlanmış hh:mm:ss.f (form ön doldurma için). */
export function fmtTimeRounded(ms: number): string {
  return fmtTime(Math.round(ms / 100) * 100, 1);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function fmtSigned(v: number, digits = 1, unit = ''): string {
  let s = v.toFixed(digits);
  if (Number(s) === 0) s = (0).toFixed(digits); // "-0.0" → "0.0"
  return (s.startsWith('-') ? '' : '+') + s + unit;
}
