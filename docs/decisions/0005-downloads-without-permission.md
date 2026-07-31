# 5. Download without the `downloads` permission

**Status:** accepted · **Date:** 23 July 2026

## Context

The plan asks explicitly (Appendix D): can downloads be initiated cleanly
without requesting the broader `downloads` permission? Every additional
permission widens the install warning and slows Store review.

## Decision

Trigger downloads from the preview page with an anchor element carrying a
`download` attribute and a blob URL. No `downloads` permission is requested.

## Why

- The preview is an extension page, so an anchor click there is an ordinary
  user-initiated download that goes to the browser's download folder with the
  suggested filename.
- `chrome.downloads` would add a permission whose only benefit is programmatic
  control we do not need.
- Fewer permissions is a stated product principle and a competitive advantage.

## Consequences

- Chrome's own duplicate numbering handles filename collisions, which is what the
  plan specifies. Users who prefer distinct names can enable the timestamp
  suffix.
- The download cannot be tracked to completion, so the success message confirms
  the filename rather than a saved path. This is verified end to end by
  intercepting the browser's download event.
