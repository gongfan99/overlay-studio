import type { OverlayTransform, TransformKeyframe } from '../types/project';

export const DEFAULT_TRANSFORM: OverlayTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

function interpolateAngle(start: number, end: number, t: number): number {
  const delta = ((end - start + 540) % 360) - 180;
  return start + delta * t;
}

export function interpolateTransform(
  frame: number,
  keyframes: readonly TransformKeyframe[],
  fallback: OverlayTransform,
): OverlayTransform {
  if (keyframes.length === 0) return { ...fallback };

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return { ...sorted[0].transform };
  if (frame >= sorted[sorted.length - 1].frame) return { ...sorted[sorted.length - 1].transform };

  let endIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  if (endIndex <= 0) return { ...sorted[0].transform };
  const start = sorted[endIndex - 1];
  const end = sorted[endIndex];
  const t = (frame - start.frame) / (end.frame - start.frame);

  return {
    x: start.transform.x + (end.transform.x - start.transform.x) * t,
    y: start.transform.y + (end.transform.y - start.transform.y) * t,
    scale: start.transform.scale + (end.transform.scale - start.transform.scale) * t,
    rotation: interpolateAngle(start.transform.rotation, end.transform.rotation, t),
    opacity: start.transform.opacity + (end.transform.opacity - start.transform.opacity) * t,
  };
}

export function upsertKeyframe(
  keyframes: readonly TransformKeyframe[],
  frame: number,
  transform: OverlayTransform,
): TransformKeyframe[] {
  const next = keyframes.filter((keyframe) => keyframe.frame !== frame);
  next.push({ frame, transform: { ...transform } });
  return next.sort((a, b) => a.frame - b.frame);
}

export function getKeyframeAt(
  keyframes: readonly TransformKeyframe[],
  frame: number,
): TransformKeyframe | undefined {
  return keyframes.find((keyframe) => keyframe.frame === frame);
}
