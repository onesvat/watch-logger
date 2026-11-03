// Tam otomatik saat okuma hattı:
// merkez oylaması → dakika halkası (60. harmonik) → dakika çizgisi homografisi → 12 yönü (eksik endeksler)
// → akrep/yelkovan (lüm, referans zamana göre eşleme) → saniye penceresi (yelkovandan) → saniye ibresi
// (alt-piksel çizgi, paralaksa duyarsız yön).

import { findCenters } from './center';
import { fitDial, rectify, scaleRing, type DialFit } from './dial';
import { angDiff, findLumeHands, findSeconds, refineLine, type LumeHand } from './hands';
import { blur, downscale, type Gray } from './image';
import { findOrientation } from './orient';
import { fitRing } from './ring';

export interface WatchReading {
  /** Saatin gösterdiği gün içi zaman (s, 0..86400); 12 saat belirsizliği referansla çözülür. */
  todSeconds: number;
  seconds: number; // saniye ibresi 0..60
  minute: number;
  hour: number;
  confidence: number; // 0..1
  warnings: string[];
  diag: {
    ticksUsed: number;
    tickRmsPx: number;
    orientMargin: number;
    secondsResidual: number; // kadran birimi
    secondsPoints: number;
    minuteResidualDeg: number; // yelkovan − (dakika + saniye/60) tutarsızlığı
    hourResidualDeg: number;
    timings: Record<string, number>;
    lines: { name: string; phi: number; d: number }[];
    theta12: number;
  };
  dial: DialFit;
}

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const wrap = (x: number, m: number) => ((x % m) + m) % m;
const wrapSym = (x: number, m: number) => wrap(x + m / 2, m) - m / 2;

export interface ReadOptions {
  /** Referans (gerçek) gün içi zaman (s). Akrep/yelkovan eşlemesi ve 12/24 belirsizliği için. */
  refTodSeconds: number;
  /** Tarih penceresinin saat konumu (Datejust: 3). */
  datePosition?: number;
  onProgress?: (stage: string) => void;
}

