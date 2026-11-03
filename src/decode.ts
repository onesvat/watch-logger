// Görüntü çözme. HEIC'i tarayıcı açamıyorsa (Safari dışı) heic-to (güncel libheif) ile JPEG'e çevirir.

export async function decodeImage(blob: Blob): Promise<{ bitmap: ImageBitmap; jpeg: Blob }> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { bitmap, jpeg: blob };
  } catch {
    const { heicTo } = await import('heic-to');
    const jpeg = await heicTo({ blob, type: 'image/jpeg', quality: 0.92 });
    const bitmap = await createImageBitmap(jpeg, { imageOrientation: 'from-image' });
    return { bitmap, jpeg };
  }
}
