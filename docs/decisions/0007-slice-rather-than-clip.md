# 7. Re-encode each page slice rather than clip a shared image

**Status:** accepted · **Date:** 23 July 2026

## Context

When one tall capture spans several pages, there are two ways to draw it. Embed
the image once and draw it at a different offset on each page, relying on the
MediaBox to clip it; or cut the capture into one image per page and embed each.

The first is smaller: one image object for the whole document.

## Decision

Slice the capture and embed one image per page, using an `OffscreenCanvas` in the
render worker.

## Why

- PDF clips to the MediaBox, not to the content box. With non-zero margins, the
  neighbouring page's content bleeds into the top and bottom margins — visible,
  wrong, and not fixable without painting over it.
- Painting over the margins requires an opaque background, which makes the
  transparent-background option impossible to honour.
- Slicing keeps the output matching the preview under every combination of
  margins and background, which decision 4 makes a correctness requirement.

## Consequences

- Total encoded pixels are roughly the same either way, so file size is
  comparable in practice; the saving would have been in object overhead only.
- Each render decodes the stitched capture once and reuses the bitmap across
  slices, since decoding a large screenshot repeatedly would dominate the cost.
- The slicer is an interface, so the renderer is testable without a browser.
