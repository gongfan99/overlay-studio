import { getKeyframeAt, interpolateTransform, upsertKeyframe } from '../compositor/interpolation';
import { exportVideo } from '../media/export-video';
import { inspectMp4, type InspectedVideo } from '../media/mp4-demuxer';
import { chooseEncoderConfig, type ExportQuality } from '../media/video-encoder';
import { OverlayBitmapCache } from '../overlay/overlay-cache';
import { loadPngSequence } from '../overlay/zip-loader';
import type { OverlaySequence, OverlayTransform, TransformKeyframe } from '../types/project';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The editor is missing its “${id}” element.`);
  return element as T;
};

const videoInput = byId<HTMLInputElement>('videoInput');
const overlayInput = byId<HTMLInputElement>('overlayInput');
const overlayStartInput = byId<HTMLInputElement>('overlayStartFrame');
const overlayEndInput = byId<HTMLInputElement>('overlayEndFrame');
const videoElement = byId<HTMLVideoElement>('sourceVideo');
const canvas = byId<HTMLCanvasElement>('previewCanvas');
const previewContext = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
if (!previewContext) throw new Error('This browser could not create a 2D canvas.');

const elements = {
  projectName: byId<HTMLElement>('projectName'),
  appStatus: byId<HTMLElement>('appStatus'),
  exportButton: byId<HTMLButtonElement>('exportButton'),
  videoBadge: byId<HTMLElement>('videoBadge'),
  videoDropzone: byId<HTMLElement>('videoDropzone'),
  videoDropTitle: byId<HTMLElement>('videoDropTitle'),
  videoDetails: byId<HTMLElement>('videoDetails'),
  overlayBadge: byId<HTMLElement>('overlayBadge'),
  overlayDropzone: byId<HTMLElement>('overlayDropzone'),
  overlayDropTitle: byId<HTMLElement>('overlayDropTitle'),
  overlayDetails: byId<HTMLElement>('overlayDetails'),
  resolutionBadge: byId<HTMLElement>('resolutionBadge'),
  previewHint: byId<HTMLElement>('previewHint'),
  previewEmpty: byId<HTMLElement>('previewEmpty'),
  previousFrame: byId<HTMLButtonElement>('previousFrameButton'),
  play: byId<HTMLButtonElement>('playButton'),
  nextFrame: byId<HTMLButtonElement>('nextFrameButton'),
  currentTimecode: byId<HTMLElement>('currentTimecode'),
  durationTimecode: byId<HTMLElement>('durationTimecode'),
  frameSlider: byId<HTMLInputElement>('frameSlider'),
  frameNumber: byId<HTMLInputElement>('frameNumberInput'),
  previousKeyframe: byId<HTMLButtonElement>('previousKeyframeButton'),
  nextKeyframe: byId<HTMLButtonElement>('nextKeyframeButton'),
  videoTrack: byId<HTMLElement>('videoTrack'),
  overlayTrack: byId<HTMLElement>('overlayTrack'),
  keyframeMarkers: byId<HTMLElement>('keyframeMarkers'),
  playhead: byId<HTMLElement>('playhead'),
  overlayRange: byId<HTMLElement>('overlayRange'),
  timelineSummary: byId<HTMLElement>('timelineSummary'),
  keyframeCount: byId<HTMLElement>('keyframeCount'),
  xRange: byId<HTMLInputElement>('xRange'),
  xNumber: byId<HTMLInputElement>('xNumber'),
  yRange: byId<HTMLInputElement>('yRange'),
  yNumber: byId<HTMLInputElement>('yNumber'),
  scaleRange: byId<HTMLInputElement>('scaleRange'),
  scaleNumber: byId<HTMLInputElement>('scaleNumber'),
  rotationRange: byId<HTMLInputElement>('rotationRange'),
  rotationNumber: byId<HTMLInputElement>('rotationNumber'),
  opacityRange: byId<HTMLInputElement>('opacityRange'),
  opacityValue: byId<HTMLElement>('opacityValue'),
  keyframeButton: byId<HTMLButtonElement>('keyframeButton'),
  deleteKeyframeButton: byId<HTMLButtonElement>('deleteKeyframeButton'),
  transformHelp: byId<HTMLElement>('transformHelp'),
  bitrateSelect: byId<HTMLSelectElement>('bitrateSelect'),
  progressWrap: byId<HTMLElement>('exportProgressWrap'),
  progressLabel: byId<HTMLElement>('exportProgressLabel'),
  progressPercent: byId<HTMLElement>('exportProgressPercent'),
  progress: byId<HTMLProgressElement>('exportProgress'),
  toast: byId<HTMLElement>('toast'),
  previewStage: byId<HTMLElement>('previewStage'),
};

let videoFile: File | undefined;
let videoUrl: string | undefined;
let inspected: InspectedVideo | undefined;
let overlay: OverlaySequence | undefined;
let overlayCache: OverlayBitmapCache | undefined;
let frame = 0;
let transform: OverlayTransform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
let fallbackTransform: OverlayTransform = { ...transform };
let keyframes: TransformKeyframe[] = [];
let previewRevision = 0;
let toastTimer = 0;
let exportSupportRevision = 0;
let videoLoadRevision = 0;
let overlayLoadRevision = 0;
let encoderSupported = false;
let isExporting = false;
let videoFrameCallback = 0;
let fallbackPlayFrame = 0;
let extensionPlayFrame = 0;
let isExtendingPreview = false;
let dragOrigin: { pointerX: number; pointerY: number; x: number; y: number } | undefined;

const webCodecsAvailable = 'VideoDecoder' in window && 'VideoEncoder' in window && 'EncodedVideoChunk' in window && 'VideoFrame' in window;

function setStatus(message: string, state: 'ready' | 'working' | 'error' = 'ready'): void {
  elements.appStatus.textContent = message;
  elements.appStatus.dataset.state = state;
}

function notify(message: string, kind: 'error' | 'info' = 'error'): void {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 6500);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimecode(frameNumber: number, fps: number): string {
  if (!fps || !Number.isFinite(fps)) return '00:00:00:00';
  const seconds = Math.floor(Math.max(0, frameNumber) / fps);
  const nominal = Math.max(1, Math.round(fps));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = seconds % 60;
  const frames = Math.max(0, Math.round(frameNumber) % nominal);
  return [hours, minutes, wholeSeconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}

function currentQuality(): ExportQuality {
  return elements.bitrateSelect.value as ExportQuality;
}

function mediaReady(): boolean {
  return Boolean(inspected && overlay);
}

function getOverlayStartFrame(): number {
  const value = Number(overlayStartInput.value);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function getEndFrame(): number {
  const fallback = inspected?.metadata.frameCount ?? 1;
  const value = Number(overlayEndInput.value);
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
}

function getTimelineFrameCount(): number {
  return inspected ? getEndFrame() : 1;
}

function getMp4Frame(frameNumber = frame): number {
  const frameCount = inspected?.metadata.frameCount ?? 1;
  return Math.max(0, Math.min(frameCount - 1, Math.round(frameNumber)));
}

function setAssetInputDisabled(disabled: boolean): void {
  videoInput.disabled = disabled;
  overlayInput.disabled = disabled;
  overlayStartInput.disabled = disabled || !overlay;
  overlayEndInput.disabled = disabled || !inspected;
}

function updateAvailability(): void {
  const hasVideo = Boolean(inspected);
  const canTransform = mediaReady() && !isExporting;
  const canNavigate = hasVideo && !isExporting;
  const keyframeFrame = getMp4Frame();

  for (const control of [elements.previousFrame, elements.nextFrame, elements.frameSlider, elements.frameNumber]) {
    control.disabled = !canNavigate;
  }
  elements.play.disabled = !canNavigate || !videoElement.duration;
  elements.xRange.disabled = !canTransform;
  elements.xNumber.disabled = !canTransform;
  elements.yRange.disabled = !canTransform;
  elements.yNumber.disabled = !canTransform;
  elements.scaleRange.disabled = !canTransform;
  elements.scaleNumber.disabled = !canTransform;
  elements.rotationRange.disabled = !canTransform;
  elements.rotationNumber.disabled = !canTransform;
  elements.opacityRange.disabled = !canTransform;
  elements.keyframeButton.disabled = !canTransform;
  elements.deleteKeyframeButton.disabled = !canTransform || !getKeyframeAt(keyframes, keyframeFrame);
  elements.previousKeyframe.disabled = !hasVideo || isExporting || !keyframes.some((keyframe) => keyframe.frame < keyframeFrame);
  elements.nextKeyframe.disabled = !hasVideo || isExporting || !keyframes.some((keyframe) => keyframe.frame > keyframeFrame);
  elements.exportButton.disabled = !mediaReady() || !encoderSupported || isExporting;
  elements.bitrateSelect.disabled = isExporting;
  setAssetInputDisabled(isExporting);
}

function updateTransformFields(): void {
  const setPair = (range: HTMLInputElement, number: HTMLInputElement, value: number) => {
    range.value = String(value);
    number.value = String(Number(value.toFixed(2)));
  };
  setPair(elements.xRange, elements.xNumber, transform.x);
  setPair(elements.yRange, elements.yNumber, transform.y);
  setPair(elements.scaleRange, elements.scaleNumber, transform.scale);
  setPair(elements.rotationRange, elements.rotationNumber, transform.rotation);
  elements.opacityRange.value = String(transform.opacity);
  elements.opacityValue.textContent = `${Math.round(transform.opacity * 100)}%`;
  const keyframeFrame = getMp4Frame();
  const currentKeyframe = getKeyframeAt(keyframes, keyframeFrame);
  elements.keyframeButton.textContent = currentKeyframe ? 'Update keyframe' : 'Add keyframe';
  elements.deleteKeyframeButton.disabled = !mediaReady() || isExporting || !currentKeyframe;
  elements.transformHelp.textContent = currentKeyframe
    ? `MP4 frame ${keyframeFrame} has a keyframe. Adjust the PNG transform and update it, or delete it.`
    : keyframes.length
      ? `Adjust the PNG transform at MP4 frame ${keyframeFrame}, then add a keyframe to animate the change.`
      : 'Drag the overlay in the preview or use these controls to set its position.';
}

function updateTimeline(): void {
  const frameCount = getTimelineFrameCount();
  const denominator = Math.max(1, frameCount - 1);
  const positionPercent = (frame / denominator) * 100;
  elements.frameSlider.max = String(Math.max(0, frameCount - 1));
  elements.frameNumber.max = String(Math.max(0, frameCount - 1));
  elements.playhead.style.left = `${positionPercent}%`;
  elements.videoTrack.setAttribute('aria-label', `Video timeline, frame ${frame + 1} of ${frameCount}; use the arrow keys to scrub.`);
  elements.overlayTrack.setAttribute('aria-label', `Overlay timeline, frame ${frame + 1} of ${frameCount}; use the arrow keys to scrub.`);
  const overlayStart = getOverlayStartFrame();
  elements.overlayRange.style.left = `${(overlayStart / denominator) * 100}%`;
  elements.overlayRange.style.width = `${Math.min(100, Math.max(0, (frameCount - overlayStart) / denominator) * 100)}%`;
  elements.keyframeMarkers.replaceChildren();
  for (const keyframe of keyframes) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = `keyframe-marker${keyframe.frame === getMp4Frame() ? ' is-current' : ''}`;
    marker.style.left = `${(keyframe.frame / denominator) * 100}%`;
    marker.title = `Go to keyframe at frame ${keyframe.frame}`;
    marker.setAttribute('aria-label', `Go to keyframe at frame ${keyframe.frame}`);
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      setFrame(keyframe.frame);
    });
    elements.keyframeMarkers.append(marker);
  }
  elements.keyframeCount.textContent = `${keyframes.length} ${keyframes.length === 1 ? 'key' : 'keys'}`;
  if (keyframes.length) {
    elements.timelineSummary.textContent = 'Transform interpolates between the selected keyframes.';
  } else if (overlay) {
    elements.timelineSummary.textContent = `${overlay.frames.length} overlay frames · starts at frame ${overlayStart} · ends at frame ${getEndFrame()}.`;
  } else {
    elements.timelineSummary.textContent = 'Add transform keyframes to animate alignment.';
  }
  updateAvailability();
}

function renderReadout(): void {
  const metadata = inspected?.metadata;
  if (!metadata) return;
  elements.currentTimecode.textContent = formatTimecode(frame, metadata.fps);
  elements.durationTimecode.textContent = formatTimecode(getEndFrame(), metadata.fps);
  elements.frameSlider.value = String(frame);
  elements.frameNumber.value = String(frame);
  updateTimeline();
  updateTransformFields();
}

async function seekPreviewToFrame(targetFrame: number): Promise<void> {
  const metadata = inspected?.metadata;
  if (!metadata) return;
  const timestamp = Math.min(videoElement.duration || metadata.duration, targetFrame / metadata.fps);
  if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(videoElement.currentTime - timestamp) < 0.0005) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('The browser could not seek to the selected preview frame.')), 12000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      videoElement.removeEventListener('seeked', onSeeked);
      videoElement.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error('The browser could not decode this video frame.'));
    videoElement.addEventListener('seeked', onSeeked, { once: true });
    videoElement.addEventListener('error', onError, { once: true });
    videoElement.currentTime = timestamp;
    if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(videoElement.currentTime - timestamp) < 0.0005) finish();
  });
}

async function renderPreview(seek = false): Promise<void> {
  const metadata = inspected?.metadata;
  if (!metadata || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const revision = ++previewRevision;
  try {
    const sourceFrame = Math.min(frame, metadata.frameCount - 1);
    if (seek && videoElement.paused) await seekPreviewToFrame(sourceFrame);
    if (revision !== previewRevision) return;
    const relativeOverlayIndex = frame - getOverlayStartFrame();
    const overlayIndex = overlay && relativeOverlayIndex >= 0
      ? Math.min(relativeOverlayIndex, overlay.frames.length - 1)
      : -1;
    const bitmap = overlay && overlayCache && overlayIndex >= 0
      ? await overlayCache.get(overlayIndex)
      : undefined;
    if (revision !== previewRevision) return;
    if (canvas.width !== metadata.width || canvas.height !== metadata.height) {
      canvas.width = metadata.width;
      canvas.height = metadata.height;
      fitPreviewCanvas();
    }
    previewContext.drawImage(videoElement, 0, 0, metadata.width, metadata.height);
    if (bitmap) {
      previewContext.save();
      previewContext.globalAlpha = Math.min(1, Math.max(0, transform.opacity));
      previewContext.translate(transform.x, transform.y);
      previewContext.rotate((transform.rotation * Math.PI) / 180);
      previewContext.scale(transform.scale, transform.scale);
      previewContext.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      previewContext.restore();
    }
    canvas.classList.add('is-visible');
    elements.previewEmpty.hidden = true;
    elements.previewHint.textContent = overlay ? `${overlay.frames.length} PNG frames · drag to reposition` : 'Video loaded · add a PNG sequence';
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not render the selected preview frame.');
  }
}

function fitPreviewCanvas(): void {
  const metadata = inspected?.metadata;
  if (!metadata) return;
  const stageStyle = getComputedStyle(elements.previewStage);
  const horizontalPadding = Number.parseFloat(stageStyle.paddingLeft) + Number.parseFloat(stageStyle.paddingRight);
  const verticalPadding = Number.parseFloat(stageStyle.paddingTop) + Number.parseFloat(stageStyle.paddingBottom);
  const availableWidth = Math.max(1, elements.previewStage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, elements.previewStage.clientHeight - verticalPadding);
  const scale = Math.min(availableWidth / metadata.width, availableHeight / metadata.height);
  canvas.style.width = `${Math.max(1, metadata.width * scale)}px`;
  canvas.style.height = `${Math.max(1, metadata.height * scale)}px`;
}

function setFrame(nextFrame: number, seek = true): void {
  if (seek && (!videoElement.paused || isExtendingPreview)) stopPlayback();
  const maximum = Math.max(0, getTimelineFrameCount() - 1);
  frame = Math.max(0, Math.min(maximum, Math.round(nextFrame)));
  transform = interpolateTransform(getMp4Frame(), keyframes, fallbackTransform);
  renderReadout();
  void renderPreview(seek);
}

function setTransformValue<K extends keyof OverlayTransform>(key: K, value: OverlayTransform[K]): void {
  transform = { ...transform, [key]: value };
  updateTransformFields();
  void renderPreview(false);
}

function setControlValue(key: keyof OverlayTransform, value: number): void {
  if (!Number.isFinite(value)) return;
  if (key === 'scale') value = Math.max(0.05, Math.min(5, value));
  if (key === 'rotation') value = Math.max(-360, Math.min(360, value));
  if (key === 'opacity') value = Math.max(0, Math.min(1, value));
  setTransformValue(key, value);
}

function stopPlayback(): void {
  videoElement.pause();
  isExtendingPreview = false;
  const cancelFrameCallback = (videoElement as HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void }).cancelVideoFrameCallback;
  if (videoFrameCallback && typeof cancelFrameCallback === 'function') {
    cancelFrameCallback.call(videoElement, videoFrameCallback);
    videoFrameCallback = 0;
  }
  if (fallbackPlayFrame) {
    cancelAnimationFrame(fallbackPlayFrame);
    fallbackPlayFrame = 0;
  }
  if (extensionPlayFrame) {
    cancelAnimationFrame(extensionPlayFrame);
    extensionPlayFrame = 0;
  }
  elements.play.textContent = '▶';
  elements.play.setAttribute('aria-label', 'Play preview');
  elements.play.title = 'Play (Space)';
  updateAvailability();
}

function onVideoFrame(_now: number, metadata: VideoFrameCallbackMetadata): void {
  if (videoElement.paused || !inspected) return;
  const lastOutputFrame = getEndFrame() - 1;
  const next = Math.min(lastOutputFrame, Math.max(0, Math.round(metadata.mediaTime * inspected.metadata.fps)));
  if (next !== frame) {
    frame = next;
    transform = interpolateTransform(getMp4Frame(), keyframes, fallbackTransform);
    renderReadout();
    void renderPreview(false);
  }
  if (next >= lastOutputFrame) {
    stopPlayback();
    return;
  }
  videoFrameCallback = videoElement.requestVideoFrameCallback(onVideoFrame);
}

function startExtendedPreviewPlayback(): void {
  if (!inspected || getEndFrame() <= inspected.metadata.frameCount || frame >= getEndFrame() - 1) {
    stopPlayback();
    return;
  }
  isExtendingPreview = true;
  elements.play.textContent = 'Ⅱ';
  elements.play.setAttribute('aria-label', 'Pause preview');
  elements.play.title = 'Pause (Space)';
  const startTime = performance.now();
  const startFrame = Math.max(frame, inspected.metadata.frameCount - 1);
  const tick = (now: number) => {
    if (!isExtendingPreview || !inspected) return;
    const next = startFrame + Math.floor(((now - startTime) / 1000) * inspected.metadata.fps);
    if (next >= getEndFrame() - 1) {
      setFrame(getEndFrame() - 1, false);
      stopPlayback();
      return;
    }
    if (next !== frame) {
      frame = next;
      transform = interpolateTransform(getMp4Frame(), keyframes, fallbackTransform);
      renderReadout();
      void renderPreview(false);
    }
    extensionPlayFrame = requestAnimationFrame(tick);
  };
  extensionPlayFrame = requestAnimationFrame(tick);
}

function onVideoEnded(): void {
  if (inspected && getEndFrame() > inspected.metadata.frameCount && frame < getEndFrame() - 1) {
    startExtendedPreviewPlayback();
  } else {
    stopPlayback();
  }
}

async function startPlayback(): Promise<void> {
  if (!inspected) return;
  if (frame > inspected.metadata.frameCount - 1 && frame < getEndFrame() - 1) {
    startExtendedPreviewPlayback();
    return;
  }
  if (frame >= getEndFrame() - 1) {
    await seekPreviewToFrame(0).catch(() => undefined);
    frame = 0;
    transform = interpolateTransform(getMp4Frame(), keyframes, fallbackTransform);
    renderReadout();
    void renderPreview(false);
  }
  try {
    await videoElement.play();
    elements.play.textContent = 'Ⅱ';
    elements.play.setAttribute('aria-label', 'Pause preview');
    elements.play.title = 'Pause (Space)';
    const requestFrameCallback = (videoElement as HTMLVideoElement & { requestVideoFrameCallback?: (callback: typeof onVideoFrame) => number }).requestVideoFrameCallback;
    if (typeof requestFrameCallback === 'function') {
      videoFrameCallback = requestFrameCallback.call(videoElement, onVideoFrame);
    } else {
      const startTime = performance.now();
      const startFrame = frame;
      const tick = (now: number) => {
        if (videoElement.paused || !inspected) return;
        const next = startFrame + Math.floor(((now - startTime) / 1000) * inspected.metadata.fps);
        if (next !== frame) {
          frame = Math.min(getEndFrame() - 1, next);
          transform = interpolateTransform(getMp4Frame(), keyframes, fallbackTransform);
          renderReadout();
          void renderPreview(false);
        }
        if (frame >= getEndFrame() - 1) {
          stopPlayback();
          return;
        }
        fallbackPlayFrame = requestAnimationFrame(tick);
      };
      fallbackPlayFrame = requestAnimationFrame(tick);
    }
  } catch {
    notify('Preview playback could not start. Try stepping or scrubbing the timeline.');
  }
}

function bindTransformControls(): void {
  const pairs: Array<{ range: HTMLInputElement; number: HTMLInputElement; key: keyof Pick<OverlayTransform, 'x' | 'y' | 'scale' | 'rotation'> }> = [
    { range: elements.xRange, number: elements.xNumber, key: 'x' },
    { range: elements.yRange, number: elements.yNumber, key: 'y' },
    { range: elements.scaleRange, number: elements.scaleNumber, key: 'scale' },
    { range: elements.rotationRange, number: elements.rotationNumber, key: 'rotation' },
  ];
  for (const pair of pairs) {
    pair.range.addEventListener('input', () => setControlValue(pair.key, Number(pair.range.value)));
    pair.number.addEventListener('input', () => setControlValue(pair.key, Number(pair.number.value)));
  }
  elements.opacityRange.addEventListener('input', () => setControlValue('opacity', Number(elements.opacityRange.value)));
}

function updatePositionRanges(): void {
  const metadata = inspected?.metadata;
  if (!metadata) return;
  elements.xRange.min = String(-metadata.width);
  elements.xRange.max = String(metadata.width * 2);
  elements.yRange.min = String(-metadata.height);
  elements.yRange.max = String(metadata.height * 2);
  elements.scaleRange.max = '5';
  elements.xNumber.min = String(-metadata.width);
  elements.xNumber.max = String(metadata.width * 2);
  elements.yNumber.min = String(-metadata.height);
  elements.yNumber.max = String(metadata.height * 2);
  overlayStartInput.max = String(getEndFrame());
}

function jumpKeyframe(direction: -1 | 1): void {
  const referenceFrame = getMp4Frame();
  const candidates = keyframes
    .map((keyframe) => keyframe.frame)
    .filter((candidate) => direction < 0 ? candidate < referenceFrame : candidate > referenceFrame)
    .sort((a, b) => direction < 0 ? b - a : a - b);
  if (candidates[0] !== undefined) setFrame(candidates[0]);
}

function setFrameFromTimeline(event: MouseEvent, track: HTMLElement): void {
  if (!inspected) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  setFrame(ratio * (getTimelineFrameCount() - 1));
}

async function checkEncoderSupport(): Promise<void> {
  const revision = ++exportSupportRevision;
  encoderSupported = false;
  updateAvailability();
  if (!inspected || !webCodecsAvailable) return;
  setStatus('Checking H.264 support', 'working');
  try {
    const supported = await chooseEncoderConfig(inspected.metadata, currentQuality());
    if (revision !== exportSupportRevision) return;
    encoderSupported = true;
    elements.previewHint.textContent = overlay ? `${overlay.frames.length} PNG frames · H.264 ${Math.round(supported.bitrate / 1_000_000 * 10) / 10} Mbps available` : `H.264 export available · ${Math.round(supported.bitrate / 1_000_000 * 10) / 10} Mbps`;
    setStatus(mediaReady() ? 'Ready to export' : 'Ready');
  } catch (error) {
    if (revision !== exportSupportRevision) return;
    setStatus('H.264 export unavailable', 'error');
    notify(error instanceof Error ? error.message : 'No compatible H.264 encoder configuration was found.');
  }
  updateAvailability();
}

async function loadVideo(file: File): Promise<void> {
  const revision = ++videoLoadRevision;
  stopPlayback();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoFile = file;
  inspected = undefined;
  encoderSupported = false;
  keyframes = [];
  frame = 0;
  videoUrl = URL.createObjectURL(file);
  videoElement.src = videoUrl;
  videoElement.load();
  elements.videoBadge.textContent = 'Inspecting';
  elements.videoDropTitle.textContent = 'Inspecting MP4…';
  elements.videoBadge.classList.remove('is-loaded');
  elements.videoDetails.className = 'asset-details';
  elements.videoDetails.textContent = `${file.name} · ${formatBytes(file.size)} · checking codecs and frame timing…`;
  elements.projectName.textContent = file.name.replace(/\.[^.]+$/, '');
  elements.resolutionBadge.textContent = 'Inspecting video';
  setStatus('Inspecting video', 'working');
  updateAvailability();

  try {
    const result = await inspectMp4(file);
    if (revision !== videoLoadRevision) return;
    inspected = result;
    const metadata = result.metadata;
    overlayEndInput.value = String(metadata.frameCount);
    transform = { x: metadata.width / 2, y: metadata.height / 2, scale: 1, rotation: 0, opacity: 1 };
    fallbackTransform = { ...transform };
    elements.videoBadge.textContent = 'Loaded';
    elements.videoDropTitle.textContent = 'Replace MP4';
    elements.videoBadge.classList.add('is-loaded');
    elements.videoDetails.className = 'asset-details';
    elements.videoDetails.textContent = `${metadata.width} × ${metadata.height} · ${metadata.fps.toFixed(3)} fps · ${metadata.frameCount.toLocaleString()} frames${metadata.audioTrack ? ' · audio' : ' · silent'}`;
    elements.resolutionBadge.textContent = `${metadata.width} × ${metadata.height} · ${metadata.fps.toFixed(3)} fps`;
    elements.frameSlider.min = '0';
    elements.frameSlider.max = String(metadata.frameCount - 1);
    elements.frameNumber.min = '0';
    elements.frameNumber.max = String(metadata.frameCount - 1);
    updatePositionRanges();
    renderReadout();
    await renderPreview(true);
    await checkEncoderSupport();
  } catch (error) {
    if (revision !== videoLoadRevision) return;
    elements.videoBadge.textContent = 'Unsupported';
    elements.videoDropTitle.textContent = 'Choose another MP4';
    elements.videoDetails.className = 'asset-details asset-error';
    const message = error instanceof Error ? error.message : 'Could not inspect the video.';
    elements.videoDetails.textContent = message;
    elements.resolutionBadge.textContent = 'Unsupported source';
    setStatus('Video not supported', 'error');
    notify(message);
  }
  updateAvailability();
}

async function loadOverlay(file: File): Promise<void> {
  const revision = ++overlayLoadRevision;
  overlayCache?.close();
  overlayCache = undefined;
  overlay = undefined;
  updateTimeline();
  updateAvailability();
  void renderPreview(false);
  elements.overlayBadge.classList.remove('is-loaded');
  elements.overlayBadge.textContent = 'Loading';
  elements.overlayDropTitle.textContent = 'Loading ZIP…';
  elements.overlayDetails.className = 'asset-details';
  elements.overlayDetails.textContent = `${file.name} · extracting PNG frames…`;
  setStatus('Loading PNG sequence', 'working');
  try {
    const sequence = await loadPngSequence(file);
    if (revision !== overlayLoadRevision) return;
    overlay = sequence;
    overlayCache = new OverlayBitmapCache(sequence);
    elements.overlayBadge.textContent = 'Loaded';
    elements.overlayDropTitle.textContent = 'Replace ZIP';
    elements.overlayBadge.classList.add('is-loaded');
    elements.overlayDetails.className = 'asset-details';
    elements.overlayDetails.textContent = `${sequence.frames.length.toLocaleString()} PNG frames · ${sequence.width} × ${sequence.height}`;
    overlayStartInput.value = '0';
    overlayStartInput.max = String(getEndFrame());
    elements.overlayRange.hidden = false;
    renderReadout();
    if (inspected) await checkEncoderSupport();
    else setStatus('Load a base video');
    await renderPreview(false);
  } catch (error) {
    if (revision !== overlayLoadRevision) return;
    elements.overlayBadge.textContent = 'Invalid ZIP';
    elements.overlayDropTitle.textContent = 'Choose another ZIP';
    elements.overlayBadge.classList.remove('is-loaded');
    elements.overlayDetails.className = 'asset-details asset-error';
    const message = error instanceof Error ? error.message : 'Could not read the PNG sequence.';
    elements.overlayDetails.textContent = message;
    setStatus('Overlay not supported', 'error');
    notify(message);
  }
  updateAvailability();
}

async function runExport(): Promise<void> {
  if (!videoFile || !inspected || !overlay || isExporting) return;
  isExporting = true;
  elements.progressWrap.hidden = false;
  elements.progress.value = 0;
  elements.progressPercent.textContent = '0%';
  elements.progressLabel.textContent = 'Preparing decoder…';
  setStatus('Rendering video', 'working');
  updateAvailability();
  try {
    const blob = await exportVideo({
      file: videoFile,
      inspected,
      overlay,
      overlayStartFrame: getOverlayStartFrame(),
      endFrame: getEndFrame(),
      fallbackTransform: { ...fallbackTransform },
      keyframes: keyframes.map((keyframe) => ({ frame: keyframe.frame, transform: { ...keyframe.transform } })),
      quality: currentQuality(),
      onProgress(completed, total, stage) {
        const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        elements.progress.value = percent;
        elements.progressPercent.textContent = `${percent}%`;
        elements.progressLabel.textContent = stage === 'mux' ? 'Copying original audio…' : `Compositing frame ${completed.toLocaleString()} of ${total.toLocaleString()}…`;
      },
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${videoFile.name.replace(/\.mp4$/i, '')}-composited.mp4`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
    elements.progress.value = 100;
    elements.progressPercent.textContent = '100%';
    elements.progressLabel.textContent = `Export ready · ${formatBytes(blob.size)}`;
    setStatus('Export complete');
    notify(`Created ${link.download} (${formatBytes(blob.size)}).`, 'info');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The video export failed.';
    elements.progressLabel.textContent = 'Export failed';
    setStatus('Export failed', 'error');
    notify(message);
  } finally {
    isExporting = false;
    updateAvailability();
  }
}

