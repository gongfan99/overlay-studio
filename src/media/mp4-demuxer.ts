import * as MP4BoxModule from 'mp4box';
import type { AudioTrackInfo, RationalRate, VideoAssetInfo } from '../types/project';
import type { Mp4BoxApi, Mp4BoxFile, Mp4Info, Mp4InternalTrack, Mp4Sample, Mp4SampleEntry } from './mp4box-types';

const MP4Box = MP4BoxModule as unknown as Mp4BoxApi;

export interface InspectedVideo {
  metadata: VideoAssetInfo;
  videoSampleEntry: Mp4SampleEntry;
  audioSampleEntry?: Mp4SampleEntry;
}

export interface DemuxedSamples {
  video: Mp4Sample[];
  audio: Mp4Sample[];
  audioSampleEntry?: Mp4SampleEntry;
}

function getTracks(info: Mp4Info): { video: Mp4Info['tracks'][number]; audio?: Mp4Info['tracks'][number] } {
  const video = info.tracks.find((track) => track.type === 'video' || Boolean(track.video));
  const audio = info.tracks.find((track) => track.type === 'audio' || Boolean(track.audio));
  if (!video) throw new Error('The MP4 does not contain a video track.');
  return { video, audio };
}

function withFileStart(buffer: ArrayBuffer, fileStart: number): ArrayBuffer & { fileStart: number } {
  const tagged = buffer as ArrayBuffer & { fileStart: number };
  tagged.fileStart = fileStart;
  return tagged;
}

async function parseMetadata(file: File): Promise<{ parser: Mp4BoxFile; info: Mp4Info }> {
  const parser = MP4Box.createFile();
  const parsed = new Promise<Mp4Info>((resolve, reject) => {
    parser.onReady = resolve;
    parser.onError = (error) => reject(new Error(`Could not parse MP4: ${error}`));
  });

  const chunkSize = 2 * 1024 * 1024;
  let offset = 0;
  let received: Mp4Info | undefined;
  const ready = parsed.then((info) => { received = info; return info; });

  while (offset < file.size && !received) {
    const end = Math.min(file.size, offset + chunkSize);
    parser.appendBuffer(withFileStart(await file.slice(offset, end).arrayBuffer(), offset));
    offset = end;
    await Promise.resolve();
  }

  if (!received) {
    parser.flush();
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Could not read MP4 track metadata.')), 3000)),
    ]);
  }
  return { parser, info: received ?? await ready };
}

