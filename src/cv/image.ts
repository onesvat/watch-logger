// Gri tonlu kayan noktalı görüntü ve temel işlemler (DOM'dan bağımsız; worker ve node'da çalışır).

export interface Gray {
  w: number;
  h: number;
  data: Float32Array; // 0..1
}

export function gray(w: number, h: number): Gray {
  return { w, h, data: new Float32Array(w * h) };
}

/** RGBA (ImageData.data) → gri (Rec. 709 luma). */
export function fromRGBA(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const g = gray(w, h);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    g.data[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
  }
  return g;
}

export function fromU8(u8: Uint8Array, w: number, h: number): Gray {
  const g = gray(w, h);
  for (let i = 0; i < g.data.length; i++) g.data[i] = u8[i] / 255;
  return g;
}

/** Tam sayı faktörüyle kutu filtreli küçültme. */
export function downscale(src: Gray, f: number): Gray {
  const w = Math.floor(src.w / f);
  const h = Math.floor(src.h / f);
  const out = gray(w, h);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * src.w + x * f;
        for (let dx = 0; dx < f; dx++) s += src.data[row + dx];
      }
      out.data[y * w + x] = s * inv;
    }
  }
  return out;
}

/** Çift doğrusal örnekleme; dışarısı NaN. */
export function sample(g: Gray, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x <= g.w - 1 && y <= g.h - 1)) return NaN;
  const x0 = Math.min(Math.floor(x), g.w - 2);
  const y0 = Math.min(Math.floor(y), g.h - 2);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * g.w + x0;
  const d = g.data;
  return (
    (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.w] * (1 - fx) + d[i + g.w + 1] * fx) * fy
  );
}

/** Ayrılabilir Gauss bulanıklaştırma. */
export function blur(src: Gray, sigma: number): Gray {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let ks = 0;
  for (let i = -r; i <= r; i++) ks += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const { w, h } = src;
  const tmp = gray(w, h);
  const out = gray(w, h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += src.data[row + xx] * k[i + r];
      }
      tmp.data[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp.data[yy * w + x] * k[i + r];
      }
      out.data[y * w + x] = s;
    }
  }
  return out;
}

/** Sobel gradyanı. */
export function gradient(g: Gray): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const { w, h, data: d } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1];
      const l = d[i - 1], r = d[i + 1];
      const e = d[i + w - 1], f = d[i + w], k = d[i + w + 1];
      const vx = c + 2 * r + k - (a + 2 * l + e);
      const vy = e + 2 * f + k - (a + 2 * b + c);
      gx[i] = vx;
      gy[i] = vy;
      mag[i] = Math.hypot(vx, vy);
    }
  }
  return { gx, gy, mag };
}
