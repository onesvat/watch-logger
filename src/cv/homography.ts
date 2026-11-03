// Çok noktalı homografi (normalize DLT, en küçük kareler) ve IRLS ile aykırı değerlere dayanıklı uydurma.

export type H3 = number[]; // 3x3 satır öncelikli

export function applyH(h: H3, x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invertH(h: H3): H3 {
  const [a, b, c, d, e, f, g, k, l] = h;
  const A = e * l - f * k;
  const B = -(d * l - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  const inv = [
    A, -(b * l - c * k), b * f - c * e,
    B, a * l - c * g, -(a * f - c * d),
    C, -(a * k - b * g), a * e - b * d,
  ].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
}

function mul(a: H3, b: H3): H3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-15) throw new Error('tekil sistem');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function normalizer(pts: [number, number][], wts: number[]): H3 {
  let sw = 0, mx = 0, my = 0;
  pts.forEach(([x, y], i) => { sw += wts[i]; mx += wts[i] * x; my += wts[i] * y; });
  mx /= sw; my /= sw;
  let d = 0;
  pts.forEach(([x, y], i) => { d += wts[i] * Math.hypot(x - mx, y - my); });
  const s = Math.SQRT2 / (d / sw || 1);
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

/** src → dst homografisi, ağırlıklı en küçük kareler (h33 = 1). */
export function fitH(src: [number, number][], dst: [number, number][], wts = src.map(() => 1)): H3 {
  const Ts = normalizer(src, wts);
  const Td = normalizer(dst, wts);
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const ATb = new Array(8).fill(0);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = applyH(Ts, ...src[i]);
    const [u, v] = applyH(Td, ...dst[i]);
    const w = wts[i];
    for (const [row, rhs] of [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ] as [number[], number][]) {
      for (let a = 0; a < 8; a++) {
        ATb[a] += w * row[a] * rhs;
        for (let b = 0; b < 8; b++) ATA[a][b] += w * row[a] * row[b];
      }
    }
  }
  const h = [...solve(ATA, ATb), 1];
  const H = mul(mul(invertH(Td), h), Ts);
  return H.map((v) => v / H[8]);
}

/** Belirleyici sözde-rastgele üreteç (tekrarlanabilir sonuç için). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * RANSAC (4 nokta) + inlier'larla en küçük kareler. `thr` dst biriminde inlier eşiği.
 */
export function fitHRansac(
  src: [number, number][],
  dst: [number, number][],
  thr: number,
  iters = 400,
): { H: H3; inliers: boolean[]; residuals: number[] } {
  const n = src.length;
  const rnd = lcg(12345);
  const resid = (H: H3) =>
    src.map((p, i) => {
      const [x, y] = applyH(H, ...p);
      return Math.hypot(x - dst[i][0], y - dst[i][1]);
    });
  let bestCount = -1;
  let bestScore = Infinity;
  let bestIn: boolean[] = [];
  for (let it = 0; it < iters; it++) {
    const idx = new Set<number>();
    while (idx.size < 4) idx.add(Math.floor(rnd() * n));
    const ids = [...idx];
    let H: H3;
    try {
      H = fitH(ids.map((i) => src[i]), ids.map((i) => dst[i]));
    } catch {
      continue;
    }
    const r = resid(H);
    const inl = r.map((v) => v < thr);
    const count = inl.filter(Boolean).length;
    const score = r.reduce((a, v) => a + Math.min(v, thr) ** 2, 0); // MSAC
    if (count > bestCount || (count === bestCount && score < bestScore)) {
      bestCount = count;
      bestScore = score;
      bestIn = inl;
    }
  }
  let inliers = bestIn;
  let H = fitH(src.filter((_, i) => inliers[i]), dst.filter((_, i) => inliers[i]));
  for (let k = 0; k < 3; k++) {
    const r = resid(H);
    inliers = r.map((v) => v < thr);
    H = fitH(src.filter((_, i) => inliers[i]), dst.filter((_, i) => inliers[i]));
  }
  return { H, inliers, residuals: resid(H) };
}

/** Huber ağırlıklı IRLS; artıklar dst biriminde. */
export function fitHRobust(
  src: [number, number][],
  dst: [number, number][],
  prior: number[] = src.map(() => 1),
  iters = 6,
): { H: H3; residuals: number[]; weights: number[] } {
  let wts = [...prior];
  let H = fitH(src, dst, wts);
  let residuals: number[] = [];
  for (let it = 0; it < iters; it++) {
    residuals = src.map((p, i) => {
      const [x, y] = applyH(H, ...p);
      return Math.hypot(x - dst[i][0], y - dst[i][1]);
    });
    const sorted = [...residuals].sort((a, b) => a - b);
    const sigma = 1.4826 * sorted[sorted.length >> 1] + 1e-9;
    const k = 2 * sigma;
    wts = residuals.map((r, i) => prior[i] * (r <= k ? 1 : r > 4 * k ? 0 : k / r));
    H = fitH(src, dst, wts);
  }
  return { H, residuals, weights: wts };
}
