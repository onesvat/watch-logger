// Otomatik okuma Web Worker'ı: RGBA piksel alır, readWatch çalıştırır, ilerleme ve sonuç gönderir.

import { fromRGBA } from './image';
import { readWatch } from './read';
import type { AutoRequest, AutoResponse } from './protocol';

self.onmessage = (ev: MessageEvent<AutoRequest>) => {
  const { id, w, h, rgba, refTodSeconds, datePosition } = ev.data;
  const post = (m: AutoResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const g = fromRGBA(new Uint8ClampedArray(rgba), w, h);
    const r = readWatch(g, {
      refTodSeconds,
      datePosition,
      onProgress: (stage) => post({ id, type: 'progress', stage }),
    });
    post({
      id,
      type: 'result',
      result: {
        todSeconds: r.todSeconds,
        seconds: r.seconds,
        confidence: r.confidence,
        warnings: r.warnings,
        overlay: {
          H: r.dial.H,
          theta12: r.diag.theta12,
          lines: r.diag.lines.filter((l) => !l.name.startsWith('sec') || l.name === 'sec*'),
        },
        diag: {
          ticksUsed: r.diag.ticksUsed,
          tickRmsPx: r.diag.tickRmsPx,
          secondsResidual: r.diag.secondsResidual,
          minuteResidualDeg: r.diag.minuteResidualDeg,
          timings: r.diag.timings,
        },
      },
    });
  } catch (e) {
    post({ id, type: 'error', message: (e as Error).message });
  }
};