function bindFileDropzone(
  dropzone: HTMLElement,
  input: HTMLInputElement,
  accepts: (file: File) => boolean,
  onFile: (file: File) => void | Promise<void>,
  expectedLabel: string,
): void {
  const clearDragState = (): void => dropzone.classList.remove('is-dragging');

  dropzone.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && dropzone.contains(event.relatedTarget)) return;
    clearDragState();
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    clearDragState();
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    if (!accepts(file)) {
      notify(`Please drop ${expectedLabel}.`);
      return;
    }
    void onFile(file);
  });

  // Keep keyboard and click selection on the native input unchanged.
  input.addEventListener('change', () => { clearDragState(); });
}

function bindEvents(): void {
  videoInput.addEventListener('change', () => {
    const file = videoInput.files?.[0];
    if (file) void loadVideo(file);
    videoInput.value = '';
  });
  overlayInput.addEventListener('change', () => {
    const file = overlayInput.files?.[0];
    if (file) void loadOverlay(file);
    overlayInput.value = '';
  });
  bindFileDropzone(
    elements.videoDropzone,
    videoInput,
    (file) => file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4'),
    loadVideo,
    'an MP4 video file',
  );
  bindFileDropzone(
    elements.overlayDropzone,
    overlayInput,
    (file) => ['application/zip', 'application/x-zip-compressed'].includes(file.type) || file.name.toLowerCase().endsWith('.zip'),
    loadOverlay,
    'a ZIP file',
  );
  overlayStartInput.addEventListener('input', () => {
    const start = Math.min(getEndFrame(), getOverlayStartFrame());
    overlayStartInput.value = String(start);
    updateTimeline();
    void renderPreview(false);
  });
  overlayEndInput.addEventListener('input', () => {
    const end = getEndFrame();
    overlayEndInput.value = String(end);
    if (getOverlayStartFrame() > end) overlayStartInput.value = String(end);
    updatePositionRanges();
    if (frame >= end) {
      setFrame(end - 1);
    } else {
      updateTimeline();
      void renderPreview(false);
    }
  });
  elements.previousFrame.addEventListener('click', () => setFrame(frame - 1));
  elements.nextFrame.addEventListener('click', () => setFrame(frame + 1));
  elements.frameSlider.addEventListener('input', () => setFrame(Number(elements.frameSlider.value)));
  elements.frameNumber.addEventListener('change', () => setFrame(Number(elements.frameNumber.value)));
  elements.play.addEventListener('click', () => (isExtendingPreview || !videoElement.paused) ? stopPlayback() : void startPlayback());
  videoElement.addEventListener('ended', onVideoEnded);
  videoElement.addEventListener('loadeddata', () => { void renderPreview(false); updateAvailability(); });
  elements.videoTrack.addEventListener('click', (event) => setFrameFromTimeline(event, elements.videoTrack));
  elements.overlayTrack.addEventListener('click', (event) => setFrameFromTimeline(event, elements.overlayTrack));
  for (const track of [elements.videoTrack, elements.overlayTrack]) {
    track.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setFrame(frame + (event.key === 'ArrowLeft' ? -1 : 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setFrame(0);
      } else if (event.key === 'End' && inspected) {
        event.preventDefault();
        setFrame(getTimelineFrameCount() - 1);
      }
    });
  }
  elements.previousKeyframe.addEventListener('click', () => jumpKeyframe(-1));
  elements.nextKeyframe.addEventListener('click', () => jumpKeyframe(1));
  elements.keyframeButton.addEventListener('click', () => {
    keyframes = upsertKeyframe(keyframes, getMp4Frame(), transform);
    renderReadout();
    void renderPreview(false);
  });
  elements.deleteKeyframeButton.addEventListener('click', () => {
    const keyframeFrame = getMp4Frame();
    if (!getKeyframeAt(keyframes, keyframeFrame)) return;
    keyframes = keyframes.filter((keyframe) => keyframe.frame !== keyframeFrame);
    transform = interpolateTransform(keyframeFrame, keyframes, fallbackTransform);
    renderReadout();
    void renderPreview(false);
  });
  elements.bitrateSelect.addEventListener('change', () => { void checkEncoderSupport(); });
  elements.exportButton.addEventListener('click', () => { void runExport(); });
  bindTransformControls();
  const resizeObserver = new ResizeObserver(fitPreviewCanvas);
  resizeObserver.observe(elements.previewStage);
  window.addEventListener('resize', fitPreviewCanvas);

  canvas.addEventListener('pointerdown', (event) => {
    if (!overlay || !inspected || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dragOrigin = { pointerX: event.clientX, pointerY: event.clientY, x: transform.x, y: transform.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragOrigin || !inspected) return;
    const rect = canvas.getBoundingClientRect();
    const x = dragOrigin.x + ((event.clientX - dragOrigin.pointerX) * inspected.metadata.width) / rect.width;
    const y = dragOrigin.y + ((event.clientY - dragOrigin.pointerY) * inspected.metadata.height) / rect.height;
    setTransformValue('x', x);
    setTransformValue('y', y);
  });
  canvas.addEventListener('pointerup', () => { dragOrigin = undefined; });
  canvas.addEventListener('pointercancel', () => { dragOrigin = undefined; });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    if (isEditing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space' && inspected) {
      event.preventDefault();
      videoElement.paused ? void startPlayback() : stopPlayback();
    } else if (event.key === 'ArrowLeft' && inspected) {
      event.preventDefault();
      setFrame(frame - 1);
    } else if (event.key === 'ArrowRight' && inspected) {
      event.preventDefault();
      setFrame(frame + 1);
    }
  });
}

function initialize(): void {
  bindEvents();
  elements.overlayRange.hidden = true;
  updateAvailability();
  if (!webCodecsAvailable) {
    setStatus('WebCodecs unavailable', 'error');
    elements.previewHint.textContent = 'Open this editor in desktop Chrome or Chromium to decode and export video.';
    notify('This browser does not provide the WebCodecs APIs required by this editor.');
  }
}

initialize();
