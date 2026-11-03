// Derivative-free local optimisation (Nelder–Mead), minimisation.

export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  step: number[],
  { maxIter = 400, tol = 1e-7 } = {},
): { x: number[]; fx: number } {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))];
  let vals = pts.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const lerp = (a: number[], b: number[], t: number) => a.map((v, j) => v + t * (b[j] - v));
    const xr = lerp(c, pts[n], -1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = lerp(c, pts[n], -2);
      const fe = f(xe);
      [pts[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [xr, fr];
    } else {
      const xc = fr < vals[n] ? lerp(c, pts[n], -0.5) : lerp(c, pts[n], 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) [pts[n], vals[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          pts[i] = lerp(pts[0], pts[i], 0.5);
          vals[i] = f(pts[i]);
        }
      }
    }
  }
  let b = 0;
  for (let i = 1; i <= n; i++) if (vals[i] < vals[b]) b = i;
  return { x: pts[b], fx: vals[b] };
}
