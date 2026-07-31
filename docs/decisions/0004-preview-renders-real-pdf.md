# 4. The preview renders the real PDF

**Status:** accepted · **Date:** 23 July 2026

## Context

The plan lists "the preview corresponds to the downloaded file's orientation,
margins, and page size" as a release-blocking acceptance test. The obvious
implementation is an HTML mock-up of the page geometry, which is cheap but is a
second implementation of the layout that can drift from the renderer.

## Decision

Generate the actual PDF on every settings change, debounced, and display it in an
`<iframe>` through Chrome's built-in PDF viewer. The bytes shown are the bytes
downloaded.

## Why

- Correspondence is guaranteed by construction rather than by testing, because
  there is only one layout implementation.
- Users get the real reading experience, including how text actually wraps and
  where pages actually break.
- It removes a whole category of "the preview lied" defects.

## Consequences

- Rendering runs on every change, so it is debounced by 260 ms and executed in a
  web worker to keep the controls responsive.
- Superseded renders must be discarded by request id, or a slow earlier render
  can overwrite a newer one.
- Blob URLs are revoked as they are replaced, otherwise a long preview session
  accumulates megabytes of dead objects.
