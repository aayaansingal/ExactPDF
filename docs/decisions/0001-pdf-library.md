# 1. Use pdf-lib for local PDF generation

**Status:** accepted · **Date:** 23 July 2026

## Context

The plan requires PDF generation entirely on the user's device, inside a
Manifest V3 extension, for both an image-based Exact mode and a searchable
Document mode. The candidates were pdf-lib, pdfmake, and driving Chrome's own
print pipeline.

## Decision

Use **pdf-lib** for both modes.

## Why

- It is a pure byte-level PDF writer with no DOM dependency, so it runs in a
  service worker and in a web worker. pdfmake assumes a document layout model we
  would have to fight for Exact mode.
- It supports exactly what both modes need: embedding JPEG and PNG, drawing text
  with the 14 standard fonts, and constructing link annotations directly.
- Chrome's print pipeline was rejected outright: it means the print dialogue, and
  removing the print dialogue is the product's core promise.

## Consequences

- **Layout is ours to write.** pdf-lib draws; it does not paginate. Line
  breaking, page breaking and table layout live in `src/pdf/documentLayout.ts`,
  which is a deliberate cost paid for full control over page breaks.
- **The standard fonts limit Document mode to Latin scripts.** See decision 3.
- **The renderer is the largest dependency in the bundle**, at roughly 820 kB
  unminified in the worker chunk. It is loaded only by the preview page, not by
  the popup or the content scripts, so it never affects capture latency.
