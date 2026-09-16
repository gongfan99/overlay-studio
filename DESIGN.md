# Design System

## Direction

Use a dark, precise video-editing workbench inspired by the visual language of
[invideo's online video editor](https://invideo.io/make/online-video-editor/).
The reference combines layered charcoal surfaces, crisp light text, restrained
dividers, editorial display typography, and clear interactive accents. Apply
that language to a focused compositing workspace where the video preview stays
the visual center.

## Typography

- **Interface:** Inter, with `system-ui`, `-apple-system`, and sans-serif
  fallbacks. Use 14–15 px / 1.5 line-height for normal controls and body text.
- **Display headings:** Lora or a Georgia-compatible serif fallback for the
  application title and major empty-state headings. Use 28–32 px, regular
  weight, and tight line-height. Keep panel headings in Inter.
- **Frame numbers and timecodes:** JetBrains Mono or a system monospace at
  12–13 px, using tabular numerals when available.
- **Control labels:** 12–13 px, medium weight. Use sentence case and keep
  labels short.
- Use 20–24 px for section headings and 16–18 px for panel headings. Avoid
  oversized marketing-style type inside the editing workspace.

## Color tokens

The base palette follows the reference's warm charcoal surfaces and soft white
text. Blue marks active controls and focus; teal can identify the overlay track
on the timeline.

```css
:root {
  --color-workspace: #0b0a08;
  --color-surface-1: #11100f;
  --color-surface-2: #181715;
  --color-surface-3: #1f1e1c;

  --color-text-primary: #fafafa;
  --color-text-secondary: #c6c4c0;
  --color-text-muted: #82807d;

  --color-border-subtle: #252422;
  --color-border-default: #343331;
  --color-border-strong: #565553;

  --color-action: #fafafa;
  --color-action-text: #0a0907;
  --color-interactive: #277cee;
  --color-interactive-hover: #1c7df4;
  --color-overlay-track: #2da5b3;
  --color-overlay-track-light: #cdeef3;

  --color-success: #10a86a;
  --color-warning: #e8962e;
  --color-danger: #e5533a;
}
```

Use the light action color for the main export or confirm button, with dark
text. Use blue for selection, keyboard focus, handles, and the current playhead.
Use teal for the overlay track and related media indicators. Keep status colors
for status feedback. Reserve pure black for the video stage and true-black
canvas areas.

## Spacing and shape

Use a 4 px base spacing unit. Prefer these values for padding, gaps, and control
layout:

| Token      |  Size | Typical use                       |
| ---------- | ----: | --------------------------------- |
| `space-1`  |  4 px | Icon-to-label gap, fine alignment |
| `space-2`  |  8 px | Compact control spacing           |
| `space-3`  | 12 px | Field groups and toolbar gaps     |
| `space-4`  | 16 px | Standard panel padding            |
| `space-6`  | 24 px | Section spacing                   |
| `space-8`  | 32 px | Major layout separation           |
| `space-12` | 48 px | Empty-state breathing room        |

- Standard buttons and inputs: 34–40 px high.
- Panel padding: 16 px; use 20–24 px for larger empty states or upload cards.
- Use 6 px, 8 px, and 10 px radii for controls and panels; reserve 14–20 px
  radii for larger preview frames, dialogs, and upload cards.
- Use 1 px dividers in the low-contrast border colors. Add shadows only to
  floating menus, dialogs, and other surfaces that need separation.

## Workspace layout

- Keep a compact top bar around 56–60 px high for project name, source status,
  undo/redo, and export.
- Give the central video preview the most space. Surround it with the darkest
  workspace surface so the image remains clear and visually dominant.
- Use a left asset/navigation panel around 240–280 px wide and a right
  transform/keyframe panel around 280–320 px wide on desktop.
- Dock the timeline beneath the preview and controls. Keep frame/timecode text
  monospace and make the playhead and selected keyframe easy to distinguish.
- On narrow screens, collapse the side panels into drawers and keep the preview
  and timeline usable without horizontal page scrolling.

## Components and interaction

- Primary buttons use a light fill with dark text. Secondary buttons use a
  charcoal surface, a subtle border, and light text.
- Inputs use a raised charcoal surface, a quiet border, and a blue focus ring.
- Selected controls, active tabs, transform handles, and the playhead use the
  interactive blue. Keep hover states subtle and visible.
- Use teal consistently for the overlay sequence in the timeline. Use neutral
  gray for the base-video track.
- Keep transform controls compact and aligned. Pair each numeric value with a
  clear label and units where needed.
- Use thin separators and subtle surface changes to group tools instead of
  heavy outlines or repeated cards.
- Provide visible keyboard focus, sufficient contrast, and state cues that do
  not depend on color alone.

## Source notes

The reference page's rendered CSS uses Inter for interface text, Lora for its
large editorial heading, JetBrains Mono for monospaced details, layered dark
surfaces, and rounded UI corners. Its editor-style details include blue and
teal accents. The tokens above adapt those observed qualities to this app's
preview, transform controls, and overlay timeline.
