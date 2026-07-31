# Chrome Web Store listing

Source copy for the submission. Keep this in step with the manifest, README and
privacy policy — reviewers compare them, and inconsistency is a rejection reason.

## Name

ExactPDF - Select and Save Web Content as PDF

## Short description (132 characters max)

> Select any webpage element, region, image, or complete page and save it as a clean PDF - locally and without the print dialogue.

(131 characters.)

## Single purpose

ExactPDF captures user-selected web content and converts it into a locally
generated PDF.

## Detailed description

**Save exactly what you select, as a clean PDF.**

ExactPDF turns any part of a webpage into a PDF without the print dialogue, and
without sending anything to a server.

**Four ways to capture**

• Select Element — point at a diagram, table or section and capture just that,
cropped to its edges
• Select Region — drag a box anywhere on screen, then move and resize it before
capturing
• Full Page — the whole scrollable page, stitched together, with sticky headers
appearing once instead of on every screen
• Clean Document — the article as searchable text with working links, without
navigation, ads or cookie banners

**Two output modes, with the trade-off stated plainly**

• Exact keeps the page's exact appearance. Best for diagrams, charts and
interfaces. Larger file; text is not selectable.
• Document produces searchable text and clean pagination. Best for articles and
documentation. Complex styling is simplified.

**Control before you save**

Preview the actual PDF before downloading, and adjust the page size (original,
continuous, A4, Letter), orientation, margins, background, quality, filename and
metadata. What you see in the preview is the file you get.

**Private by design**

Everything is converted on your device. No page content, screenshot, text, URL,
title or PDF is ever transmitted. There is no server and no account. ExactPDF
requests four permissions and no host permissions — no access to all sites, no
debugger, no browsing history, no cookies.

**Sensible filenames**

Files are named from the page title, what you captured and the date, so you can
find them later without renaming anything.

ExactPDF captures content that is already visible to you. You are responsible for
respecting copyright, confidentiality and website terms.

## Category

Productivity / Workflow & Planning

## Permission justifications

| Permission     | Justification                                                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`    | Grants temporary access to the tab the user is looking at, only after they click the ExactPDF toolbar button or a context-menu item. This is what allows the extension to read the selected element and take the screenshot used for the PDF, without any standing access to browsing activity. |
| `scripting`    | Injects the selection overlay and the content-extraction code into the active tab for the capture mode the user chose. No code is fetched remotely; every injected file ships inside the extension package.                                                                                     |
| `storage`      | Stores the user's export preferences (page size, margins, quality, filename options) and hands the in-progress capture to the preview tab using session storage that is cleared when the browser closes.                                                                                        |
| `contextMenus` | Adds the right-click actions "Save selected element as PDF" and "Save image as PDF" so a capture can be started without opening the popup.                                                                                                                                                      |

## Data use disclosures

- Does the extension collect personally identifiable information? **No**
- Health information? **No**
- Financial information? **No**
- Authentication information? **No**
- Personal communications? **No**
- Location? **No**
- Web history? **No**
- User activity? **No**
- Website content? **No** — website content is processed in the browser and never
  transmitted or stored beyond the browsing session.

Certifications: does not sell data to third parties; does not use or transfer
data for purposes unrelated to the single purpose; does not use or transfer data
to determine creditworthiness or for lending.

## Reviewer instructions

The extension works on any ordinary webpage. A convenient test page is
`https://en.wikipedia.org/wiki/Portable_Document_Format`.

1. **Select Element** — click the ExactPDF toolbar icon, choose _Select Element_.
   The page dims and outlines whatever is under the pointer, labelled in plain
   language ("Image", "Table", "Section"). Press the up and down arrow keys to
   widen or narrow the selection. Click to capture. A preview tab opens; click
   _Save PDF_.
2. **Select Region** — choose _Select Region_, drag a rectangle, adjust it using
   the round handles, then press Enter.
3. **Full Page** — choose _Full Page_, then confirm at the long-page prompt. The
   page scrolls automatically, then returns to where it started.
4. **Clean Document** — choose _Clean Document_ on an article page. The resulting
   PDF has selectable text and working links.
5. **Unsupported page** — open `chrome://version` and click the toolbar icon. All
   four actions are disabled with an explanation.

To confirm nothing is transmitted: open DevTools on the preview tab, or the
service worker's inspector, and watch the Network panel during any capture. There
are no outbound requests. The extension declares no host permissions and contacts
no server.

## Assets checklist

- [x] Icon at 16, 32, 48 and 128 px (`public/icons/`, generated by `npm run icons`)
- [ ] Screenshot: the four capture actions in the popup (1280×800)
- [ ] Screenshot: element selection overlay on a real page
- [ ] Screenshot: the preview with the Exact/Document choice
- [ ] Screenshot: before and after, showing page chrome removed
- [ ] Small promotional tile (440×280)
- [ ] Demonstration video (30–60 seconds)
- [ ] Public privacy policy URL (publish `PRIVACY.md`)
- [ ] Support email and issue-report URL
- [ ] Two-step verification enabled on the publisher account

Screenshots and video need a real browser session and are the remaining manual
step before submission.
