// Otomatik okuma: görüntüyü worker'a gönderir; sonuç için kaplama (overlay) çizer.

import { applyH } from './cv/homography';
import type { AutoOverlay, AutoRequest, AutoResponse, AutoResult } from './cv/protocol';

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./cv/worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export function autoRead(
  bitmap: ImageBitmap,
  refTodSeconds: number,
  datePosition: number,
  onProgress: (stage: string) => void,
): Promise<AutoResult> {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<AutoResponse>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.stage);
      else {
        w.removeEventListener('message', onMsg);
        if (m.type === 'result') resolve(m.result);
        else reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMsg);
    const req: AutoRequest = { id, w: c.width, h: c.height, rgba: data.buffer, refTodSeconds, datePosition };
    w.postMessage(req, [data.buffer]);
  });
}

/** Görüntü koordinatlarında kaplama: dakika halkası, 12 yönü, ibre çizgileri. `px` = 1 ekran pikseli. */
export function drawOverlay(ctx: CanvasRenderingContext2D, o: AutoOverlay, px: number) {
  const P = (u: number, v: number) => applyH(o.H, u, v);
  const poly = (pts: [number, number][], color: string, width: number) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width * px;
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  // Dakika çizgisi iç uçları çemberi
  poly(
    [...Array(241).keys()].map((i) => P(Math.cos((i / 240) * 2 * Math.PI), Math.sin((i / 240) * 2 * Math.PI))),
    'rgba(63,174,120,0.7)',
    1.5,
  );
  // 12 yönü
  const c12 = Math.cos(o.theta12);
  const s12 = Math.sin(o.theta12);
  poly([P(0.9 * c12, 0.9 * s12), P(1.08 * c12, 1.08 * s12)], '#d9a441', 4);
  for (const l of o.lines) {
    const ux = Math.cos(l.phi);
    const uy = Math.sin(l.phi);
    const nx = -uy;
    const ny = ux;
    const at = (s: number) => P(l.d * nx + s * ux, l.d * ny + s * uy);
    if (l.name === 'sec*') poly([at(-0.25), at(0.95)], '#ff4d6d', 1.5);
    else poly([at(0.1), at(l.name === 'akrep' ? 0.55 : 0.85)], 'rgba(255,255,255,0.55)', 2);
  }
  ctx.restore();
}
