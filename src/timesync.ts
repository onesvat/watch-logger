// Offset of the device clock relative to UTC (Cristian's algorithm).
// offset = trueTime − Date.now()  →  trueTime = Date.now() + offset

export interface SyncResult {
  offsetMs: number;
  errMs: number; // ± uncertainty (RTT/2 of the best sample)
  rttMs: number;
  samples: number;
  at: number; // measurement time (Date.now)
  server: string;
}

const SERVER = 'https://time.akamai.com/?ms';

async function sample(): Promise<{ offset: number; rtt: number }> {
  const wall0 = Date.now();
  const p0 = performance.now();
  const res = await fetch(`${SERVER}&_=${p0.toFixed(3)}`, { cache: 'no-store', credentials: 'omit' });
  const text = await res.text();
  const p1 = performance.now();
  const server = parseFloat(text) * 1000;
  if (!Number.isFinite(server)) throw new Error(`Invalid server response: ${text}`);
  const rtt = p1 - p0;
  // Server time is truncated to ms → add 0.5 ms on average.
  return { offset: server + 0.5 - (wall0 + rtt / 2), rtt };
}

export async function syncClock(n = 8): Promise<SyncResult> {
  await sample().catch(() => undefined); // DNS/TLS warm-up, result discarded
  const results: { offset: number; rtt: number }[] = [];
  for (let i = 0; i < n; i++) {
    try {
      results.push(await sample());
    } catch {
      /* a single failed sample is fine */
    }
  }
  if (results.length === 0) throw new Error('Time server unreachable');
  results.sort((a, b) => a.rtt - b.rtt);
  const best = results[0];
  return {
    offsetMs: best.offset,
    errMs: best.rtt / 2,
    rttMs: best.rtt,
    samples: results.length,
    at: Date.now(),
    server: 'time.akamai.com',
  };
}
