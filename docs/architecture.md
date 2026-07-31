# Architecture

## The shape of a capture

```
 user gesture            service worker                  page                 preview tab
     │                        │                           │                        │
     ├─ popup / menu / key ──►│                           │                        │
     │                        ├─ create session           │                        │
     │                        ├─ inject mode's script ───►│                        │
     │                        │                           ├─ overlay / measure     │
     │                        │◄── bounds or document ────┤                        │
     │                        ├─ scroll + screenshot ────►│                        │
     │                        │◄── tiles ─────────────────┤                        │
     │                        ├─ stitch, crop, encode     │                        │
     │                        ├─ restore page ───────────►│                        │
     │                        ├─ store payload            │                        │
     │                        ├─ open preview ───────────────────────────────────►│
     │                        │                           │        render worker ──┤
     │                        │◄── release session ────────────────────────────────┤
```

## Components

| Component            | Location                                          | Responsibility                                                                                                                     |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Popup                | `src/popup/`                                      | Offers the four modes, reports whether the tab can be captured, opens settings and help.                                           |
| Service worker       | `src/background/serviceWorker.ts`                 | Registers every event listener at the top level and routes messages.                                                               |
| Orchestrator         | `src/background/captureOrchestrator.ts`           | Sequences a capture end to end. All Chrome access is through injected adapters, so the whole flow is testable with a fake browser. |
| Session store        | `src/background/sessionStore.ts`                  | Holds in-flight captures in `chrome.storage.session` with a TTL.                                                                   |
| Selection scripts    | `src/content/elementPicker.ts`, `regionPicker.ts` | Overlays in a closed shadow root; report capture geometry.                                                                         |
| Page controller      | `src/content/pageController.ts`                   | Measures, scrolls, primes lazy content, hides sticky elements, and restores everything.                                            |
| Document extractor   | `src/content/documentExtractor.ts`                | Clones the page, runs Readability, sanitizes, builds blocks.                                                                       |
| Exact capture engine | `src/capture/exact/`                              | Tile planning, stitching on `OffscreenCanvas`, blank-space cropping.                                                               |
| Document capture     | `src/capture/document/`                           | Sanitization, block building, extraction confidence.                                                                               |
| PDF renderers        | `src/pdf/`                                        | Page layout and byte generation for both modes.                                                                                    |
| Render worker        | `src/pdf/renderWorker.ts`                         | Runs PDF generation off the preview's UI thread.                                                                                   |
| Preview              | `src/preview/`                                    | Displays the generated PDF and collects export settings.                                                                           |

## Why the work is split this way

**The service worker owns screenshots.** `chrome.tabs.captureVisibleTab` is only
callable there. Compositing also happens there, on an `OffscreenCanvas`, so a
large capture does not freeze the tab being captured.

**The page owns anything requiring the DOM.** Measurement, scrolling, lazy-load
priming and sticky-element handling all need to be inside the page. Everything
the page changes is recorded in `PageState` and reversed in a `finally` path, on
success and failure alike.

**The preview owns rendering.** The preview shows the real generated PDF in
Chrome's viewer rather than an HTML approximation. That is the only way to
guarantee the exported file matches what the user approved, because they are the
same bytes. Rendering runs in a worker to keep the controls responsive.

## Data flow and lifetime

1. A user gesture grants `activeTab`.
2. The orchestrator creates a session and injects only the script the chosen mode
   needs.
3. The content script returns geometry or a sanitized document representation.
4. The payload is written to `chrome.storage.session`, which never touches disk
   and is cleared when the browser closes.
5. The preview reads it, renders locally, and downloads via a blob URL.
6. The session is deleted on save, on preview close, on expiry, and on
   service-worker startup.

A quota rejection when writing the payload is the documented "capture too large"
path: the session is discarded and the user is offered a lower-quality retry.

## Surviving service-worker suspension

Manifest V3 suspends the worker freely. Two consequences shape the design:

- Every listener is registered synchronously at the top level of
  `serviceWorker.ts`. A listener added inside a promise callback would be missing
  after the restart that the event itself triggered.
- Capture state lives in storage rather than in worker memory, so a suspension
  mid-capture does not orphan it. Selections in progress are the exception: they
  are held in memory, and an overlay that replies after a restart is treated as
  an expired session rather than a crash.

## Message contracts

All messages are defined in `src/shared/messages.ts`, with each request type
mapped to exactly one response type, so senders and receivers cannot drift apart
without a type error. Every handler replies with a `Result`, so expected failures
survive the message boundary instead of becoming unhandled rejections.

Content scripts share a frame, and every `onMessage` listener sees every message.
A listener must therefore decline commands it does not own — answering one wins
the race against the script that should have handled it.

## Testing strategy

| Layer       | What it proves                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | Layout, tiling, cropping, filenames, encoding, sanitization and settings migration are correct in isolation.                                                 |
| Integration | The orchestrator, session store and renderers behave correctly against a fake Chrome API, including quota rejection, injection refusal and expired sessions. |
| End-to-end  | The real extension, in a real browser, captures a real page and produces a real PDF, leaves no trace on the page, and sends nothing over the network.        |
