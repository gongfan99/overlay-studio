import { drawComposite } from '../compositor/compositor';
import { interpolateTransform } from '../compositor/interpolation';
import { OverlayBitmapCache } from '../overlay/overlay-cache';
import type { OverlaySequence, OverlayTransform, TransformKeyframe, VideoAssetInfo } from '../types/project';
import { demuxSamples, type InspectedVideo } from './mp4-demuxer';
import { createMp4Muxer, type Mp4MuxerSession } from './mp4-muxer';
import { chooseEncoderConfig, type ExportQuality } from './video-encoder';

export interface ExportVideoOptions {
  file: File;
  inspected: InspectedVideo;
  overlay: OverlaySequence;
  overlayStartFrame: number;
  endFrame: number;
  fallbackTransform: OverlayTransform;
  keyframes: readonly TransformKeyframe[];
  quality: ExportQuality;
  onProgress: (completed: number, total: number, stage: 'decode' | 'mux') => void;
}

function waitForDequeue(codec: VideoDecoder | VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      codec.removeEventListener('dequeue', finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, 100);
    codec.addEventListener('dequeue', finish, { once: true });
  });
}

function asBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function exportVideo(options: ExportVideoOptions): Promise<Blob> {
  const { file, inspected, overlay, overlayStartFrame, endFrame, fallbackTransform, keyframes, quality, onProgress } = options;
  const video = inspected.metadata;
  const outputFrameCount = Math.max(1, Math.round(endFrame));
  const encoderConfig = await chooseEncoderConfig(video, quality);
  const demuxed = await demuxSamples(file, video.trackId, video.audioTrack?.id);
  if (demuxed.video.length !== video.frameCount) {
    throw new Error('The number of decoded video samples changed after inspection. Please reload the source file.');
  }

  const decoderConfig: VideoDecoderConfig = {
    codec: video.codec,
    codedWidth: video.width,
    codedHeight: video.height,
    description: video.decoderDescription,
  };
  const cache = new OverlayBitmapCache(overlay, 4);
  const frameQueue: VideoFrame[] = [];
  let waitingFrame: ((frame: VideoFrame | undefined, error?: Error) => void) | undefined;
  let producerDone = false;
  let pipelineError: Error | undefined;
  let muxer: Mp4MuxerSession | undefined;
  let encodedSamples = 0;
  let heldSourceFrame: VideoFrame | undefined;

  const deliver = () => {
    if (!waitingFrame) return;
    const waiter = waitingFrame;
    waitingFrame = undefined;
    if (pipelineError) {
      waiter(undefined, pipelineError);
    } else if (frameQueue.length > 0) {
      waiter(frameQueue.shift());
    } else if (producerDone) {
      waiter(undefined);
    } else {
      waitingFrame = waiter;
    }
  };
  const enqueueFrame = (frame: VideoFrame) => {
    frameQueue.push(frame);
    deliver();
  };
  const endFrames = (error?: unknown) => {
    if (error && !pipelineError) pipelineError = error instanceof Error ? error : new Error(String(error));
    producerDone = true;
    deliver();
  };
  const takeFrame = (): Promise<VideoFrame | undefined> => {
    if (pipelineError) return Promise.reject(pipelineError);
    if (frameQueue.length > 0) return Promise.resolve(frameQueue.shift());
    if (producerDone) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      waitingFrame = (frame, error) => error ? reject(error) : resolve(frame);
    });
  };

  const decoder = new VideoDecoder({
    output: enqueueFrame,
    error: (error) => endFrames(error),
  });
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      try {
        if (!muxer) {
          const description = metadata?.decoderConfig?.description;
          if (!description) throw new Error('The H.264 encoder did not return MP4 decoder configuration data.');
          const avcConfig = description instanceof Uint8Array ? description : new Uint8Array(description as ArrayBuffer);
          muxer = createMp4Muxer(video, encoderConfig.config.codec, avcConfig, video.audioTrack, demuxed.audioSampleEntry ?? inspected.audioSampleEntry);
        }

        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const cts = Math.round((chunk.timestamp * video.timescale) / 1_000_000);
        const durationUs = chunk.duration ?? Math.round(1_000_000 / video.fps);
        const duration = Math.max(1, Math.round((durationUs * video.timescale) / 1_000_000));
        muxer.addVideoSample(bytes, {
          duration,
          cts,
          dts: encodedSamples === 0 ? 0 : lastVideoDts,
          is_sync: chunk.type === 'key',
        });
        lastVideoDts += duration;
        encodedSamples += 1;
      } catch (error) {
        endFrames(error);
      }
    },
    error: (error) => endFrames(error),
  });

  let lastVideoDts = 0;
  decoder.configure(decoderConfig);
  encoder.configure(encoderConfig.config);

  const surface: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(video.width, video.height)
    : Object.assign(document.createElement('canvas'), { width: video.width, height: video.height });
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (surface instanceof OffscreenCanvas) context = surface.getContext('2d', { alpha: false });
  else context = surface.getContext('2d', { alpha: false });
  if (!context) {
    decoder.close();
    encoder.close();
    cache.close();
    throw new Error('This browser could not create a 2D canvas for export.');
  }

  const consumeFrames = async () => {
    let decodedFrameCount = 0;
    const encodeComposite = async (source: VideoFrame, outputIndex: number, timestamp: number, duration: number): Promise<void> => {
      const relativeOverlayIndex = outputIndex - overlayStartFrame;
      const overlayIndex = relativeOverlayIndex >= 0
        ? Math.min(relativeOverlayIndex, overlay.frames.length - 1)
        : -1;
      const overlayBitmap = overlayIndex >= 0
        ? await cache.get(overlayIndex)
        : undefined;
      const transformFrame = Math.min(outputIndex, video.frameCount - 1);
      const transform = interpolateTransform(transformFrame, keyframes, fallbackTransform);
      drawComposite(context!, source, video.width, video.height, overlayBitmap, transform);
      const outputFrame = new VideoFrame(surface, { timestamp, duration });
      try {
        encoder.encode(outputFrame, { keyFrame: outputIndex === 0 || outputIndex % Math.max(1, Math.round(video.fps * 2)) === 0 });
      } finally {
        outputFrame.close();
      }
      onProgress(outputIndex + 1, outputFrameCount, 'decode');
      while (encoder.encodeQueueSize > 8) {
        if (pipelineError) throw pipelineError;
        await waitForDequeue(encoder);
      }
    };

    try {
      while (true) {
        const sourceFrame = await takeFrame();
        if (!sourceFrame) break;
        try {
          const sourceIndex = decodedFrameCount;
          const duration = sourceFrame.duration ?? Math.round(1_000_000 / video.fps);
          if (sourceIndex < outputFrameCount) {
            await encodeComposite(sourceFrame, sourceIndex, sourceFrame.timestamp, duration);
          }
          if (outputFrameCount > video.frameCount) {
            const heldFrame = sourceFrame.clone();
            heldSourceFrame?.close();
            heldSourceFrame = heldFrame;
          }
          decodedFrameCount += 1;
        } finally {
          sourceFrame.close();
        }
      }
      if (decodedFrameCount !== video.frameCount) {
        throw new Error(`Decoded ${decodedFrameCount} frames, but the MP4 metadata reports ${video.frameCount}.`);
      }

      if (outputFrameCount > video.frameCount) {
        if (!heldSourceFrame) throw new Error('The MP4 did not provide a final video frame to extend.');
        const duration = heldSourceFrame.duration ?? Math.round(1_000_000 / video.fps);
        for (let outputIndex = video.frameCount; outputIndex < outputFrameCount; outputIndex += 1) {
          const timestamp = heldSourceFrame.timestamp + (outputIndex - (video.frameCount - 1)) * duration;
          await encodeComposite(heldSourceFrame, outputIndex, timestamp, duration);
        }
      }
    } finally {
      heldSourceFrame?.close();
      heldSourceFrame = undefined;
    }
  };

  const consumer = consumeFrames().catch((error) => {
    endFrames(error);
  });

  try {
    for (const sample of demuxed.video) {
      if (pipelineError) throw pipelineError;
      while (decoder.decodeQueueSize > 8) {
        if (pipelineError) throw pipelineError;
        await waitForDequeue(decoder);
      }
      const timestamp = Math.round((sample.cts * 1_000_000) / video.timescale);
      const duration = Math.max(1, Math.round((sample.duration * 1_000_000) / video.timescale));
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp,
        duration,
        data: asBytes(sample.data),
      }));
    }
    await decoder.flush();
    endFrames();
    await consumer;
    if (pipelineError) throw pipelineError;

    await encoder.flush();
    if (pipelineError) throw pipelineError;
    if (!muxer || encodedSamples !== outputFrameCount) {
      throw new Error(`The H.264 encoder produced ${encodedSamples} samples for ${outputFrameCount} output frames.`);
    }

    if (video.audioTrack) {
      onProgress(outputFrameCount, outputFrameCount, 'mux');
      const audioSamples = demuxed.audio.map((sample) => ({
        data: asBytes(sample.data),
        duration: sample.duration,
        cts: sample.cts,
        dts: sample.dts,
        is_sync: sample.is_sync,
      }));
      muxer.addAudioSamples(audioSamples);
    }
    return muxer.finish();
  } catch (error) {
    endFrames(error);
    await consumer;
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    cache.close();
    if (decoder.state !== 'closed') decoder.close();
    if (encoder.state !== 'closed') encoder.close();
    for (const frame of frameQueue) frame.close();
  }
}
