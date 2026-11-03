// "Set the watch": countdown to the next full 5 minutes with time pips.

export const SET_STEP_MS = 5 * 60_000;
export const SET_MIN_LEAD_MS = 60_000; // at least this much time to set the hands
export const PIP_COUNT = 10; // short pips before the target (last 10 s)

/** First full 5 minutes at least `minLeadMs` after true time (assumes the local UTC offset is a multiple of 15 min). */
export function nextSetTarget(trueNow: number, minLeadMs = SET_MIN_LEAD_MS): number {
  return Math.ceil((trueNow + minLeadMs) / SET_STEP_MS) * SET_STEP_MS;
}

/** Remaining time → "m:ss" (seconds only below 1 min), rounded up. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type NowTrue = () => number; // true time (epoch ms) = Date.now() + offset

/**
 * Schedules pips ahead of time on the Web Audio clock, so the speaker output lands within a few ms
 * of true time without setTimeout/rAF jitter.
 */
export class Pips {
  private ctx: AudioContext | null = null;
  private nodes: OscillatorNode[] = [];

  /** Must be called inside a user gesture (iOS audio unlock). Plays a short confirmation tone. */
  async unlock(): Promise<boolean> {
    // iOS 17+: play even when the silent switch is on.
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* not supported */
      }
    }
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
    this.tone(this.ctx.currentTime + 0.02, 660, 0.06, 0.25);
    return this.ctx.state === 'running';
  }

  /** AudioContext time at which a sound is heard from the speaker at true time `tTrue`. */
  private ctxTimeAt(tTrue: number, nowTrue: NowTrue): number {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime) {
      // ts: the contextTime sample is heard at the output at performanceTime.
      const trueAtTs = nowTrue() + (ts.performanceTime - performance.now());
      return ts.contextTime + (tTrue - trueAtTs) / 1000;
    }
    const lat = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime + (tTrue - nowTrue()) / 1000 - lat;
  }

  /** A short pip every second before the target, a long one at the target. */
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
        /* already stopped */
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
    // 2 ms attack ramp: avoids a click without shifting the onset.
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
