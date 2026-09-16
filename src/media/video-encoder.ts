import type { VideoAssetInfo } from '../types/project';

export type ExportQuality = 'auto' | 'high' | 'standard';

export interface SupportedEncoderConfig {
  config: VideoEncoderConfig & { avc: { format: 'avc' } };
  bitrate: number;
}

function getTargetBitrate(video: VideoAssetInfo, quality: ExportQuality): number {
  const bitsPerPixelFrame = quality === 'high' ? 0.105 : quality === 'standard' ? 0.058 : 0.082;
  const raw = video.width * video.height * video.fps * bitsPerPixelFrame;
  return Math.round(Math.min(24_000_000, Math.max(700_000, raw)) / 100_000) * 100_000;
}

function getBitrateCandidates(target: number): number[] {
  const candidates = [target, target * 0.82, target * 0.66, target * 0.5, target * 0.38, 500_000];
  return [...new Set(candidates.map((value) => Math.max(500_000, Math.round(value / 50_000) * 50_000)))];
}

function getCodecCandidates(width: number, height: number): string[] {
  const largeFrame = width * height > 1920 * 1080;
  return largeFrame
    ? ['avc1.640033', 'avc1.4D4033', 'avc1.42E033', 'avc1.640034', 'avc1.4D4034', 'avc1.42E034', 'avc1.640028', 'avc1.4D4028', 'avc1.42E028']
    : ['avc1.640028', 'avc1.4D4028', 'avc1.42E028', 'avc1.64001f', 'avc1.4D401f', 'avc1.42E01f'];
}

export async function chooseEncoderConfig(
  video: VideoAssetInfo,
  quality: ExportQuality,
  requestedBitrate?: number,
): Promise<SupportedEncoderConfig> {
  if (!('VideoEncoder' in window)) throw new Error('This browser does not support WebCodecs video encoding. Use desktop Chrome or Chromium.');

  const targetBitrate = requestedBitrate ?? getTargetBitrate(video, quality);
  const bitrates = getBitrateCandidates(targetBitrate);
  const codecs = getCodecCandidates(video.width, video.height);

  for (const bitrate of bitrates) {
    for (const codec of codecs) {
      const config = {
        codec,
        width: video.width,
        height: video.height,
        bitrate,
        framerate: video.fps,
        latencyMode: 'realtime',
        avc: { format: 'avc' as const },
      } as VideoEncoderConfig & { avc: { format: 'avc' } };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return { config: support.config as SupportedEncoderConfig['config'], bitrate };
      }
    }
  }

  throw new Error('This browser could not find a compatible H.264 encoder configuration for this video size and frame rate.');
}
