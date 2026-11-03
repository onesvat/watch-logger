// Kadranın 12 yönü (düzleştirilmiş koordinatlarda), kadran özelliklerinden:
// 1) Saat endeksleri (uygulamalı çubuklar) 30° periyotlu parlak desen → hangi dakika çizgileri saat konumu.
// 2) Taç (12) ve tarih penceresi (3) konumlarında çubuk endeks yoktur → 90° arayla eksik iki endeks.

import { rectSample, type Rect } from './hands';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

export interface Orientation {
  theta12: number; // rad, kadran koordinatlarında
  k12: number; // 12'nin dakika çizgisi indeksi (θ = 6k°)
  hourPhaseK: number; // saat konumlarının k mod 5 değeri
  hourPhaseStrength: number; // 0..1
  dateContrast: number; // tarih sektörü / diğer saat sektörlerinin medyanı
  sectorScores: number[]; // 12 saat konumunun parlaklık skorları (saat 12'den başlayarak)
  margin: number; // en iyi ile ikinci 12 adayı arasındaki skor farkı
}

/** Açısal profil: r ∈ [r0, r1] bandında ortalama parlaklık, n örnek. */
function angularProfile(R: Rect, r0: number, r1: number, n: number): Float64Array {
  const p = new Float64Array(n);
  const NR = 8;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TWO_PI;
    let s = 0;
    let c = 0;
    for (let j = 0; j < NR; j++) {
      const r = r0 + ((r1 - r0) * (j + 0.5)) / NR;
      const v = rectSample(R, r * Math.cos(t), r * Math.sin(t));
      if (v === v) {
        s += v;
        c++;
      }
    }
    p[i] = c ? s / c : 0;
  }
  return p;
}

/** Saat konumundaki çubuk endeks varlığı: dar tepe (±1.5°) − yanlar (±4..8°), r 0.74–0.86. */
export function barScores(R: Rect, hourPhaseK: number): number[] {
  const out: number[] = [];
  for (let h = 0; h < 12; h++) {
    const th = (hourPhaseK + 5 * h) * 6 * DEG;
    const vals: number[] = [];
    for (let r = 0.74; r <= 0.86; r += 0.01) {
      const at = (t: number) => rectSample(R, r * Math.cos(t), r * Math.sin(t));
      let c = 0;
      for (let d = -1.2; d <= 1.2; d += 0.4) c += at(th + d * DEG) / 7;
      let side = 0;
      for (const d of [-8, -6, -4, 4, 6, 8]) side += at(th + d * DEG) / 6;
      vals.push(c - side);
    }
    vals.sort((a, b) => a - b);
    out.push(vals[vals.length >> 1]);
  }
  return out;
}

export function findOrientation(R: Rect, datePosition = 3): Orientation {
  const N = 3600;
  // Saat endeksleri: r ≈ 0.72–0.88 bandı. 12. harmonik (30° periyot) fazı.
  const idx = angularProfile(R, 0.74, 0.86, N);
  let re = 0;
  let im = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += idx[i] / N;
  let vs = 0;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TWO_PI;
    const v = idx[i] - mean;
    re += v * Math.cos(12 * t);
    im += v * Math.sin(12 * t);
    vs += v * v;
  }
  const phase = Math.atan2(im, re) / 12; // endeks tepe açısı (mod 30°)
  const strength = (2 * (re * re + im * im)) / (N * vs || 1);
  // En yakın dakika çizgisi indeksinin mod 5 değeri
  const hourPhaseK = ((Math.round(phase / (6 * DEG)) % 5) + 5) % 5;

  // 12 ve tarih konumu: bu iki saat konumunda çubuk endeks yoktur (taç + tarih penceresi).
  // Tarih penceresinin parlaklığı yardımcı kanıt (yansımada koyu olabilir, bu yüzden zayıf ağırlık).
  const bars = barScores(R, hourPhaseK);
  const wide = angularProfile(R, 0.5, 0.85, 720);
  const sector = (theta: number) => {
    let s = 0;
    let c = 0;
    for (let d = -9; d <= 9; d += 0.5) {
      const i = Math.round(((((theta / DEG + d) % 360) + 360) % 360) * 2) % 720;
      s += wide[i];
      c++;
    }
    return s / c;
  };
  const scores = [...Array(12).keys()].map((h) => sector((hourPhaseK + 5 * h) * 6 * DEG));
  const barMed = [...bars].sort((a, b) => a - b)[6];
  const scMed = [...scores].sort((a, b) => a - b)[6];
  const cand = [...Array(12).keys()].map((h) => {
    const hd = (h + datePosition) % 12;
    const missing = (barMed - bars[h]) + (barMed - bars[hd]); // büyük = iki endeks de yok
    const date = scores[hd] / (scMed || 1) - 1;
    return { h, score: missing / (barMed || 1) + 0.15 * date };
  });
  cand.sort((a, b) => b.score - a.score);
  const h12 = cand[0].h;
  const k12 = (hourPhaseK + 5 * h12) % 60;
  const theta12 = k12 * 6 * DEG;
  const sectorScores = [...Array(12).keys()].map((h) => scores[(h + h12) % 12]);
  const margin = cand[0].score - cand[1].score;
  return {
    theta12,
    k12,
    hourPhaseK,
    hourPhaseStrength: strength,
    dateContrast: scores[(h12 + datePosition) % 12] / (scMed || 1),
    sectorScores,
    margin,
  };
}
