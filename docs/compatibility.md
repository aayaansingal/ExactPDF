# Compatibility

## Browsers

| Browser                                                      | Status                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| Chrome (current stable), macOS and Windows                   | Required at launch                            |
| Brave, Microsoft Edge, other Chromium desktop browsers       | Best effort                                   |
| Chrome on iOS or Android, Safari, Firefox                    | Not supported                                 |
| Browser-internal pages (`chrome://`, parts of the Web Store) | Cannot be supported — Chrome blocks injection |

Minimum Chrome version: 120.

## Page categories

Each category has a generated fixture in `tests/fixtures/sites/`, produced by
`build-fixtures.mjs`. They are generated rather than hand-written so that the
difficult properties are exact and reproducible; nothing in them uses randomness,
the network, the current date or a webfont.

| Category             | Fixture                | Principal risks                                | Handling                                                                           |
| -------------------- | ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Static article       | `static-article.html`  | Page breaks, missing images                    | Both modes. Document mode is the better fit.                                       |
| Documentation        | `documentation.html`   | Code overflow, unwanted side navigation        | Document mode strips `nav`; long code lines are hard-wrapped.                      |
| AI conversation      | `ai-conversation.html` | Virtualization, lazy loading, wide code blocks | Lazy content primed with a bounded scroll pass before capture.                     |
| LMS / authenticated  | `lms-page.html`        | Private content handling                       | Captured locally like any other page; never transmitted.                           |
| Data table           | `data-table.html`      | Sticky header repeating, column widths         | Sticky elements hidden after the first tile; column widths from content.           |
| Image-heavy          | `image-heavy.html`     | CORS, resolution, incomplete loading           | Exact mode always works. Document mode drops images it cannot fetch.               |
| Infinite scroll      | `infinite-scroll.html` | Unbounded capture, duplicated content          | Hard limit of 60,000 CSS px, with a warning above 20,000.                          |
| Canvas or chart      | `canvas-chart.html`    | No accessible DOM                              | Exact mode only; Document mode reports low confidence.                             |
| Dark mode            | `dark-mode.html`       | Background handling, unreadable forced-light   | Background preset: Preserve, Force light, or Transparent.                          |
| Complex fixed layout | `complex-fixed.html`   | Repeated overlays, seams                       | Fixed and sticky elements detected by computed position and hidden after tile one. |

## Limits

| Limit                 | Value                 | Why                                                                                       |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| Maximum page height   | 60,000 CSS px         | Bounds infinite scroll.                                                                   |
| Long-page warning     | 20,000 CSS px         | Sets expectations before a slow capture.                                                  |
| Maximum capture area  | 120,000,000 device px | Stays well inside Chrome's canvas limit. Beyond it, scale is reduced rather than failing. |
| Minimum capture scale | 0.5×                  | Below this the result stops being legible; the capture is refused instead.                |
| Lazy-load wait        | 6 seconds             | Bounded, because an infinite feed never reports "done".                                   |
| Screenshot interval   | 550 ms                | `captureVisibleTab` is rate limited to about two calls per second.                        |
| Session lifetime      | 15 minutes            | An abandoned preview should not hold a screenshot indefinitely.                           |
| Maximum PDF dimension | 14,400 pt             | A hard limit of the PDF format itself.                                                    |

## Known limitations

**Chrome-internal pages.** `chrome://`, `devtools://`, `view-source:`, other
extensions and parts of the Chrome Web Store cannot be read by any extension.
The popup detects these and explains before you try.

**Cross-origin frames.** Content inside a frame from another site may not be
readable. Region capture still works, because it photographs what is on screen.

**Non-Latin scripts in Document mode.** ExactPDF ships no font files, so Document
mode covers Latin scripts. Characters outside that range are transliterated where
an honest equivalent exists and otherwise shown as `?`, with the preview
reporting how many were affected and pointing at Exact mode. See
[decision 3](decisions/0003-standard-fonts.md).

**Canvas and WebGL.** No underlying text exists, so these are captured visually.

**Virtualized lists.** Content that is removed from the DOM as it scrolls out of
view may be missing from the capture. The result is flagged when lazy content did
not settle.

**Very large captures.** Beyond the pixel budget the capture scale is reduced
automatically. If the payload still exceeds the session storage quota, the
capture is discarded and a lower-quality retry is offered rather than failing
silently.

## Reporting a gap

Open an issue with the page category and what went wrong. Compatibility fixes
land with a regression test, so a self-contained fixture is the most useful thing
you can provide — see [CONTRIBUTING.md](../CONTRIBUTING.md).
