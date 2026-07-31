# ExactPDF

**Select and save web content as PDF — locally, and without the print dialogue.**

ExactPDF is a Chrome extension that converts exactly what you select on a webpage
into a clean PDF. Pick an element, drag a region, take the whole scrollable page,
or extract just the article. Everything is converted on your own machine.

> **Status:** version 1.0.0, pre-release. Not yet published to the Chrome Web Store.

---

## What it does

| Mode               | What you get                                                                      |
| ------------------ | --------------------------------------------------------------------------------- |
| **Select Element** | Point at a diagram, table or section; capture just that, cropped to its edges.    |
| **Select Region**  | Drag a box anywhere on screen, then nudge and resize it before capturing.         |
| **Full Page**      | The whole scrollable page, stitched together, with sticky headers appearing once. |
| **Clean Document** | The article as searchable text with working links, minus navigation and ads.      |

Every capture opens a preview where you choose the output mode, page size,
orientation, margins, background, quality, filename and metadata — and the
preview _is_ the generated PDF, so what you see is what downloads.

### Exact or Document?

|              | Optimises for                        | Trade-off                                     | Best for                                      |
| ------------ | ------------------------------------ | --------------------------------------------- | --------------------------------------------- |
| **Exact**    | Visual fidelity                      | Image-based, larger file, text not selectable | Diagrams, interfaces, charts, unusual layouts |
| **Document** | Searchable text and clean pagination | Simplifies complex styling                    | Articles, documentation, conversations        |

## Privacy

ExactPDF has no server and no account. No page content, screenshot, extracted
text, URL, page title or PDF is transmitted anywhere. Conversion happens in the
extension, on your device. See [PRIVACY.md](PRIVACY.md).

Only four permissions are requested, each tied to a visible feature:

| Permission     | Why                                                                                  |
| -------------- | ------------------------------------------------------------------------------------ |
| `activeTab`    | Temporary access to the tab you are on, granted only after you invoke the extension. |
| `scripting`    | Injects the selection overlay or extraction code for the mode you chose.             |
| `storage`      | Saves your export preferences and hands the in-progress capture to the preview tab.  |
| `contextMenus` | Adds the right-click "Save … as PDF" actions.                                        |

There is deliberately **no** `<all_urls>`, no `debugger`, no `downloads`, no
`tabs`, no history and no cookie access. Downloads are started from a blob URL on
the extension's own page, which needs no additional permission.

## Install from source

```bash
npm install
npm run build
```

Then in Chrome: **Extensions → Manage extensions → Developer mode → Load
unpacked**, and choose the generated `dist/` folder.

## Development

```bash
npm run dev          # rebuild on change
npm test             # unit and integration tests
npm run test:e2e     # end-to-end tests in a real browser
npm run verify       # format, lint, typecheck and test
npm run package      # production build plus a store-ready ZIP
```

Requires Node 20 or newer. `npm run test:e2e` needs a Chromium-based browser
installed; it skips cleanly when none is found.

### Repository layout

```
src/background/       service worker and capture orchestration
src/content/          selection overlays and page extraction
src/capture/exact/    tiled visual capture, stitching, auto-crop
src/capture/document/ semantic extraction and sanitization
src/pdf/              PDF rendering and page layout
src/preview/          preview application
src/popup/            toolbar popup
src/options/          settings and help
src/shared/           contracts, errors, utilities, constants
tests/unit/           deterministic module tests
tests/integration/    messaging, storage and renderer tests
tests/e2e/            real-browser workflows
tests/fixtures/sites/ generated difficult-page fixtures
docs/                 architecture, privacy, compatibility, decisions
```

## Documentation

- [Architecture](docs/architecture.md)
- [Compatibility](docs/compatibility.md) — what works, what does not, and why
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Decision records](docs/decisions/)

## Known limitations

- Chrome blocks extensions from its own pages (`chrome://`, parts of the Web
  Store). Those cannot be captured at all.
- Cross-origin frames may not expose their contents; a region capture still works.
- Very long and infinite-scrolling pages are captured up to a defined limit.
- Document mode uses the fonts built into every PDF reader, which cover Latin
  scripts. Other writing systems are preserved by Exact mode instead.
- Canvas and WebGL content has no underlying text, so it is captured visually.

## Acceptable use

ExactPDF captures content already visible to you in your browser. You are
responsible for respecting copyright, confidentiality and website terms. It is
not a tool for bypassing paywalls, logins, DRM or download controls, and it
contains no logic for extracting protected audio or video.

## Licence

[MIT](LICENSE)
