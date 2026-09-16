# Browser Video Overlay Compositor — Architecture

## 1. Purpose

Build a single-page web application for compositing a Blender-rendered transparent PNG sequence over an existing MP4 video, primarily for replacing or augmenting objects in AI-generated video.

Initial use case:

- Base video: MiniMax H3-generated MP4.
- Overlay: Blender-rendered planetary gearset as an RGBA PNG sequence.
- User manually aligns the gearset overlay with the base video.
- Alignment can vary over time using transform keyframes.
- The browser performs the final frame-by-frame composite and exports a new MP4.

The app should run fully client-side for the first version.

---

## 2. Core Workflow

1. User loads:
   - one base MP4 video;
   - one ZIP file containing ordered transparent PNG frames.

2. The app extracts the PNG sequence from the ZIP.

3. The app validates that the base video is constant-frame-rate (CFR) and
   inspects whether the browser can decode the source and encode H.264 at the
   video's dimensions and frame rate. V1 requires CFR input.

4. For preview:
   - a hidden HTML `<video>` element loads the MP4;
   - the app seeks to a selected frame/time;
   - the current video frame is drawn to a preview `<canvas>`;
   - the matching transparent PNG is drawn over it;
   - the current transform is applied.

5. The user adjusts overlay alignment:
   - X position;
   - Y position;
   - scale;
   - rotation;
   - opacity.

6. The user may add transform keyframes at selected video frames.

7. Between transform keyframes, the app interpolates transform values.

8. For final export:
   - MP4Box.js demuxes the input MP4;
   - WebCodecs `VideoDecoder` decodes video frames sequentially;
   - each decoded frame is composited with the matching PNG frame;
   - WebCodecs `VideoEncoder` encodes the composited frames as H.264/AVC;
   - MP4Box.js, or a dedicated MP4 muxer if needed, packages the encoded video into a final MP4.

9. The app copies the original encoded audio track without re-encoding and
   muxes it with the composited H.264 video in an MP4.

10. User downloads the rendered MP4.

---

## 3. High-Level Architecture

```text
+----------------------+
|      User Input      |
|----------------------|
| base.mp4             |
| overlay_frames.zip   |
+----------+-----------+
           |
           v
+----------------------+
|   Asset Load Layer   |
|----------------------|
| MP4 File / Blob      |
| ZIP extraction       |
| PNG frame indexing   |
+----------+-----------+
           |
     +-----+------+
     |            |
     v            v
+---------+   +----------------------+
| Preview |   |    Export Pipeline   |
| Layer   |   |----------------------|
+---------+   | MP4Box demux         |
| <video> |   | WebCodecs decode     |
| Canvas  |   | Canvas/OffscreenCanvas|
| UI      |   | PNG composite        |
+----+----+   | WebCodecs encode     |
     |        | MP4 mux              |
     |        +----------+-----------+
     |                   |
     +---------+---------+
               |
               v
+----------------------+
| Transform / Timeline |
|----------------------|
| frame selection      |
| keyframes            |
| interpolation        |
+----------------------+
               |
               v
+----------------------+
|     Final MP4        |
+----------------------+
```

---

## 4. Recommended Technology Stack

### Frontend

Recommended for v1:

- TypeScript;
- Vite for the development server and production build;
- semantic HTML and browser DOM APIs for the UI;
- HTML Canvas 2D for the first version.

Do not require a frontend UI framework for v1. Keep one typed project state as
the source of truth; UI controls dispatch state changes and DOM-backed view
modules render from that state. Keep media, compositor, timeline, and UI code
in separate framework-independent TypeScript modules. A UI framework such as
React can be added later if the interface grows into complex nested views.

### ZIP

Use a lightweight client-side ZIP library, for example:

- `fflate`

Responsibilities:

- unzip the Blender PNG sequence;
- keep extracted frames in memory as `Blob`, `ArrayBuffer`, or object URLs;
- sort frames numerically.

### MP4 Container

Use MP4Box.js 2.4.1 as a pinned npm dependency so Vite bundles it with the app.

```sh
npm install --save-exact mp4box@2.4.1
```

Import the module namespace in the MP4 media adapters:

```ts
import * as mp4box from 'mp4box';
```

