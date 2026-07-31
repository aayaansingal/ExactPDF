# Privacy policy

**Last updated: 23 July 2026 · Applies to ExactPDF version 1.0.0**

## The short version

ExactPDF does not collect, transmit or store your data anywhere outside your own
browser. There is no server, no account and no analytics.

## What ExactPDF never sends anywhere

- Page content, in any form
- Screenshots and captured images
- Extracted text
- URLs, page titles and filenames
- The PDFs it produces
- Any identifier for you, your device or your browsing

There is no network destination for this information because the extension has
no backend and makes no outbound requests of its own.

## What is stored, and where

| What                                                                                                                       | Where                                   | How long                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Export preferences (page size, margins, quality, filename and metadata options, onboarding state, settings schema version) | `chrome.storage.local` on your device   | Until you change them, reset them, or uninstall                                                                   |
| The capture you are currently previewing                                                                                   | `chrome.storage.session` on your device | Deleted when the PDF is saved, the preview is closed, the capture expires after 15 minutes, or the browser closes |

No history of past exports is kept. No URL, page title or filename is written to
persistent storage.

## Permissions

| Permission     | What it enables                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`    | Temporary access to the tab you are looking at, granted only after you click the toolbar button, use a keyboard shortcut, or choose a context-menu item. It expires on navigation. This is what lets ExactPDF read your selection and take the screenshot. |
| `scripting`    | Injects the selection overlay or the extraction code for the capture mode you chose. Every injected file ships inside the extension package.                                                                                                               |
| `storage`      | Saves your export preferences and hands the in-progress capture to the preview tab.                                                                                                                                                                        |
| `contextMenus` | Adds the right-click "Save selected element as PDF" and "Save image as PDF" actions.                                                                                                                                                                       |

ExactPDF does **not** request `<all_urls>`, `debugger`, `webRequest`, `tabs`,
`downloads`, browsing history or cookie access, and declares no host permissions.

## Remote code

None. All executable code is bundled in the extension package. The content
security policy is `script-src 'self'; object-src 'self'; worker-src 'self'`,
nothing is loaded from a network location, and page-provided strings are never
evaluated as code.

## Authenticated pages

Capturing a page you are signed in to works because the extension reads what is
already rendered in your browser. That content is processed locally and is
subject to exactly the same guarantees as any other capture: it is never
transmitted, and it is deleted from session storage once you are done.

## Children

ExactPDF is a general-purpose utility. It collects no data from anyone, of any
age.

## Changes

Any change to this policy will accompany a version release and be recorded in
[CHANGELOG.md](CHANGELOG.md). If ExactPDF ever gains a feature that transmits
data, that feature will be opt-in, disclosed here and in the Chrome Web Store
listing before release, and will never include captured content or full URLs.

## Contact

Questions or concerns: open an issue on the project's GitHub repository.
