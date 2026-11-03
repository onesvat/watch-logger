// Kadran düzlemi: 60 dakika çizgisini tam çözünürlükte tek tek konumlar, homografi uydurur.
// Kadran koordinatları: dakika çizgisi iç uçları birim çember üzerinde; k. çizgi θ = 2πk/60'da
// (görüntüde t ile aynı dönüş yönü). 12'nin hangi çizgi olduğu burada bilinmez.

import { sample, type Gray } from './image';
import { applyH, fitHRansac, invertH, type H3 } from './homography';
import { ringEnergy, ringPoint, type RingFit } from './ring';

export interface DialFit {
  H: H3; // kadran → görüntü
  Hinv: H3; // görüntü → kadran
  sIn: number; // çizgi iç ucunun halka ölçeğindeki konumu
  sOut: number;
  ticks: { k: number; img: [number, number]; weight: number; residual: number }[];
  rmsPx: number;
  polarity: 1 | -1;
}

const TWO_PI = Math.PI * 2;

export function scaleRing(r: RingFit, f: number): RingFit {
  return { ...r, cx: r.cx * f, cy: r.cy * f, a: r.a * f };
}

/** Dakika çizgilerinin radyal bandı: 60. harmonik enerjisinin yarı-tepe genişliği. */
function tickBand(g: Gray, r: RingFit): [number, number] {
  const ss: number[] = [];
  const es: number[] = [];
  for (let s = 0.8; s <= 1.15; s += 0.004) {
    ss.push(s);
    es.push(ringEnergy(g, r, 1440, [s]).energy);
  }
  let m = 0;
  for (let i = 1; i < es.length; i++) if (es[i] > es[m]) m = i;
  const half = es[m] * 0.5;
  let lo = m;
  let hi = m;
  while (lo > 0 && es[lo - 1] > half) lo--;
  while (hi < es.length - 1 && es[hi + 1] > half) hi++;
  return [ss[lo], ss[hi]];
}

type DialMap = (theta: number, rho: number) => [number, number];

interface TickObs {
  k: number;
  img: [number, number];
  peak: number;
}

/**
 * k. dakika çizgisini `map` ile verilen (θ, ρ) kadran koordinatlarında örnekleyerek bulur:
 * açısal konum = zemin çıkarılmış ağırlık merkezi, radyal = iç ucun yarı-kontrast geçişi.
 */
function localizeTick(g: Gray, map: DialMap, k: number, r0: number, r1: number, pol: number): TickObs | null {
  const period = TWO_PI / 60;
  const tk = k * period;
  const NS = 10;
  const M = 30;
  const prof: number[] = [];
  for (let m = -M; m <= M; m++) {
    const t = tk + (m / M) * (period / 2);
    let v = 0;
    for (let j = 0; j < NS; j++) v += sample(g, ...map(t, r0 + ((r1 - r0) * (j + 0.5)) / NS)) || 0;
    prof.push((pol * v) / NS);
  }
  const sorted = [...prof].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.3)];
  const peak = sorted[sorted.length - 1] - bg;
  if (!(peak > 0)) return null;
  let sw = 0;
  let sm = 0;
  for (let i = 0; i < prof.length; i++) {
    const v = prof[i] - bg - 0.35 * peak; // yalnız çizginin gövdesi
    if (v > 0) {
      sw += v;
      sm += v * (i - M);
    }
  }
  if (sw <= 0) return null;
  const t = tk + (sm / sw / M) * (period / 2);

  const bgR = (r: number) =>
    pol * 0.5 * ((sample(g, ...map(t - period / 2, r)) || 0) + (sample(g, ...map(t + period / 2, r)) || 0));
  const span = r1 - r0;
  const rs: number[] = [];
  const rv: number[] = [];
  for (let r = r0 - span; r <= r1; r += span / 60) {
    rs.push(r);
    rv.push(pol * (sample(g, ...map(t, r)) || 0) - bgR(r));
  }
  const vmax = Math.max(...rv.slice(rv.length >> 1));
  let rIn = NaN;
  for (let i = 1; i < rv.length; i++) {
    if (rv[i - 1] < vmax / 2 && rv[i] >= vmax / 2) {
      rIn = rs[i - 1] + ((vmax / 2 - rv[i - 1]) / (rv[i] - rv[i - 1])) * (rs[i] - rs[i - 1]);
    }
    if (rs[i] > (r0 + r1) / 2) break;
  }
  if (!Number.isFinite(rIn)) return null;
  return { k, img: map(t, rIn), peak };
}

export function fitDial(g: Gray, ring: RingFit): DialFit {
  const pol = ring.polarity;
  const [b0, b1] = tickBand(g, ring);
  const unit = (k: number): [number, number] => [Math.cos((k * TWO_PI) / 60), Math.sin((k * TWO_PI) / 60)];

  // Aşama 0: afin halka üzerinden ilk tahmin
  const ringMap: DialMap = (t, r) => ringPoint(ring, t + ring.phase / 60, r);
  let obs = [...Array(60).keys()].map((k) => localizeTick(g, ringMap, k, b0, b1, pol)).filter((o) => o !== null);
  if (obs.length < 12) throw new Error(`Yetersiz dakika çizgisi (${obs.length})`);
  const thr0 = Math.max(2, 0.006 * ring.a);
  let fit = fitHRansac(obs.map((o) => unit(o.k)), obs.map((o) => o.img), thr0);

  // Aşama 1..3: homografinin öngördüğü konumlarda tüm çizgileri yeniden bul
  const len = (b1 - b0) / b0;
  for (const f of [1, 0.6, 0.45]) {
    const H = fit.H;
    const hMap: DialMap = (t, r) => applyH(H, r * Math.cos(t), r * Math.sin(t));
    obs = [...Array(60).keys()].map((k) => localizeTick(g, hMap, k, 1, 1 + len, pol)).filter((o) => o !== null);
    fit = fitHRansac(obs.map((o) => unit(o.k)), obs.map((o) => o.img), Math.max(1.2, thr0 * f));
  }

  const { H, residuals, inliers } = fit;
  const used = residuals.filter((_, i) => inliers[i]);
  const rmsPx = Math.sqrt(used.reduce((a, r) => a + r * r, 0) / used.length);
  return {
    H,
    Hinv: invertH(H),
    sIn: b0,
    sOut: b1,
    ticks: obs.map((o, i) => ({ k: o.k, img: o.img, weight: inliers[i] ? 1 : 0, residual: residuals[i] })),
    rmsPx,
    polarity: pol,
  };
}

/** Kadran koordinatlarından (birim = çizgi iç ucu) düzleştirilmiş kare görüntü. */
export function rectify(g: Gray, H: H3, size: number, extent = 1.15): Gray {
  const out = { w: size, h: size, data: new Float32Array(size * size) };
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * 2 * extent - extent;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 * extent - extent;
      const [ix, iy] = applyH(H, u, v);
      const s = sample(g, ix, iy);
      out.data[y * size + x] = s === s ? s : 0;
    }
  }
  return out;
}
