// End-to-end reading on sample photos; drift and consistency relative to EXIF time.
import { readFileSync } from 'node:fs';
import { downscale, fromU8 } from '../src/cv/image';
import { readWatch } from '../src/cv/read';
import { rectify } from '../src/cv/dial';
import { writeFileSync } from 'node:fs';
import { readExifTime } from '../src/exif';

const RAW = process.env.RAW!;
const fmt = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const drifts: number[] = [];
for (const n of process.argv.slice(2)) {
  const exif = (await readExifTime(new Uint8Array(readFileSync(`IMG_${n}.HEIC`))))!;
  const d = new Date(exif.ms);
  const ref = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  const [w, h] = readFileSync(`${RAW}/${n}.size`, 'utf8').trim().split(' ').map(Number);
  const F = Number(process.env.SCALE ?? 1);
  const full0 = fromU8(new Uint8Array(readFileSync(`${RAW}/${n}.gray`)), w, h);
  const full = F > 1 ? downscale(full0, F) : full0;
  try {
    const r = readWatch(full, { refTodSeconds: ref });
    const drift = r.todSeconds - ref;
    drifts.push(drift);
    const tot = Object.values(r.diag.timings).reduce((a, b) => a + b, 0);
    console.log(`${n} ref ${fmt(ref)}  watch ${fmt(r.todSeconds)}  drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} s  conf ${r.confidence.toFixed(2)}  ` +
      `ticks ${r.diag.ticksUsed} rms ${r.diag.tickRmsPx.toFixed(2)}px  sec σ ${(r.diag.secondsResidual * 1000).toFixed(2)}e-3 n=${r.diag.secondsPoints}  ` +
      `hour ${r.diag.hourResidualDeg.toFixed(2)}° min ${r.diag.minuteResidualDeg.toFixed(2)}° 12margin ${r.diag.orientMargin.toFixed(2)}  ${tot}ms ${r.warnings.join('; ')}`);
    console.log('     ', r.diag.lines.map((l) => `${l.name}:${((l.phi * 180) / Math.PI).toFixed(1)}°`).join(' '), ` 12=${((r.diag.theta12 * 180) / Math.PI).toFixed(0)}°`);
    // Visual: rectified dial + detected lines
    const S = 1000, E = 1.1;
    const rect = rectify(full, r.dial.H, S, E);
    const u8 = new Uint8Array(S * S);
    for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, rect.data[i] * 255));
    const put = (u: number, v: number, val: number) => {
      const x = Math.round(((u + E) / (2 * E)) * S), y = Math.round(((v + E) / (2 * E)) * S);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < S && y + dy < S) u8[(y + dy) * S + x + dx] = val;
    };
    r.diag.lines.forEach((l, i) => {
      const off = l.name === 'sec*' ? 0.02 : 0.012;
      for (let s = -0.3; s < 1.0; s += 0.004) {
        const nx = -Math.sin(l.phi), ny = Math.cos(l.phi);
        if (i % 2 === 0 || l.name === 'sec*') put(nx * (l.d + off) + s * Math.cos(l.phi), ny * (l.d + off) + s * Math.sin(l.phi), l.name.startsWith('lume') ? 255 : l.name === 'sec*' ? 0 : 128);
      }
    });
    for (let s = 0.3; s < 1.08; s += 0.004) put(s * Math.cos(r.diag.theta12), s * Math.sin(r.diag.theta12), 255);
    writeFileSync(`${process.env.OUT}/${n}-read.pgm`, Buffer.concat([Buffer.from(`P5\n${S} ${S}\n255\n`), Buffer.from(u8)]));
  } catch (e) {
    console.log(`${n} ERROR ${(e as Error).message}`);
  }
}
if (drifts.length > 1) {
  const m = drifts.reduce((a, b) => a + b, 0) / drifts.length;
  const sd = Math.sqrt(drifts.reduce((a, b) => a + (b - m) ** 2, 0) / (drifts.length - 1));
  console.log(`mean drift ${m.toFixed(3)} s, std ${sd.toFixed(3)} s, range ${(Math.max(...drifts) - Math.min(...drifts)).toFixed(3)} s`);
}