Do not load MP4Box.js from a runtime CDN.

Initial responsibilities:

- demux input MP4 for the export pipeline;
- preferably mux encoded output back to MP4.

If output muxing proves awkward, replace only the muxing component with a
WebCodecs-friendly MP4 muxer that supports H.264 video and passthrough of the
original encoded audio, while retaining MP4Box for demux.

### Codec

Use browser-native WebCodecs:

- `VideoDecoder`
- `VideoEncoder`
- `VideoFrame`
- `EncodedVideoChunk`

WebCodecs handles compressed video frames, but it does **not** directly parse or create MP4 containers. That is why MP4Box or another muxer/demuxer is required.

---

## 5. Input Requirements

### Base Video

Initial supported format:

- MP4
- a video codec supported by the browser's `VideoDecoder`; H.264/AVC is preferred
- constant frame rate (CFR); reject or clearly report unsupported VFR input in v1

The app should inspect:

- width;
- height;
- duration;
- codec;
- frame rate;
- timestamps / sample durations, to validate constant frame timing;
- rotation metadata if present.

### Overlay Sequence

Input is a ZIP containing PNG files.

Recommended Blender naming convention:

```text
gear_000001.png
gear_000002.png
gear_000003.png
...
```

Requirements:

- PNG files use RGBA;
- transparent background;
- all PNGs should have identical dimensions;
- sequence should be numerically sortable;
- one PNG should normally correspond to one video frame.

Do not rely on lexicographic sorting alone.

Example:

```ts
gear_2.png
gear_10.png
```

must sort as `2, 10`, not `10, 2`.

---

## 6. Preview Architecture

The preview pipeline should remain deliberately simple.

### Hidden Video Element

Use an HTML video element only for interactive preview.

Example conceptual structure:

```html
<video hidden></video>
<canvas></canvas>
```

The `<video>` element does not need native controls.

It acts as an easy browser decoder and seek source.

### Frame Navigation

The UI can expose frame numbers even though `<video>` seeks by time.

For constant-frame-rate footage:

```text
time = frameNumber / fps
```

For preview, this is sufficient.

For final export, do not depend on the HTML video element for frame-accurate processing.

### Preview Render

For a selected frame:

1. Compute desired video timestamp.
2. Set `video.currentTime`.
3. Wait for `seeked`.
4. Draw video to canvas.
5. Decode or load the matching PNG.
6. Apply current interpolated transform.
7. Draw PNG over video.

Use `requestVideoFrameCallback()` where useful, but do not make the architecture depend on it.

---

## 7. Overlay Transform Model

Minimum transform parameters:

```ts
interface OverlayTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number; // radians or degrees, pick one internally
  opacity: number;  // 0..1
}
```

Recommended coordinate convention:

- `x`, `y`: overlay center position in output-video pixel coordinates;
- `scale`: uniform scale, where `1.0` is original PNG size;
- `rotation`: clockwise or counterclockwise, documented clearly;
- `opacity`: preview aid and optional final effect.

The first version does **not** require:

- perspective warp;
- skew;
- mesh deformation;
- corner pinning;
- optical flow.

Those can be added later if camera matching becomes difficult.

---

## 8. Transform Keyframes

A single transform for the whole video is often insufficient because the MiniMax camera may move or drift.

Allow the user to define transform keyframes.

Example:

```ts
interface TransformKeyframe {
  frame: number;
  transform: OverlayTransform;
}
```

Example timeline:

```text
Frame 0:
x = 910
y = 520
scale = 0.72
rotation = 0°

Frame 45:
x = 930
y = 500
scale = 0.80
rotation = 2°

Frame 90:
x = 970
y = 470
scale = 0.95
rotation = 4°
```

For frames between keyframes, linearly interpolate each transform value.

Example:

```ts
value =
  startValue +
  t * (endValue - startValue)
```

where:

```text
t = (frame - startFrame) / (endFrame - startFrame)
```

For rotation, normalize angle interpolation if needed to avoid long-path wrapping.

---

## 9. Timeline UI

Minimum useful controls:

