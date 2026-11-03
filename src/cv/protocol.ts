// Ana iş parçacığı ↔ okuma worker'ı mesajları ve saklanan otomatik okuma sonucu.

import type { H3 } from './homography';

export interface AutoOverlay {
  H: H3; // kadran → görüntü
  theta12: number;
  lines: { name: string; phi: number; d: number }[]; // 'yelkovan' | 'akrep' | 'sec*'
}

export interface AutoResult {
  todSeconds: number;
  seconds: number;
  confidence: number;
  warnings: string[];
  overlay: AutoOverlay;
  diag: {
    ticksUsed: number;
    tickRmsPx: number;
    secondsResidual: number;
    minuteResidualDeg: number;
    timings: Record<string, number>;
  };
}

export interface AutoRequest {
  id: number;
  w: number;
  h: number;
  rgba: ArrayBuffer;
  refTodSeconds: number;
  datePosition: number;
}

export type AutoResponse =
  | { id: number; type: 'progress'; stage: string }
  | { id: number; type: 'result'; result: AutoResult }
  | { id: number; type: 'error'; message: string };
