// Cihaz saatinin UTC'ye göre ofseti (Cristian algoritması).
// offset = gerçekZaman − Date.now()  →  gerçekZaman = Date.now() + offset

export interface SyncResult {
  offsetMs: number;
  errMs: number; // ± belirsizlik (en iyi örneğin RTT/2'si)
  rttMs: number;
  samples: number;
  at: number; // ölçüm anı (Date.now)
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
  if (!Number.isFinite(server)) throw new Error(`Geçersiz sunucu cevabı: ${text}`);
  const rtt = p1 - p0;
  // Sunucu zamanı ms'ye kesilmiş gelir → ortalama +0,5 ms.
  return { offset: server + 0.5 - (wall0 + rtt / 2), rtt };
}

export async function syncClock(n = 8): Promise<SyncResult> {
  await sample().catch(() => undefined); // DNS/TLS ısınması, sonucu atılır
  const results: { offset: number; rtt: number }[] = [];
  for (let i = 0; i < n; i++) {
    try {
      results.push(await sample());
    } catch {
      /* tek örnek hatası önemsiz */
    }
  }
  if (results.length === 0) throw new Error('Zaman sunucusuna ulaşılamadı');
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