- current frame number;
- current timestamp;
- previous frame;
- next frame;
- slider / scrubber;
- play / pause preview;
- X;
- Y;
- scale;
- rotation;
- opacity;
- add/update keyframe;
- delete keyframe;
- jump to previous keyframe;
- jump to next keyframe.

The overlay should also support direct manipulation on the canvas:

- drag to move;
- mouse wheel or handles to scale;
- optional rotation handle.

Numeric fields should remain available for precise adjustment.

---

## 10. PNG Sequence Handling

Do not decode all PNGs into full RGBA pixel buffers immediately unless the clip is very short.

Prefer:

1. unzip files;
2. retain each PNG as compressed bytes / Blob;
3. decode only when needed;
4. optionally cache nearby decoded frames.

Recommended representation:

```ts
interface OverlayFrame {
  index: number;
  filename: string;
  blob: Blob;
}
```

Decoded form can use:

- `ImageBitmap`

because `createImageBitmap()` is efficient and can be used with canvas.

Recommended cache:

```text
current frame
± a small number of neighboring frames
```

For export, decode sequentially.

---

## 11. Frame Mapping

The app needs an explicit policy for matching video frames to PNG frames.

Initial rule:

```text
PNG frame N <-> decoded video frame N
```

V1 assumes CFR input. Count decoded video frames sequentially starting at zero
and match that logical index to the PNG sequence; do not infer the PNG index
from rounded timestamps. Preserve each source frame's timestamp and duration
for encoding and muxing.

Add an overlay start offset:

```ts
overlayStartFrame: number
```

Then:

```text
pngIndex = videoFrame - overlayStartFrame
```

The output end frame is an exclusive frame boundary and defaults to the MP4
frame count. If it exceeds the MP4 frame count, hold the final decoded video
frame. Once `pngIndex` reaches the end of the PNG range, hold the final PNG
frame for the remainder of the output. Before `overlayStartFrame`, draw no
overlay.

Transform keyframes always use MP4 frame indices. For an extended output frame,
use the final MP4 frame index when looking up/interpolating the PNG transform;
the transform is still applied to the PNG layer during compositing.

Useful future options:

- playback-rate adjustment;
- frame hold;
- loop overlay;
- trim start/end.

---

## 12. Export Pipeline

The final render should **not** use repeated HTML `<video>` seeking.

V1 accepts CFR input and exports H.264 video in an MP4 container. The output
keeps the source video's dimensions and frame rate. Its duration defaults to the
source duration, but an end-frame setting can extend it by holding the final
source video frame. The original audio track is retained by copying its encoded
samples without re-encoding.

Use a sequential WebCodecs pipeline.

```text
MP4
  |
  v
MP4Box demux
  |
  v
EncodedVideoChunk
  |
  v
VideoDecoder
  |
  v
VideoFrame
  |
  +---- matching PNG
  |         |
  |         v
  +--> Canvas / OffscreenCanvas
             |
             v
      composited VideoFrame
             |
             v
         VideoEncoder
             |
             v
      EncodedVideoChunk
             |
             v
         MP4 muxer
             |
             v
         output.mp4
```

### Export Steps

For each decoded source frame:

1. Determine its logical frame index.
2. Find corresponding overlay PNG.
3. Determine the interpolated transform.
4. Draw base video frame.
5. Draw overlay PNG with alpha.
6. Create a `VideoFrame` from the composited canvas.
7. Preserve timestamp and duration.
8. Send frame to `VideoEncoder`.
9. Close temporary `VideoFrame` objects promptly.

At encoder output:

1. collect encoded chunks;
2. preserve decoder/encoder timing;
3. mux the H.264 video and copied source audio into MP4;
4. create final Blob;
5. generate download URL.

---

## 13. Canvas Strategy

For v1, Canvas 2D is likely sufficient.

Composition:

```ts
ctx.drawImage(videoFrame, 0, 0, width, height);

ctx.save();
ctx.globalAlpha = opacity;
ctx.translate(x, y);
ctx.rotate(rotation);
ctx.scale(scale, scale);
ctx.drawImage(
  overlay,
  -overlay.width / 2,
  -overlay.height / 2
);
ctx.restore();
```

Potential later optimization:

- `OffscreenCanvas`
- worker-based rendering
- WebGL/WebGPU compositor

