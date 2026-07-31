# 2. Model expected failures as typed results

**Status:** accepted · **Date:** 23 July 2026

## Context

Captures fail routinely and for reasons that are not bugs: the page is a
`chrome://` URL, the capture exceeds the storage quota, no article structure was
found, lazy content never settled. Each needs a different explanation and a
different next step for the user.

Additionally, failures cross message boundaries. A thrown exception in a message
handler becomes an unhandled rejection on the sending side with no useful detail.

## Decision

Expected failures are values: `Result<T, ExactPdfError>`. Every `ExactPdfError`
carries a code, a plain-language message, and a `RecoveryAction` naming what the
user can do next. Exceptions are reserved for genuine defects, and are converted
at the boundary by `fromThrown`.

## Why

- The UI never has to invent copy for a failure it did not anticipate; the
  recovery action tells it which button to offer.
- Failures survive `chrome.runtime.sendMessage`, which serializes to JSON.
- The compiler forces every call site to consider the failure case.

## Consequences

- Call sites are more verbose: `if (!result.ok) { return result; }` recurs.
- Diagnostics must stay content-free. `scrubDetail` strips URLs, quoted strings
  and long tokens from any technical detail before it is retained, because a
  rejected Chrome API call can embed a URL in its message.
