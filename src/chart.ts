// Sapma–zaman grafiği (tek seri): noktalar + doğrusal uyum çizgisi, dokunarak/üzerine gelerek değer.

import type { Fit, Sample } from './stats';
import { fmtDate, fmtSigned, fmtTime } from './reading';

const W = 340;
const H = 190;
const M = { l: 38, r: 12, t: 10, b: 26 };
const DAY = 86_400_000;

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function renderChart(el: HTMLElement, samples: Sample[], fit: Fit | null) {
  el.innerHTML = '';
  if (samples.length === 0) {
    el.innerHTML = '<p class="muted small">Henüz ölçüm yok.</p>';
    return;
  }
  const t0 = samples[0].tTrue;
  const t1 = Math.max(samples[samples.length - 1].tTrue, t0 + DAY / 24);
  let yMin = Math.min(0, ...samples.map((s) => s.drift));
  let yMax = Math.max(0, ...samples.map((s) => s.drift));
  if (yMax - yMin < 1) {
    yMax += 0.5;
    yMin -= 0.5;
  }
  const step = niceStep(yMax - yMin, 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;

  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => M.t + ((yMax - v) / (yMax - yMin)) * (H - M.t - M.b);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Sapmanın zamana göre değişimi');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.appendChild(e);
    return e;
  };

  // Izgara + y ekseni etiketleri
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    const yy = y(v);
    const zero = Math.abs(v) < 1e-9;
    add('line', {
      x1: M.l,
      x2: W - M.r,
      y1: yy,
      y2: yy,
      stroke: zero ? '#5d6b61' : '#27322b',
      'stroke-width': 1,
    });
    add('text', { x: M.l - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#95a198' }, Math.abs(v) < 1e-9 ? '0' : fmtSigned(v, step < 1 ? 1 : 0));
  }
  // x ekseni: başlangıç ve bitiş tarihi
  add('text', { x: M.l, y: H - 6, 'font-size': 11, fill: '#95a198' }, fmtDate(t0));
  add('text', { x: W - M.r, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#95a198' }, fmtDate(t1));

  const clipId = `plot-${Math.random().toString(36).slice(2)}`;
  const defs = add('defs', {});
  const clip = document.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', clipId);
  const rect = document.createElementNS(ns, 'rect');
  for (const [k, v] of Object.entries({ x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b }))
    rect.setAttribute(k, String(v));
  clip.appendChild(rect);
  defs.appendChild(clip);

  if (fit) {
    const d1 = (t1 - t0) / DAY;
    add('line', {
      'clip-path': `url(#${clipId})`,
      x1: x(t0),
      y1: y(fit.intercept),
      x2: x(t1),
      y2: y(fit.intercept + fit.rate * d1),
      stroke: '#3fae78',
      'stroke-width': 2,
      'stroke-linecap': 'round',
    });
  }
  const dots = samples.map((s) =>
    add('circle', { cx: x(s.tTrue), cy: y(s.drift), r: 4.5, fill: '#ecefe9', stroke: '#182019', 'stroke-width': 2 }),
  );
  el.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  el.appendChild(tip);

  const pick = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    samples.forEach((s, i) => {
      if (Math.abs(x(s.tTrue) - px) < Math.abs(x(samples[best].tTrue) - px)) best = i;
    });
    const s = samples[best];
    dots.forEach((d, i) => d.setAttribute('r', i === best ? '6.5' : '4.5'));
    tip.hidden = false;
    tip.textContent = `${fmtDate(s.tTrue)} ${fmtTime(s.tTrue, 0)} · ${fmtSigned(s.drift, 1, ' s')}`;
    tip.style.left = `${(x(s.tTrue) / W) * r.width}px`;
    tip.style.top = `${(y(s.drift) / H) * r.height}px`;
  };
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    dots.forEach((d) => d.setAttribute('r', '4.5'));
  });
}
