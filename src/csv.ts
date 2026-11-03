import type { Measurement } from './db';

const COLS = [
  'id',
  'true_time_iso',
  'true_time_ms',
  'watch_time_ms',
  'drift_s',
  'device_time_ms',
  'offset_ms',
  'offset_err_ms',
  'latency_ms',
  'source',
  'reset',
  'note',
] as const;

const esc = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(ms: Measurement[]): string {
  const rows = ms.map((m) =>
    [
      m.id,
      new Date(m.tTrue).toISOString(),
      m.tTrue.toFixed(1),
      m.watchTime.toFixed(1),
      m.drift.toFixed(3),
      m.tDevice.toFixed(1),
      m.offsetMs.toFixed(1),
      m.offsetErrMs.toFixed(1),
      m.latencyMs.toFixed(1),
      m.source,
      m.reset ? 1 : 0,
      m.note,
    ]
      .map(esc)
      .join(','),
  );
  return [COLS.join(','), ...rows].join('\n') + '\n';
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

export function fromCsv(text: string): Measurement[] {
  const [head, ...rows] = parseRows(text);
  if (!head) return [];
  const ix = (k: (typeof COLS)[number]) => head.indexOf(k);
  const num = (r: string[], k: (typeof COLS)[number]) => Number(r[ix(k)] ?? NaN);
  return rows
    .map((r): Measurement => {
      const tTrue = num(r, 'true_time_ms');
      const watchTime = num(r, 'watch_time_ms');
      return {
        id: r[ix('id')] || crypto.randomUUID(),
        createdAt: Date.now(),
        source: 'import',
        tDevice: num(r, 'device_time_ms') || tTrue,
        offsetMs: num(r, 'offset_ms') || 0,
        offsetErrMs: num(r, 'offset_err_ms') || 0,
        latencyMs: num(r, 'latency_ms') || 0,
        tTrue,
        watchTime,
        drift: (watchTime - tTrue) / 1000,
        imgW: 0,
        imgH: 0,
        note: r[ix('note')] ?? '',
        reset: r[ix('reset')] === '1',
      };
    })
    .filter((m) => Number.isFinite(m.tTrue) && Number.isFinite(m.watchTime));
}
