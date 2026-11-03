// Arka kamera akışı ve kare yakalama. Kare zamanı requestVideoFrameCallback metadata'sından alınır.

interface FrameMeta {
  captureTime?: number;
  expectedDisplayTime?: number;
  presentationTime?: number;
  width: number;
  height: number;
}

type RVFC = (cb: (now: number, meta: FrameMeta) => void) => number;

export interface Capture {
  blob: Blob;
  width: number;
  height: number;
  tDevice: number; // karenin cihaz saatine göre zamanı (epoch ms)
  timeSource: 'captureTime' | 'rvfc' | 'draw';
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 4032 },
      height: { ideal: 3024 },
      frameRate: { ideal: 30 },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement) {
  const s = video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** performance.now() zaman damgasını duvar saatine (Date.now ekseni) çevirir. */
function perfToWall(perfT: number): number {
  return Date.now() - (performance.now() - perfT);
}

function drawFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  return c;
}

async function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob başarısız'))), 'image/jpeg', 0.92));
}

/**
 * Bir sonraki kareyi yakalar. rVFC geri çağrısında çizilen kare, metadata'sı bilinen karedir.
 * captureTime (sensör zamanı) varsa o, yoksa geri çağrının `now` değeri kullanılır.
 */
export async function captureFrame(video: HTMLVideoElement): Promise<Capture> {
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  if (!rvfc) {
    const tDevice = Date.now();
    const c = drawFrame(video);
    return { blob: await toBlob(c), width: c.width, height: c.height, tDevice, timeSource: 'draw' };
  }
  const { canvas, tDevice, timeSource } = await new Promise<{
    canvas: HTMLCanvasElement;
    tDevice: number;
    timeSource: Capture['timeSource'];
  }>((resolve) => {
    rvfc((now, meta) => {
      const canvas = drawFrame(video);
      const ct = meta.captureTime;
      const sane = ct !== undefined && ct > 0 && Math.abs(now - ct) < 1000;
      resolve({
        canvas,
        tDevice: perfToWall(sane ? ct! : now),
        timeSource: sane ? 'captureTime' : 'rvfc',
      });
    });
  });
  return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height, tDevice, timeSource };
}
