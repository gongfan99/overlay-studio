# Overlay Studio

Overlay Studio composites a transparent PNG sequence over a constant-frame-rate
MP4 video in the browser. It provides frame-by-frame preview, transform
keyframes, and H.264 MP4 export with the source audio copied through unchanged.

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local Vite URL in desktop Chrome or Chromium. Create a production build
with `npm run build`; preview it with `npm run preview`.

## Use

1. Load an MP4 with constant frame timing.
2. Load a ZIP containing transparent RGBA PNG frames. Filenames with frame
   numbers are sorted numerically.
3. Set the overlay start frame and output end frame. The end frame defaults to
   the MP4 frame count; beyond the source video, its last frame is held, and
   beyond the PNG sequence, its last frame is held.
4. Scrub to a frame, position and scale the overlay, then add keyframes where
   its transform changes.
5. Choose an export quality and download the composited H.264 MP4.

The application checks that WebCodecs can decode the source and encode H.264 at
the source dimensions and frame rate. It lowers the requested bitrate when the
browser requires a more compatible configuration. Media is processed locally;
MP4Box.js and the interface fonts are bundled npm dependencies rather than
runtime CDN imports.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation constraints and
[DESIGN.md](./DESIGN.md) for the interface design system.
