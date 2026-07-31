# Changelog

All notable changes to ExactPDF are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — unreleased

First complete implementation. Not yet submitted to the Chrome Web Store.

### Added

- **Four capture modes.** Select Element with plain-language labels and
  arrow-key widening or narrowing; Select Region with a movable, resizable
  rectangle and live pixel dimensions; Full Page with scroll-tile capture; and
  Clean Document extraction with searchable output.
- **Exact and Document export modes**, with the trade-off between them stated in
  the interface rather than implied.
- **Live preview.** The preview pane renders the actual generated PDF, so page
  size, orientation, margins, background, quality and metadata changes are
  visible before saving.
- **Page sizing.** Original, Continuous (single page), A4 and Letter, with
  automatic, portrait and landscape orientation.
- **Automatic blank-space cropping** for element and region captures, using
  border-colour sampling that works on light and dark pages alike.
- **Sticky-element suppression**, so a fixed header appears once rather than on
  every tile of a long capture.
- **Bounded lazy-content loading**, with the result flagged when content had not
  finished loading.
- **Smart filenames** following `{page-title}_{content-label}_{YYYY-MM-DD}.pdf`,
  with an optional timestamp suffix.
- **Optional metadata**: page title, source URL, capture date, and a per-page
  footer, all off unless chosen.
- **Versioned settings** with field-by-field migration, so a corrupted or older
  record degrades to defaults rather than resetting everything.
- **Typed, recoverable errors.** Every failure carries a plain-language message
  and a concrete next step.
- **Keyboard shortcuts** for element and region capture, and Cmd/Ctrl+S to save
  from the preview.

### Security and privacy

- No remote code, no `eval`, and a restrictive extension content security policy.
- Allowlist-based sanitization of all extracted content.
- Four permissions only: `activeTab`, `scripting`, `storage`, `contextMenus`.
  No `<all_urls>`, no `debugger`, no `downloads`, and no host permissions.
- Captures held in session storage and deleted on save, cancellation, expiry,
  and service-worker startup.

### Testing

- 240 unit and integration tests, plus 12 real-browser end-to-end tests.
- Ten generated fixture pages covering the compatibility matrix.