Do not start with WebGL unless profiling shows Canvas 2D is too slow.

---

## 14. Audio

The PNG overlay does not affect audio.

V1 must preserve the original MP4 audio track without re-encoding.

Preferred approach:

- demux video and audio;
- process/re-encode only the video track;
- copy original encoded audio samples unchanged;
- mux processed H.264 video plus original audio into the output MP4.

The selected MP4 muxer must support audio sample passthrough and maintain audio/video synchronization when the video track is re-encoded.

---

## 15. Resolution and Frame Rate

Final output should normally match the base MP4:

- width;
- height;
- frame timing;
- frame rate;
- duration.

Do not assume exactly 30 fps. V1 requires CFR input, but the actual detected
frame rate may be any rate supported by the browser's H.264 encoder.

Internally, use timestamps from the MP4 samples / decoded frames for final rendering.

The preview UI can still display an approximate logical frame number.

For CFR input:

```text
frame ≈ round(timestamp_seconds * fps)
```

---

## 16. Variable Frame Rate

VFR input is outside the v1 supported input contract. Detect it during media
inspection and show a clear message asking the user to provide a CFR video.
Supporting VFR later will require an explicit policy for mapping the PNG
sequence to irregularly timed source frames.

---

## 17. Browser Compatibility

Primary target:

- current desktop Chrome / Chromium browsers

Reason:

- strong WebCodecs support;
- good performance;
- mature Canvas and ImageBitmap APIs.

Secondary targets can be added later.

At startup, detect required APIs:

```ts
'VideoDecoder' in window
'VideoEncoder' in window
```

Use `VideoDecoder.isConfigSupported()` to confirm that the source video can be
decoded, and `VideoEncoder.isConfigSupported()` to confirm H.264 encoding at
the source dimensions and frame rate. Derive a default bitrate from output
resolution and frame rate, then validate the encoder configuration and try
lower bitrate candidates if necessary. If no compatible H.264 configuration
is available, show a clear browser requirement message before export.

---

## 18. Performance Principles

### Preview

Optimize for low latency.

Use:

- hidden `<video>`;
- one preview canvas;
- only current PNG frame;
- limited decoded-image cache.

### Export

Optimize for sequential throughput.

Use:

- MP4Box demux;
- WebCodecs decode;
- sequential PNG decode;
- Canvas / OffscreenCanvas composite;
- WebCodecs encode;
- MP4 mux.

Important:

- call `.close()` on `VideoFrame` and `ImageBitmap` when no longer needed;
- avoid keeping full decoded video in memory;
- process frames as a stream;
- limit encoder queue depth;
- periodically yield to UI thread if export runs on main thread.

A later version should move export processing into a Web Worker where practical.

---

## 19. Memory Considerations

A 1920×1080 RGBA decoded frame is approximately:

```text
1920 × 1080 × 4 ≈ 8.3 MB
```

Hundreds of decoded PNGs would consume large amounts of RAM.

Therefore:

- store compressed PNGs;
- decode lazily;
- aggressively release decoded images;
- do not pre-decode entire clips.

The MP4 should also remain as a File/Blob rather than an array of fully decoded frames.

---

## 20. Suggested Module Structure

```text
src/
  app/
    main.ts
    app-controller.ts
    app-state.ts

  media/
    mp4-demuxer.ts
    mp4-muxer.ts
    video-decoder.ts
    video-encoder.ts

  overlay/
    zip-loader.ts
    png-sequence.ts
    overlay-cache.ts

  compositor/
    compositor.ts
    transform.ts
    interpolation.ts

  preview/
    preview-controller.ts
    video-seeker.ts

  export/
    export-controller.ts
    export-pipeline.ts

  timeline/
    timeline-model.ts
    keyframes.ts

  types/
    project.ts
    media.ts

  ui/
    preview-canvas.ts
    timeline-view.ts
    transform-controls.ts
    keyframe-controls.ts
    export-panel.ts
```

---

## 21. Project Model

The state should be serializable.

Example:

