// Dakika çizgisi halkası: kadrandaki 60 çizgiyi en iyi açıklayan afin elips.
// Model: p(t) = C + s · R(ψ) · (a cos t, a·q sin t). Afin izdüşümde dakika çizgileri t'de tam periyodiktir,
// bu yüzden halka boyunca örneklenen parlaklığın 60. harmoniğindeki enerji oranı amaç fonksiyonudur.

import { sample, type Gray } from './image';
import { nelderMead } from './optim';

export interface Ring {
  cx: number;
  cy: number;
  a: number; // büyük yarı eksen (px)
  q: number; // küçük/büyük eksen oranı (0..1]
  psi: number; // büyük eksen yönü (rad)
}

export interface RingFit extends Ring {
  energy: number; // 60. harmonik / toplam varyans, 0..1
  phase: number; // çizgilerin t fazı (rad, 60 ile çarpılmış açı biriminde)
  polarity: 1 | -1; // +1: çizgiler zeminden parlak
}

export function ringPoint(r: Ring, t: number, s = 1): [number, number] {
  const ex = r.a * Math.cos(t) * s;
  const ey = r.a * r.q * Math.sin(t) * s;
  const c = Math.cos(r.psi);
  const si = Math.sin(r.psi);
  return [r.cx + c * ex - si * ey, r.cy + si * ex + c * ey];
}

const TWO_PI = Math.PI * 2;

/** Halka boyunca `n` örnek (bant içinde radyal ortalama) ve 60. harmonik. */
export function ringEnergy(g: Gray, r: Ring, n = 720, band = [1]): { energy: number; re: number; im: number } {
  let sum = 0;
  let sum2 = 0;
  let re = 0;
  let im = 0;
  let cnt = 0;
  for (let j = 0; j < n; j++) {
    const t = (j / n) * TWO_PI;
    let v = 0;
    let k = 0;
    for (const s of band) {
      const [x, y] = ringPoint(r, t, s);
      const u = sample(g, x, y);
      if (u === u) {
        v += u;
        k++;
      }
    }
    if (k === 0) return { energy: 0, re: 0, im: 0 };
    v /= k;
    sum += v;
    sum2 += v * v;
    re += v * Math.cos(60 * t);
    im -= v * Math.sin(60 * t);
    cnt++;
  }
  const mean = sum / cnt;
  const varSum = sum2 - cnt * mean * mean;
  if (varSum <= 1e-9) return { energy: 0, re, im };
  // Parseval: tek harmoniğin varyans payı = 2|X|²/(N·Σ(v−μ)²)
  return { energy: (2 * (re * re + im * im)) / (cnt * varSum), re, im };
}

const BAND = [0.99, 1.0, 1.01];

function toParams(r: Ring): number[] {
  return [r.cx, r.cy, Math.log(r.a), r.q, r.psi];
}
function fromParams(p: number[]): Ring {
  return { cx: p[0], cy: p[1], a: Math.exp(p[2]), q: Math.min(1, Math.max(0.2, p[3])), psi: p[4] };
}

/** Bir merkez adayı etrafında kaba ızgara araması (240 örnek: 60. harmonik için yeterli). */
function gridSearch(g: Gray, cx: number, cy: number, best: { r: Ring; e: number }[], keep: number) {
  const L = Math.max(g.w, g.h);
  for (let q = 1; q >= 0.4; q -= 0.05) {
    const psiSteps = q > 0.97 ? 1 : 18;
    for (let k = 0; k < psiSteps; k++) {
      const psi = (k / psiSteps) * Math.PI;
      for (let a = 0.025 * L; a < 0.5 * L; a *= 1.045) {
        const r = { cx, cy, a, q, psi };
        const { energy } = ringEnergy(g, r, 240);
        if (best.length < keep || energy > best[best.length - 1].e) {
          best.push({ r, e: energy });
          best.sort((x, y) => y.e - x.e);
          if (best.length > keep) best.pop();
        }
      }
    }
  }
}

function refine(g: Gray, r0: Ring): RingFit {
  const f = (p: number[]) => -ringEnergy(g, fromParams(p), 720, BAND).energy;
  const step = [r0.a * 0.02, r0.a * 0.02, 0.02, 0.03, 0.08];
  let { x } = nelderMead(f, toParams(r0), step, { maxIter: 300 });
  ({ x } = nelderMead(f, x, step.map((s) => s * 0.3), { maxIter: 300 }));
  const r = fromParams(x);
  const { energy, re, im } = ringEnergy(g, r, 1440, BAND);
  return { ...r, energy, ...phaseOf(g, r, re, im) };
}

/**
 * Faz ve polarite: 60. harmoniğin açısı çizgi konumunu verir; çizgilerin zeminden parlak mı koyu mu
 * olduğu, bir periyotluk ortalama profilin çarpıklığından çıkar (dar yapı = çizgi).
 */
function phaseOf(g: Gray, r: Ring, re: number, im: number): { phase: number; polarity: 1 | -1 } {
  const phi = Math.atan2(-im, re); // v ≈ μ + A cos(60t − phi)
  const polarity: 1 | -1 = narrowIsPeak(g, r, phi) ? 1 : -1;
  return { phase: polarity === 1 ? phi : phi + Math.PI, polarity };
}

/** Tepe çevresi mi çukur çevresi mi daha "dar" (tepecikli)? Çizgi merkezi daha sivri uçtur. */
function narrowIsPeak(g: Gray, r: Ring, phi: number): boolean {
  // Bir periyot boyunca ortalama profil
  const M = 24;
  const prof = new Float64Array(M);
  for (let k = 0; k < 60; k++) {
    for (let m = 0; m < M; m++) {
      const t = (phi + k * TWO_PI + (m / M) * TWO_PI) / 60;
      for (const s of BAND) prof[m] += sample(g, ...ringPoint(r, t, s)) || 0;
    }
  }
  const mean = prof.reduce((a, b) => a + b, 0) / M;
  const sorted = [...prof].sort((a, b) => a - b);
  const median = sorted[M >> 1];
  // Parlak çizgi + koyu zemin: ortalama > medyan (sağa çarpık dağılım)
  return mean > median;
}

export function fitRing(g: Gray, centers: { x: number; y: number }[]): RingFit | null {
  const cands: { r: Ring; e: number }[] = [];
  for (const c of centers) gridSearch(g, c.x, c.y, cands, 4);
  let best: RingFit | null = null;
  for (const { r } of cands) {
    const fit = refine(g, r);
    if (!best || fit.energy > best.energy) best = fit;
  }
  return best;
}
