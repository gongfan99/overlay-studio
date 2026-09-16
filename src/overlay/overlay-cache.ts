import type { OverlaySequence } from '../types/project';

export class OverlayBitmapCache {
  private readonly bitmaps = new Map<number, ImageBitmap>();

  constructor(private readonly sequence: OverlaySequence, private readonly capacity = 7) {}

  async get(index: number): Promise<ImageBitmap | undefined> {
    const frame = this.sequence.frames[index];
    if (!frame) return undefined;

    const cached = this.bitmaps.get(index);
    if (cached) {
      this.bitmaps.delete(index);
      this.bitmaps.set(index, cached);
      return cached;
    }

    const bitmap = await createImageBitmap(frame.blob);
    this.bitmaps.set(index, bitmap);
    while (this.bitmaps.size > this.capacity) {
      const oldest = this.bitmaps.keys().next().value;
      if (oldest === undefined) break;
      this.bitmaps.get(oldest)?.close();
      this.bitmaps.delete(oldest);
    }
    return bitmap;
  }

  close(): void {
    for (const bitmap of this.bitmaps.values()) bitmap.close();
    this.bitmaps.clear();
  }
}
