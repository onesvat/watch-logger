// Hand detection in rectified dial coordinates (unit = inner minute-tick end).
// The hand plane is parallel to the dial, so under central projection it maps to the dial plane by a homothety:
// hand directions are preserved, only position/scale shift (parallax). Hence angle = line direction.

import { sample, type Gray } from './image';
import { applyH, type H3 } from './homography';

export interface Rect {
  img: Gray;
  extent: number; // image covers [-extent, extent]² dial units
}

export interface Line {
  phi: number; // direction from hub to tip (rad)
  d: number; // signed distance to origin (normal n = (-sin φ, cos φ))
  score: number;
  polarity: 1 | -1; // +1: structure brighter than the background
}

const TWO_PI = Math.PI * 2;
type At = (u: number, v: number) => number;

export function rectSample(r: Rect, u: number, v: number): number {
  const s = r.img.w / (2 * r.extent);
  return sample(r.img, (u + r.extent) * s - 0.5, (v + r.extent) * s - 0.5);
}

export const angDiff = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % TWO_PI) - Math.PI);

/**
 * Median normalised cross-correlation of the perpendicular profiles along a line with a Gaussian
 * line template on a flat background. Sign = polarity (+: bright line).
 */
export function nccMedian(at: At, phi: number, d: number, sigma: number, half: number, s0: number, s1: number, n: number): number {
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  const nx = -uy;
  const ny = ux;
  const K = 16;
  const tz: number[] = [];
  for (let m = -K; m <= K; m++) {
    const o = (m / K) * half;
    tz.push(Math.exp((-o * o) / (2 * sigma * sigma)));
  }
  const tm = tz.reduce((a, b) => a + b, 0) / tz.length;
  for (let j = 0; j < tz.length; j++) tz[j] -= tm;
  const tn = Math.sqrt(tz.reduce((a, v) => a + v * v, 0));
  const vals: number[] = [];
  const prof = new Array<number>(2 * K + 1);
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * (i + 0.5)) / n;
    const bx = d * nx + s * ux;
    const by = d * ny + s * uy;
    let mean = 0;
    let ok = true;
    for (let m = -K; m <= K; m++) {
      const o = (m / K) * half;
      const v = at(bx + o * nx, by + o * ny);
      if (v !== v) {
        ok = false;
        break;
      }
      prof[m + K] = v;
      mean += v;
    }
    if (!ok) continue;
    mean /= 2 * K + 1;
    let dot = 0;
    let pn = 0;
    for (let j = 0; j <= 2 * K; j++) {
      const z = prof[j] - mean;
      dot += z * tz[j];
      pn += z * z;
    }
    vals.push(pn > 1e-10 ? dot / (Math.sqrt(pn) * tn) : 0);
  }
  if (vals.length < n / 2) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

// ---------------- Hour & minute hands: lume strips ----------------

export interface LumeHand extends Line {
  end: number; // distance of the lume strip end from the hub (s) — minute > hour
}

