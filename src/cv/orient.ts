// The 12 direction of the dial (in rectified coordinates), from dial features:
// 1) Hour indices (applied batons) form a bright 30°-periodic pattern → which minute ticks are hour positions.
// 2) There is no baton at the crown (12) and date window (3) → two missing indices 90° apart.

import { rectSample, type Rect } from './hands';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

export interface Orientation {
  theta12: number; // rad, in dial coordinates
  k12: number; // minute-tick index of 12 (θ = 6k°)
  hourPhaseK: number; // k mod 5 of the hour positions
  hourPhaseStrength: number; // 0..1
  dateContrast: number; // date sector / median of the other hour sectors
  sectorScores: number[]; // brightness scores of the 12 hour positions (starting at 12)
  margin: number; // score gap between the best and second-best 12 candidates
}

/** Angular profile: mean brightness in the band r ∈ [r0, r1], n samples. */
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

/** Baton presence at an hour position: narrow peak (±1.5°) − flanks (±4..8°), r 0.74–0.86. */
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
  // Hour indices: band r ≈ 0.72–0.88. Phase of the 12th harmonic (30° period).
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
  const phase = Math.atan2(im, re) / 12; // index peak angle (mod 30°)
  const strength = (2 * (re * re + im * im)) / (N * vs || 1);
  // mod 5 of the nearest minute-tick index
  const hourPhaseK = ((Math.round(phase / (6 * DEG)) % 5) + 5) % 5;

  // 12 and date position: these two hour positions have no baton (crown + date window).
  // Date window brightness is supporting evidence (may look dark in reflections, hence a low weight).
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
    const missing = (barMed - bars[h]) + (barMed - bars[hd]); // large = both indices missing
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
