import type { OverlayTransform } from '../types/project';

export function drawComposite(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  overlay: CanvasImageSource | undefined,
  transform: OverlayTransform,
): void {
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  if (!overlay) return;

  const overlaySize = overlay as CanvasImageSource & { width: number; height: number };
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, transform.opacity));
  context.translate(transform.x, transform.y);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.scale(transform.scale, transform.scale);
  context.drawImage(overlay, -overlaySize.width / 2, -overlaySize.height / 2);
  context.restore();
}
