// Eşmerkezli elipslerin (kadran, bezel, kasa) ortak merkezini bulur.
// Elips üzerindeki paralel teğetli (zıt gradyanlı) iki noktanın orta noktası elips merkezidir;
// bu orta noktalar bir akümülatöre oylanır.

import { blur, gradient, type Gray } from './image';

export interface CenterResult {
  x: number;
  y: number;
  score: number; // tepe / ortalama oy oranı
}

const BINS = 180; // 2° yön kutusu

/** En güçlü `k` merkez adayı (birbirinden en az `sep` piksel uzak). */
export function findCenters(g: Gray, k = 6, maxPoints = 12000): CenterResult[] {
  const { w, h } = g;
  const { gx, gy, mag } = gradient(blur(g, 1.2));

  // En güçlü kenar noktaları (gradyan büyüklüğü eşiği = üst yüzdelik)
  const sorted = Float32Array.from(mag).sort();
  const thr = sorted[Math.max(0, sorted.length - maxPoints)];
  const bins: number[][] = Array.from({ length: BINS }, () => []);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (mag[i] < thr || mag[i] === 0) continue;
      // Kenar inceltme: gradyan yönünde yerel maksimum olmayanları at
      const ux = gx[i] / mag[i];
      const uy = gy[i] / mag[i];
      const a = mag[Math.round(y + uy) * w + Math.round(x + ux)];
      const b = mag[Math.round(y - uy) * w + Math.round(x - ux)];
      if (mag[i] < a || mag[i] < b) continue;
      const ang = Math.atan2(uy, ux);
      const bin = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      bins[bin].push(i);
    }
  }

  const acc = new Float32Array(w * h);
  const minD = 0.06 * Math.min(w, h);
  const maxD = 0.95 * Math.max(w, h);
  for (let b = 0; b < BINS / 2; b++) {
    const A = bins[b];
    for (const ob of [b + BINS / 2 - 1, b + BINS / 2, (b + BINS / 2 + 1) % BINS]) {
      const B = bins[ob];
      for (const i of A) {
        const px = i % w;
        const py = (i - px) / w;
        const pgx = gx[i] / mag[i];
        const pgy = gy[i] / mag[i];
        for (const j of B) {
          const qx = j % w;
          const qy = (j - qx) / w;
          const dx = qx - px;
          const dy = qy - py;
          const d = Math.hypot(dx, dy);
          if (d < minD || d > maxD) continue;
          // Her iki gradyan da kirişe göre aynı tarafa (içe ya da dışa) bakmalı
          const cp = (dx * pgx + dy * pgy) / d;
          const cq = -(dx * gx[j] + dy * gy[j]) / (d * mag[j]);
          if (Math.abs(cp) < 0.25 || cp * cq <= 0) continue;
          const mx = Math.round((px + qx) / 2);
          const my = Math.round((py + qy) / 2);
          acc[my * w + mx] += 1;
        }
      }
    }
  }

  const sm = blur({ w, h, data: acc }, 2);
  let sum = 0;
  for (let i = 0; i < sm.data.length; i++) sum += sm.data[i];
  const mean = sum / sm.data.length;
  const sep = 0.08 * Math.min(w, h);
  const out: CenterResult[] = [];
  const work = Float32Array.from(sm.data);
  for (let n = 0; n < k; n++) {
    let best = 0;
    for (let i = 0; i < work.length; i++) if (work[i] > work[best]) best = i;
    if (work[best] <= 0) break;
    const bx = best % w;
    const by = (best - bx) / w;
    // Alt-piksel: 5x5 ağırlık merkezi
    let sx = 0, sy = 0, sw = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const v = sm.data[(by + dy) * w + bx + dx] ?? 0;
        sx += v * (bx + dx);
        sy += v * (by + dy);
        sw += v;
      }
    out.push({ x: sx / sw, y: sy / sw, score: sm.data[best] / mean });
    // Bastır
    const r = Math.ceil(sep);
    for (let y = Math.max(0, by - r); y < Math.min(h, by + r); y++)
      for (let x = Math.max(0, bx - r); x < Math.min(w, bx + r); x++)
        if ((x - bx) ** 2 + (y - by) ** 2 < sep * sep) work[y * w + x] = 0;
  }
  return out;
}
