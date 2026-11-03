// Auto-read: sends the image to the worker and draws the result overlay.

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

/**
 * Overlay in image coordinates: minute ring, 12 direction and the three hands for `todSeconds`
 * (the time currently in the input, so the drawing follows manual edits). `px` = 1 screen pixel.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, o: AutoOverlay, px: number, todSeconds: number | null) {
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
  ctx.lineJoin = 'round';
  // Circle through the inner ends of the minute ticks
  poly(
    [...Array(241).keys()].map((i) => P(Math.cos((i / 240) * 2 * Math.PI), Math.sin((i / 240) * 2 * Math.PI))),
    'rgba(63,174,120,0.7)',
    1.5,
  );
  // 12 direction
  const c12 = Math.cos(o.theta12);
  const s12 = Math.sin(o.theta12);
  poly([P(0.9 * c12, 0.9 * s12), P(1.08 * c12, 1.08 * s12)], '#d9a441', 4);

  if (todSeconds !== null) {
    // Dial angle grows clockwise from the 12 direction (same convention as the reader).
    const t = ((todSeconds % 43200) + 43200) % 43200;
    const hand = (frac: number, from: number, to: number, color: string, width: number) => {
      const a = o.theta12 + frac * 2 * Math.PI;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const pts: [number, number][] = [P(from * ux, from * uy), P(to * ux, to * uy)];
      poly(pts, 'rgba(0,0,0,0.6)', width + 2); // dark halo for contrast on any dial
      poly(pts, color, width);
    };
    hand(t / 43200, -0.08, 0.55, 'rgba(255,255,255,0.85)', 5); // hour
    hand((t % 3600) / 3600, -0.1, 0.88, 'rgba(255,255,255,0.85)', 3.5); // minute
    hand((t % 60) / 60, -0.25, 0.97, '#ff4d6d', 1.5); // seconds
    const [cx, cy] = P(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * px, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff4d6d';
    ctx.fill();
  }
  ctx.restore();
}
