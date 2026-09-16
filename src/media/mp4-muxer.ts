import { MP4Box } from './mp4-demuxer';
import type { AudioTrackInfo, VideoAssetInfo } from '../types/project';
import type { Mp4BoxFile, Mp4SampleEntry, Mp4WritableBox } from './mp4box-types';

export interface Mp4MuxerSession {
  file: Mp4BoxFile;
  videoTrackId: number;
  audioTrackId?: number;
  addVideoSample(data: Uint8Array, options: { duration: number; cts: number; dts: number; is_sync: boolean }): void;
  addAudioSamples(samples: readonly { data: Uint8Array | ArrayBuffer; duration: number; cts: number; dts: number; is_sync: boolean }[]): void;
  finish(): Blob;
}

function getBoxChildren(entry: Mp4SampleEntry): Mp4WritableBox[] {
  return entry.boxes ?? (entry.esds ? [entry.esds] : []);
}

export function createMp4Muxer(
  video: VideoAssetInfo,
  videoCodec: string,
  videoDecoderConfig: Uint8Array,
  audioTrack: AudioTrackInfo | undefined,
  audioSampleEntry: Mp4SampleEntry | undefined,
): Mp4MuxerSession {
  const file = MP4Box.createFile();
  const avcConfigBuffer = videoDecoderConfig.slice().buffer as ArrayBuffer;
  const videoTrackId = file.addTrack({
    type: 'avc1',
    width: video.width,
    height: video.height,
    timescale: video.timescale,
    language: 'und',
    name: 'Overlay Studio H.264 video',
    avcDecoderConfigRecord: avcConfigBuffer,
    codec: videoCodec,
  });
  if (!videoTrackId) throw new Error('MP4Box could not create the H.264 output track.');

  let audioTrackId: number | undefined;
  if (audioTrack) {
    if (!audioSampleEntry) throw new Error('The original audio track description is missing; audio cannot be preserved.');
    audioTrackId = file.addTrack({
      type: audioSampleEntry.type ?? 'mp4a',
      hdlr: 'soun',
      width: 0,
      height: 0,
      timescale: audioTrack.timescale,
      language: 'und',
      name: 'Original audio',
      samplerate: audioTrack.sampleRate,
      channel_count: audioTrack.channelCount,
      samplesize: 16,
      description_boxes: getBoxChildren(audioSampleEntry),
    });
    if (!audioTrackId) throw new Error('MP4Box could not create a passthrough audio track.');
  }

  return {
    file,
    videoTrackId,
    audioTrackId,
    addVideoSample(data, options) {
      file.addSample(videoTrackId, data as Uint8Array<ArrayBuffer>, options);
    },
    addAudioSamples(samples) {
      if (!audioTrackId) return;
      for (const sample of samples) {
        const data = sample.data instanceof Uint8Array ? sample.data : new Uint8Array(sample.data);
        file.addSample(audioTrackId, data as Uint8Array<ArrayBuffer>, {
          duration: sample.duration,
          cts: sample.cts,
          dts: sample.dts,
          is_sync: sample.is_sync,
        });
      }
    },
    finish() {
      const stream = file.getBuffer();
      const bytes = stream.buffer.slice(0, stream.position);
      return new Blob([bytes], { type: 'video/mp4' });
    },
  };
}
