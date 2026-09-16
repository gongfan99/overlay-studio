export interface Mp4TrackInfo {
  id: number;
  type?: string;
  codec: string;
  timescale: number;
  duration: number;
  bitrate?: number;
  nb_samples?: number;
  video?: { width: number; height: number };
  audio?: { sample_rate: number; channel_count: number };
  track_width?: number;
  track_height?: number;
}

export interface Mp4Info {
  duration: number;
  timescale: number;
  isFragmented?: boolean;
  tracks: Mp4TrackInfo[];
}

export interface Mp4Sample {
  data: Uint8Array | ArrayBuffer;
  dts: number;
  cts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
  number: number;
}

export interface Mp4SampleEntry {
  type?: string;
  avcC?: Mp4WritableBox;
  hvcC?: Mp4WritableBox;
  vpcC?: Mp4WritableBox;
  av1C?: Mp4WritableBox;
  esds?: Mp4WritableBox;
  boxes?: Mp4WritableBox[];
}

export interface Mp4WritableBox {
  write(stream: Mp4DataStream): void;
}

export interface Mp4DataStream {
  buffer: ArrayBuffer;
  position: number;
}

export interface Mp4InternalTrack {
  samples?: Mp4Sample[];
  mdia: {
    minf: {
      stbl: {
        stsd: { entries: Mp4SampleEntry[] };
      };
    };
  };
}

export interface Mp4BoxFile {
  onReady?: (info: Mp4Info) => void;
  onSamples?: (trackId: number, user: unknown, samples: Mp4Sample[]) => void;
  onError?: (error: string) => void;
  appendBuffer(buffer: ArrayBuffer & { fileStart: number }): number;
  flush(): void;
  start(): void;
  stop(): void;
  setExtractionOptions(trackId: number, user?: unknown, options?: { nbSamples?: number }): void;
  releaseUsedSamples(trackId: number, sampleNumber: number): void;
  getTrackById(trackId: number): Mp4InternalTrack;
  addTrack(options: Record<string, unknown>): number;
  addSample(trackId: number, data: Uint8Array<ArrayBuffer>, options?: Record<string, number | boolean>): unknown;
  getBuffer(): Mp4DataStream;
}

export interface Mp4BoxApi {
  createFile(keepMdatData?: boolean): Mp4BoxFile;
  DataStream: {
    new (buffer?: ArrayBuffer, byteOffset?: number, endianness?: number): Mp4DataStream;
    BIG_ENDIAN: number;
  };
}
