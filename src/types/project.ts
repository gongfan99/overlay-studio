export interface OverlayTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface TransformKeyframe {
  frame: number;
  transform: OverlayTransform;
}

export interface RationalRate {
  numerator: number;
  denominator: number;
}

export interface AudioTrackInfo {
  id: number;
  codec: string;
  timescale: number;
  sampleRate: number;
  channelCount: number;
  sampleEntry: unknown;
}

export interface VideoAssetInfo {
  fileName: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  frameRate: RationalRate;
  frameCount: number;
  codec: string;
  trackId: number;
  timescale: number;
  decoderDescription: Uint8Array;
  audioTrack?: AudioTrackInfo;
}

export interface OverlayFrame {
  index: number;
  filename: string;
  blob: Blob;
  width: number;
  height: number;
  sequenceNumber: number | null;
}

export interface OverlaySequence {
  fileName: string;
  frames: OverlayFrame[];
  width: number;
  height: number;
}

export interface ExportSettings {
  quality: 'auto' | 'high' | 'standard';
  bitrate?: number;
}
