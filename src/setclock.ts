// "Saati kur": bir sonraki tam 5 dakikaya geri sayım ve sinyal sesleri.

export const SET_STEP_MS = 5 * 60_000;
export const SET_MIN_LEAD_MS = 60_000; // ibreleri ayarlamak için en az bu kadar zaman
export const PIP_COUNT = 5; // hedeften önceki kısa bip sayısı (son 5 s)

/** Gerçek zamandan en az `minLeadMs` sonraki ilk tam 5 dakika (yerel saat dilimi 15 dk katı varsayılır). */
export function nextSetTarget(trueNow: number, minLeadMs = SET_MIN_LEAD_MS): number {
  return Math.ceil((trueNow + minLeadMs) / SET_STEP_MS) * SET_STEP_MS;
}

/** Kalan süre → "m:ss" (1 dk altında yalnızca saniye), yukarı yuvarlanır. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type NowTrue = () => number; // gerçek zaman (epoch ms) = Date.now() + ofset

/**
 * Bipleri Web Audio saatine göre önceden planlar; böylece setTimeout/rAF titremesi olmadan
 * hoparlörden çıkış anı gerçek zamana birkaç ms içinde oturur.
 */
export class Pips {
  private ctx: AudioContext | null = null;
  private nodes: OscillatorNode[] = [];

  /** Kullanıcı dokunuşu içinde çağrılmalı (iOS ses kilidi). Kısa bir onay sesi çalar. */
  async unlock(): Promise<boolean> {
    // iOS 17+: sessiz anahtarı açıkken de çal.
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* desteklenmiyor */
      }
    }
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
    this.tone(this.ctx.currentTime + 0.02, 660, 0.06, 0.25);
    return this.ctx.state === 'running';
  }

  /** Gerçek zaman `tTrue` anına karşılık gelen, hoparlörden duyulacak AudioContext zamanı. */
  private ctxTimeAt(tTrue: number, nowTrue: NowTrue): number {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime) {
      // ts: contextTime örneği performanceTime anında çıkıştan duyuluyor.
      const trueAtTs = nowTrue() + (ts.performanceTime - performance.now());
      return ts.contextTime + (tTrue - trueAtTs) / 1000;
    }
    const lat = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime + (tTrue - nowTrue()) / 1000 - lat;
  }

  /** Hedeften önceki her saniyede kısa, hedefte uzun bip. */
  schedule(target: number, nowTrue: NowTrue) {
    if (!this.ctx) return;
    this.cancel();
    const now = this.ctx.currentTime;
    for (let i = PIP_COUNT; i >= 0; i--) {
      const at = this.ctxTimeAt(target - i * 1000, nowTrue);
      if (at < now) continue;
      if (i === 0) this.tone(at, 1500, 0.6, 0.8);
      else this.tone(at, 1000, 0.1, 0.6);
    }
  }

  cancel() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* zaten durdu */
      }
    }
    this.nodes = [];
  }

  close() {
    this.cancel();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private tone(at: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    // Başlangıç rampası 2 ms: tık sesini önler, başlangıç anını kaydırmaz.
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.setValueAtTime(gain, at + dur - 0.015);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.01);
    this.nodes.push(o);
    o.onended = () => (this.nodes = this.nodes.filter((n) => n !== o));
  }
}