/** Searches bright lume strips on a (φ, d) grid; returns the best `k` distinct directions. */
export function findLumeHands(r: Rect, k = 4): LumeHand[] {
  const at: At = (u, v) => rectSample(r, u, v);
  const sigma = 0.008;
  const half = 0.045;
  const cands: Line[] = [];
  for (let a = 0; a < 720; a++) {
    const phi = (a / 720) * TWO_PI;
    for (let d = -0.1; d <= 0.1 + 1e-9; d += 0.006) {
      const m = nccMedian(at, phi, d, sigma, half, 0.2, 0.45, 12);
      if (m > 0.4) cands.push({ phi, d, score: m, polarity: 1 });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const out: LumeHand[] = [];
  for (const c of cands) {
    if (out.length >= k) break;
    if (out.some((o) => angDiff(o.phi, c.phi) < (6 * Math.PI) / 180)) continue;
    // Local refinement (φ, d) — fine grid
    let best = c;
    for (let dp = -0.5; dp <= 0.5; dp += 0.1) {
      for (let dd = -0.004; dd <= 0.004 + 1e-9; dd += 0.001) {
        const phi = c.phi + (dp * Math.PI) / 180;
        const m = nccMedian(at, phi, c.d + dd, sigma, half, 0.2, 0.45, 16);
        if (m > best.score) best = { phi, d: c.d + dd, score: m, polarity: 1 };
      }
    }
    // Where the lume strip ends
    let end = 0.45;
    for (let s = 0.45; s < 1.0; s += 0.025) {
      if (nccMedian(at, best.phi, best.d, sigma, half, s, s + 0.025, 4) > 0.5) end = s + 0.025;
      else if (s > end + 0.05) break;
    }
    out.push({ ...best, end });
  }
  return out;
}

/** Intersection of two lines (null if parallel). */
export function intersect(a: { phi: number; d: number }, b: { phi: number; d: number }): [number, number] | null {
  // n·x = d,  n = (-sin φ, cos φ)
  const a1 = -Math.sin(a.phi), b1 = Math.cos(a.phi);
  const a2 = -Math.sin(b.phi), b2 = Math.cos(b.phi);
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < Math.sin((8 * Math.PI) / 180)) return null;
  return [(a.d * b2 - b.d * b1) / det, (a1 * b.d - a2 * a.d) / det];
}

// ---------------- Seconds hand ----------------

export interface SecondsCandidate {
  phi: number;
  d: number;
  score: number;
  polarity: 1 | -1;
  sigma: number;
}

/**
 * Seconds hand: thin-line search on a (φ, d) grid within the given angle window. Independent of polarity and
 * width (|NCC| at two scales). The counterweight tail (same polarity) and continuity up to the tip add a bonus;
 * hour/minute hand directions (±4°) are penalised (hand edges look like thin lines).
 */
export function findSeconds(
  r: Rect,
  center: number,
  halfWindow: number,
  avoid: number[],
  k = 5,
): SecondsCandidate[] {
  const at: At = (u, v) => rectSample(r, u, v);
  const cands: SecondsCandidate[] = [];
  const step = 0.25 * (Math.PI / 180);
  for (let phi = center - halfWindow; phi <= center + halfWindow; phi += step) {
    let best: SecondsCandidate | null = null;
    for (let d = -0.08; d <= 0.08 + 1e-9; d += 0.004) {
      for (const sigma of [0.0035, 0.007]) {
        const m = nccMedian(at, phi, d, sigma, 0.035, 0.3, 0.82, 10);
        const score = Math.abs(m);
        if (!best || score > best.score) best = { phi, d, score, polarity: m >= 0 ? 1 : -1, sigma };
      }
    }
    if (best) cands.push(best);
  }
  const peaks = cands.filter((c, i) => {
    for (let j = Math.max(0, i - 12); j <= Math.min(cands.length - 1, i + 12); j++) if (cands[j].score > c.score) return false;
    return true;
  });
  for (const p of peaks) {
    const tail = p.polarity * nccMedian(at, p.phi, p.d, 0.01, 0.04, -0.26, -0.08, 8);
    const tip = Math.abs(nccMedian(at, p.phi, p.d, p.sigma, 0.035, 0.82, 0.9, 4));
    let s = p.score + 0.3 * Math.max(0, tail) + 0.2 * tip;
    if (avoid.some((a) => angDiff(a, p.phi) < (4 * Math.PI) / 180)) s *= 0.5;
    p.score = s;
  }
  peaks.sort((x, y) => y.score - x.score);
  return peaks.slice(0, k);
}

/**
 * Sub-pixel line at full resolution: background-subtracted centroid of the perpendicular profile for each s
 * (symmetric for bright or dark, flat or domed hands), followed by an outlier-trimmed TLS line fit.
 */
export function refineLine(
  g: Gray,
  H: H3,
  line: { phi: number; d: number; polarity: 1 | -1 },
  segments: [number, number][],
  halfWidth: number,
): { phi: number; d: number; n: number; residualStd: number; points: [number, number][] } {
  const at: At = (u, v) => sample(g, ...applyH(H, u, v));
  let { phi, d } = line;
  let pts: [number, number][] = [];
  let resStd = NaN;
  for (let iter = 0; iter < 3; iter++) {
    const ux = Math.cos(phi), uy = Math.sin(phi);
    const nx = -uy, ny = ux;
    pts = [];
    for (const [s0, s1] of segments) {
      const N = Math.max(8, Math.round((s1 - s0) * 300));
      for (let i = 0; i < N; i++) {
        const s = s0 + ((s1 - s0) * (i + 0.5)) / N;
        const M = 30;
        const span = halfWidth * 3;
        const prof: number[] = [];
        for (let m = -M; m <= M; m++) {
          const o = (m / M) * span;
          prof.push(line.polarity * at(d * nx + s * ux + o * nx, d * ny + s * uy + o * ny));
        }
        if (prof.some((v) => v !== v)) continue;
        const edge = [...prof.slice(0, 8), ...prof.slice(-8)].sort((a, b) => a - b);
        const bg = edge[edge.length >> 1];
        let peak = -Infinity;
        for (let m = M - Math.round(M / 3); m <= M + Math.round(M / 3); m++) peak = Math.max(peak, prof[m] - bg);
        if (!(peak > 0)) continue;
        let sw = 0, so = 0;
        for (let m = 0; m <= 2 * M; m++) {
          const v = prof[m] - bg - 0.4 * peak;
          if (v > 0 && Math.abs(m - M) <= (2 * M) / 3) {
            sw += v;
            so += v * m;
          }
        }
        if (sw <= 0) continue;
        const o = ((so / sw - M) / M) * span;
        pts.push([d * nx + s * ux + o * nx, d * ny + s * uy + o * ny]);
      }
    }
    if (pts.length < 10) break;
    let use = pts;
    for (let rej = 0; rej < 4; rej++) {
      const mx = use.reduce((a, p) => a + p[0], 0) / use.length;
      const my = use.reduce((a, p) => a + p[1], 0) / use.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [x, y] of use) {
        sxx += (x - mx) ** 2;
        syy += (y - my) ** 2;
        sxy += (x - mx) * (y - my);
      }
      let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (Math.cos(ang - phi) < 0) ang += Math.PI;
      phi = ang;
      d = -Math.sin(phi) * mx + Math.cos(phi) * my;
      const resid = (p: [number, number]) => -Math.sin(phi) * p[0] + Math.cos(phi) * p[1] - d;
      const rs = use.map(resid).map(Math.abs).sort((a, b) => a - b);
      const sd = 1.4826 * rs[rs.length >> 1] + 1e-6;
      resStd = sd;
      use = pts.filter((p) => Math.abs(resid(p)) < 3 * sd);
    }
  }
  return { phi, d, n: pts.length, residualStd: resStd, points: pts };
}