```ts
interface CompositorProject {
  version: 1;

  sourceVideo: {
    name: string;
    width: number;
    height: number;
    duration: number;
    fps?: number;
  };

  overlay: {
    zipName: string;
    frameCount: number;
    startFrame: number;
  };

  outputEndFrame: number; // exclusive; defaults to sourceVideo's frame count

  keyframes: TransformKeyframe[];

  exportSettings: {
    codec: 'h264'; // mapped to a browser-supported H.264/AVC encoder configuration
    bitrate?: number; // selected from a resolution/FPS-based default and support checks
  };
}
```

Future feature:

- save/load a project JSON file.

This would allow the user to resume alignment without repeating the work.

---

## 22. MVP Scope

Implement first:

1. Load MP4.
2. Load ZIP containing RGBA PNG sequence.
3. Sort PNGs numerically.
4. Detect base-video metadata, validate CFR timing, and check browser decode and
   H.264 encode support.
5. Show preview canvas.
6. Frame-number navigation.
7. Draw corresponding PNG.
8. Adjust:
   - X;
   - Y;
   - scale;
   - rotation;
   - opacity.
9. Add transform keyframes.
10. Linear interpolation.
11. Export video using:
   - MP4Box demux;
   - WebCodecs decode;
   - Canvas composite;
   - H.264 WebCodecs encode with browser support and bitrate checks;
   - MP4 mux with the original encoded audio track copied through.
12. Download the resulting H.264 MP4 with source audio preserved.

Do not implement advanced tracking or perspective correction in the MVP.

---

## 23. Phase 2 Features

Possible later additions:

- save/load project JSON;
- multiple overlay layers;
- overlay trim;
- overlay time offset;
- easing curves between keyframes;
- separate X/Y scaling;
- perspective / four-corner pinning;
- chroma key;
- masks;
- feathered masks;
- blend modes;
- color correction;
- brightness / contrast / saturation matching;
- shadow layer;
- motion blur;
- automatic object tracking;
- camera-motion estimation;
- WebGL/WebGPU compositor;
- export worker;
- GPU accelerated rendering;
- transparent WebM export;
- ProRes / external high-quality rendering workflow.

---

## 24. Blender Recommendations

For the planetary gearbox overlay:

- render RGBA PNG;
- enable transparent film/background;
- render at the same resolution as the target video where practical;
- match Blender camera perspective to the MiniMax shot as closely as possible;
- maintain exact frame numbering;
- use the same intended FPS as the target video;
- avoid unnecessary empty transparent margins around the gearset if practical.

If the camera angle changes strongly, matching the camera in Blender will usually produce a better result than trying to fix everything with 2D perspective transforms later.

---

## 25. Why PNG Sequence Instead of Transparent WebM

PNG sequence is preferred as the Blender source because it provides:

- lossless frames;
- reliable alpha;
- exact frame correspondence;
- easy recovery if only some frames need re-rendering;
- simple random access;
- no dependency on browser support for alpha-video decoding;
- easier debugging.

A transparent WebM can be generated later for convenience, but should not be the authoritative intermediate format.

---

## 26. Design Principle

Keep preview and final rendering as two separate pipelines.

### Preview

```text
HTMLVideoElement + Canvas
```

Simple, responsive, easy to seek.

### Final Export

```text
MP4Box
  -> WebCodecs decode
  -> Canvas composite
  -> WebCodecs encode
  -> MP4 mux
```

Frame accurate and efficient.

This separation is the central architectural decision for the app.

---

## 27. Implementation Guidance for Codex

Codex should implement the project incrementally.

Recommended milestones:

```text
Milestone 1
Load MP4 + ZIP, validate CFR input, show metadata, and check browser codec support.

Milestone 2
Display an arbitrary source-video frame on canvas.

Milestone 3
Display matching transparent PNG overlay.

Milestone 4
Interactive X/Y/scale/rotation/opacity controls.

Milestone 5
Frame timeline + transform keyframes + interpolation.

Milestone 6
MP4Box + WebCodecs sequential decode.

Milestone 7
Frame-by-frame composite and H.264 encoding with a support-checked bitrate.

Milestone 8
MP4 mux with the original audio track copied through, then download the output.

Milestone 9
Performance cleanup and worker/offscreen rendering if needed.
```

Avoid introducing a server unless browser limitations make it necessary.

The first production target should be Chrome/Chromium desktop.