export function readWatch(full: Gray, opts: ReadOptions): WatchReading {
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  let t = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - t);
    t = n;
    opts.onProgress?.(k);
  };

  // 1) Kadran düzlemi
  const L = Math.max(full.w, full.h);
  const fc = Math.max(1, Math.round(L / 640));
  const fr = Math.max(1, Math.round(L / 1500));
  const centers = findCenters(downscale(full, fc)).map((c) => ({ x: (c.x * fc) / fr, y: (c.y * fc) / fr }));
  lap('merkez');
  const ring = fitRing(downscale(full, fr), centers);
  if (!ring || ring.energy < 0.03) throw new Error('Kadran bulunamadı');
  lap('halka');
  const dial = fitDial(full, scaleRing(ring, fr));
  const radiusPx = ring.a * fr;
  if (radiusPx < 250) warnings.push(`Kadran küçük (${Math.round(radiusPx)} px) — daha yakından çekin`);
  lap('homografi');
  const R = { img: blur(rectify(full, dial.H, 1200, 1.1), 0.8), extent: 1.1 };
  lap('düzleştirme');

  // 2) 12 yönü
  const orient = findOrientation(R, opts.datePosition ?? 3);
  const th12 = orient.theta12;
  if (orient.margin < 0.3) warnings.push('12 yönü belirsiz');
  lap('12-yönü');

  // 3) Akrep & yelkovan: referans zamana göre beklenen açılarla eşle
  const ref = opts.refTodSeconds;
  const expH = th12 + (wrap(ref / 3600, 12) / 12) * TWO_PI;
  const expM = th12 + (wrap(ref / 60, 60) / 60) * TWO_PI;
  const lume = findLumeHands(R, 4);
  const pick = (exp: number, tol: number, not?: LumeHand) =>
    lume
      .filter((l) => l !== not && angDiff(l.phi, exp) < tol)
      .sort((a, b) => angDiff(a.phi, exp) - angDiff(b.phi, exp))[0];
  const hourL = pick(expH, 8 * DEG);
  const minL = pick(expM, 60 * DEG, hourL);
  const refineLume = (l: LumeHand) => {
    const r = refineLine(full, dial.H, l, [[0.2, Math.min(l.end, 0.8) - 0.03]], 0.012);
    return { ...l, phi: r.phi, d: r.d };
  };
  const minute = minL && refineLume(minL);
  const hour = hourL && refineLume(hourL);
  if (!minute) warnings.push('Yelkovan bulunamadı');
  lap('akrep-yelkovan');

  // 4) Saniye penceresi: yelkovanın kesirli konumu saniyeyi ±~10 s öngörür
  let center = 0;
  let half = Math.PI;
  if (minute) {
    const mW = (wrap(minute.phi - th12, TWO_PI) / TWO_PI) * 60;
    const sEst = (mW - Math.floor(mW)) * 60;
    center = th12 + (sEst / 60) * TWO_PI;
    half = 120 * DEG; // yelkovan hizalaması ±1–2° (±10 s) sapabilir
  }
  const avoid = [minute?.phi, hour?.phi].filter((v): v is number => v !== undefined);
  let secC = findSeconds(R, center, half, avoid, 10);
  if (secC.length === 0 || secC[0].score < 0.45) {
    const wide = findSeconds(R, 0, Math.PI, avoid, 10);
    if (wide.length && (!secC.length || wide[0].score > secC[0].score + 0.1)) secC = wide;
  }
  if (secC.length === 0) throw new Error('Saniye ibresi bulunamadı');
  lap('saniye-arama');
  // Adayları tam çözünürlükte iyileştir; gerçek ibre düz ve süreklidir (düşük artık, çok nokta).
  const refined = secC.map((c) => {
    const r = refineLine(full, dial.H, c, [[0.25, 0.86], [-0.24, -0.1]], c.sigma * 2.2);
    const straight = Math.exp(-((Math.max(0, r.residualStd - 0.003) / 0.004) ** 2));
    return { c, r, q: c.score * straight * Math.min(1, r.n / 180) };
  });
  refined.sort((a, b) => b.q - a.q);
  const sec = refined[0].r;
  if (refined.length > 1 && refined[1].q > 0.85 * refined[0].q) warnings.push('Saniye ibresi adayları yakın');
  lap('saniye-iyileştirme');

  // 5) Zamanı birleştir
  const s = (wrap(sec.phi - th12, TWO_PI) / TWO_PI) * 60;
  let M: number;
  let em = NaN;
  if (minute) {
    const mW = (wrap(minute.phi - th12, TWO_PI) / TWO_PI) * 60;
    M = wrap(Math.round(mW - s / 60), 60);
    em = wrapSym(mW - (M + s / 60), 60) * 6;
  } else {
    M = wrap(Math.round(wrap(ref / 60, 60) - s / 60), 60);
  }
  let Hh: number;
  let eh = NaN;
  if (hour) {
    const hW = (wrap(hour.phi - th12, TWO_PI) / TWO_PI) * 12;
    Hh = wrap(Math.round(hW - (M + s / 60) / 60), 12);
    eh = wrapSym(hW - (Hh + (M + s / 60) / 60), 12) * 30;
  } else {
    Hh = wrap(Math.round(wrap(ref / 3600, 12) - (M + s / 60) / 60), 12);
  }
  let tod = Hh * 3600 + M * 60 + s;
  if (Math.abs(wrapSym(tod + 43200 - ref, 86400)) < Math.abs(wrapSym(tod - ref, 86400))) tod += 43200;
  tod = wrap(tod, 86400);

  if (Math.abs(em) > 3) warnings.push(`Yelkovan–saniye tutarsız (${em.toFixed(1)}°)`);
  if (Math.abs(eh) > 8) warnings.push(`Akrep tutarsız (${eh.toFixed(1)}°)`);
  const sharp = Math.max(0, Math.min(1, (0.02 - sec.residualStd) / 0.015));
  const cons = Number.isFinite(em) ? Math.exp(-((em / 2) ** 2)) : 0.5;
  const confidence = Math.min(1, orient.margin) * 0.3 + sharp * 0.3 + cons * 0.4;

  return {
    todSeconds: tod,
    seconds: s,
    minute: M,
    hour: Hh,
    confidence,
    warnings,
    diag: {
      ticksUsed: dial.ticks.filter((x) => x.weight > 0).length,
      tickRmsPx: dial.rmsPx,
      orientMargin: orient.margin,
      secondsResidual: sec.residualStd,
      secondsPoints: sec.n,
      minuteResidualDeg: em,
      hourResidualDeg: eh,
      timings,
      lines: [
        ...(minute ? [{ name: 'yelkovan', phi: minute.phi, d: minute.d }] : []),
        ...(hour ? [{ name: 'akrep', phi: hour.phi, d: hour.d }] : []),
        ...refined.map((x, i) => ({ name: `sec${i}(${x.c.score.toFixed(2)}/σ${(x.r.residualStd * 1e3).toFixed(1)}/q${x.q.toFixed(2)})`, phi: x.c.phi, d: x.c.d })),
        { name: 'sec*', phi: sec.phi, d: sec.d },
      ],
      theta12: th12,
    },
    dial,
  };
}
