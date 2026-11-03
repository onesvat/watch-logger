// Drift series and daily rate (s/day).

export interface Sample {
  tTrue: number; // epoch ms
  drift: number; // s
  reset?: boolean; // watch was set right before this measurement → a new series starts
}

export interface Fit {
  rate: number; // s/day
  intercept: number; // drift at the first measurement (s)
  residualStd: number; // s
  rateErr: number; // s/day, standard error of the slope (n>2)
  n: number;
  spanDays: number;
}

const DAY = 86_400_000;

export function segments<T extends Sample>(samples: T[]): T[][] {
  const sorted = [...samples].sort((a, b) => a.tTrue - b.tTrue);
  const out: T[][] = [];
  for (const s of sorted) {
    if (s.reset || out.length === 0) out.push([]);
    out[out.length - 1].push(s);
  }
  return out;
}

export function linearFit(samples: Sample[]): Fit | null {
  const n = samples.length;
  if (n < 2) return null;
  const t0 = samples[0].tTrue;
  const xs = samples.map((s) => (s.tTrue - t0) / DAY);
  const ys = samples.map((s) => s.drift);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const rate = sxy / sxx;
  const intercept = my - rate * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + rate * xs[i])) ** 2;
  const residualStd = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const rateErr = n > 2 ? residualStd / Math.sqrt(sxx) : NaN;
  return { rate, intercept, residualStd, rateErr, n, spanDays: xs[n - 1] - xs[0] };
}

/** Rates between consecutive measurements (s/day). Measurements closer than minHours are skipped. */
export function pairRates(samples: Sample[], minHours = 6): { from: number; to: number; rate: number }[] {
  const out: { from: number; to: number; rate: number }[] = [];
  let prev: Sample | undefined;
  for (const s of samples) {
    if (prev && s.tTrue - prev.tTrue >= minHours * 3_600_000) {
      out.push({ from: prev.tTrue, to: s.tTrue, rate: (s.drift - prev.drift) / ((s.tTrue - prev.tTrue) / DAY) });
      prev = s;
    } else if (!prev) prev = s;
  }
  return out;
}
