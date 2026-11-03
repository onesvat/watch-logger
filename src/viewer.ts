// Photo viewer: drag, pinch to zoom, double-tap for 3×, mouse wheel.

export class Viewer {
  private ctx: CanvasRenderingContext2D;
  private img: ImageBitmap | null = null;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap = 0;
  private touched = false; // has the user zoomed/panned
  private overlay: ((ctx: CanvasRenderingContext2D, px: number) => void) | null = null;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  /** Overlay drawn in image coordinates; `px` = size of one screen pixel in image pixels. */
  setOverlay(fn: ((ctx: CanvasRenderingContext2D, px: number) => void) | null) {
    this.overlay = fn;
    this.draw();
  }

  setImage(img: ImageBitmap) {
    this.img = img;
    this.overlay = null;
    this.touched = false;
    this.resize();
  }

  fit() {
    if (!this.img) return;
    const { width: w, height: h } = this.cssSize();
    this.scale = Math.min(w / this.img.width, h / this.img.height);
    this.tx = (w - this.img.width * this.scale) / 2;
    this.ty = (h - this.img.height * this.scale) / 2;
    this.draw();
  }

  private cssSize() {
    const r = this.canvas.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.cssSize();
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (!this.touched) this.fit();
    else this.draw();
  }

  private draw() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.img) return;
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.tx, dpr * this.ty);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, 0, 0);
    this.overlay?.(ctx, 1 / this.scale);
  }

  private zoomAt(x: number, y: number, factor: number) {
    if (!this.img) return;
    const { width } = this.cssSize();
    const min = Math.min(0.5, width / this.img.width);
    const next = Math.min(Math.max(this.scale * factor, min), 8);
    const f = next / this.scale;
    this.tx = x - (x - this.tx) * f;
    this.ty = y - (y - this.ty) * f;
    this.scale = next;
    this.draw();
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.touched = true;
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 1) {
      const now = performance.now();
      if (now - this.lastTap < 300) {
        const p = this.local(e);
        this.zoomAt(p.x, p.y, 3);
        this.lastTap = 0;
      } else this.lastTap = now;
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = this.local(e);
    if (this.pointers.size === 1) {
      this.tx += cur.x - prev.x;
      this.ty += cur.y - prev.y;
      this.pointers.set(e.pointerId, cur);
      this.draw();
      return;
    }
    const others = [...this.pointers.entries()].filter(([id]) => id !== e.pointerId);
    const other = others[0][1];
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
    const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
    this.pointers.set(e.pointerId, cur);
    // Midpoint pan + zoom
    this.tx += (cur.x - prev.x) / 2;
    this.ty += (cur.y - prev.y) / 2;
    if (d0 > 0) this.zoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d1 / d0);
    else this.draw();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.touched = true;
    const p = this.local(e);
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.002));
  };
}