function serializeConfigBox(entry: Mp4SampleEntry): Uint8Array {
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) throw new Error('The video track does not contain a supported decoder configuration box.');
  const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
  box.write(stream);
  if (stream.position <= 8) throw new Error('The video decoder configuration is empty.');
  return new Uint8Array(stream.buffer.slice(8, stream.position));
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function getConstantFrameRate(
  internalTrack: Mp4InternalTrack,
  timescale: number,
  expectedFrameCount: number,
): { fps: number; frameRate: RationalRate; frameCount: number } {
  const samples = internalTrack.samples ?? [];
  if (samples.length < 2 || (expectedFrameCount > 0 && samples.length !== expectedFrameCount)) {
    throw new Error('Could not validate the video frame timing. Use a standard, non-fragmented CFR MP4.');
  }

  const presentationTimes = samples.map((sample) => sample.cts).sort((a, b) => a - b);
  const intervals = presentationTimes.slice(1).map((pts, index) => pts - presentationTimes[index]);
  if (intervals.some((interval) => interval <= 0)) {
    throw new Error('The video has duplicate or invalid frame timestamps and cannot be used as CFR input.');
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
  const tolerance = Math.max(1, median * 0.005);
  if (intervals.some((interval) => Math.abs(interval - median) > tolerance)) {
    throw new Error('Variable-frame-rate video is not supported yet. Please provide a constant-frame-rate MP4.');
  }

  // Use the average presentation interval so timescale quantization (for
  // example alternating 33/34-tick intervals at 30 fps in a 1 kHz track)
  // does not skew the inferred frame rate toward one rounded interval.
  const span = presentationTimes[presentationTimes.length - 1] - presentationTimes[0];
  const rateNumerator = timescale * intervals.length;
  const divisor = greatestCommonDivisor(rateNumerator, span);
  const frameRate = { numerator: rateNumerator / divisor, denominator: span / divisor };
  return { fps: frameRate.numerator / frameRate.denominator, frameRate, frameCount: samples.length };
}

export async function inspectMp4(file: File): Promise<InspectedVideo> {
  if (!('VideoDecoder' in window)) throw new Error('This browser does not support WebCodecs video decoding. Use desktop Chrome or Chromium.');

  const { parser, info } = await parseMetadata(file);
  const { video, audio } = getTracks(info);
  const videoInternal = parser.getTrackById(video.id);
  const videoEntry = videoInternal.mdia.minf.stbl.stsd.entries[0];
  if (!videoEntry) throw new Error('The MP4 video track is missing its sample description.');
  const decoderDescription = serializeConfigBox(videoEntry);
  const width = video.video?.width ?? video.track_width ?? 0;
  const height = video.video?.height ?? video.track_height ?? 0;
  if (!width || !height) throw new Error('Could not determine the video dimensions.');

  const rate = getConstantFrameRate(videoInternal, video.timescale, video.nb_samples ?? 0);
  const decoderConfig = {
    codec: video.codec,
    codedWidth: width,
    codedHeight: height,
    description: decoderDescription,
  };
  const decoderSupport = await VideoDecoder.isConfigSupported(decoderConfig);
  if (!decoderSupport.supported) throw new Error(`This browser cannot decode ${video.codec} video through WebCodecs.`);

  let audioTrack: AudioTrackInfo | undefined;
  let audioEntry: Mp4SampleEntry | undefined;
  if (audio) {
    const internalAudio = parser.getTrackById(audio.id);
    audioEntry = internalAudio.mdia.minf.stbl.stsd.entries[0];
    audioTrack = {
      id: audio.id,
      codec: audio.codec,
      timescale: audio.timescale,
      sampleRate: audio.audio?.sample_rate ?? 0,
      channelCount: audio.audio?.channel_count ?? 2,
      sampleEntry: audioEntry,
    };
  }

  const duration = video.duration / video.timescale;
  const metadata: VideoAssetInfo = {
    fileName: file.name,
    width,
    height,
    duration,
    fps: rate.fps,
    frameRate: rate.frameRate,
    frameCount: rate.frameCount,
    codec: video.codec,
    trackId: video.id,
    timescale: video.timescale,
    decoderDescription,
    audioTrack,
  };
  return { metadata, videoSampleEntry: videoEntry, audioSampleEntry: audioEntry };
}

export async function demuxSamples(file: File, videoTrackId: number, audioTrackId?: number): Promise<DemuxedSamples> {
  const parser = MP4Box.createFile();
  const video: Mp4Sample[] = [];
  const audio: Mp4Sample[] = [];
  let metadata: Mp4Info | undefined;
  let audioSampleEntry: Mp4SampleEntry | undefined;

  await new Promise<void>(async (resolve, reject) => {
    let completed = false;
    const fail = (error: Error) => {
      if (completed) return;
      completed = true;
      reject(error);
    };
    parser.onError = (error) => fail(new Error(`Could not demux the MP4: ${error}`));
    parser.onReady = (info) => {
      metadata = info;
      try {
        parser.setExtractionOptions(videoTrackId, 'video', { nbSamples: 24 });
        if (audioTrackId !== undefined) {
          parser.setExtractionOptions(audioTrackId, 'audio', { nbSamples: 64 });
          const sourceAudioTrack = parser.getTrackById(audioTrackId);
          audioSampleEntry = sourceAudioTrack.mdia.minf.stbl.stsd.entries[0];
        }
        parser.onSamples = (trackId, user, samples) => {
          const destination = trackId === videoTrackId ? video : trackId === audioTrackId ? audio : undefined;
          if (!destination) return;
          for (const sample of samples) {
            const bytes = sample.data instanceof Uint8Array ? sample.data.slice() : new Uint8Array(sample.data.slice(0));
            destination.push({ ...sample, data: bytes });
          }
          const last = samples[samples.length - 1];
          if (last) parser.releaseUsedSamples(trackId, last.number + 1);
        };
        parser.start();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    try {
      const buffer = await file.arrayBuffer();
      parser.appendBuffer(withFileStart(buffer, 0));
      parser.flush();
      if (metadata && !completed) {
        completed = true;
        resolve();
      } else if (!metadata && !completed) {
        fail(new Error('Could not read MP4 track metadata.'));
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  if (video.length === 0) throw new Error('No video samples were found in the MP4.');
  if (audioTrackId !== undefined && audio.length === 0) throw new Error('The MP4 audio track could not be read for passthrough.');
  return { video, audio, audioSampleEntry };
}

export { MP4Box };
