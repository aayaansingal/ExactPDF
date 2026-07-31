# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's **Report a
vulnerability** flow on the repository's Security tab, rather than in a public
issue. Include the steps to reproduce, the affected version, and the browser and
operating system.

You can expect an acknowledgement within a week and an assessment within two.
Fixes for confirmed issues are released as promptly as the severity warrants,
and the changelog records them.

## Scope

In scope:

- Escaping the extension's sanitization to execute code in an extension page
- Reading or exfiltrating page content the user did not choose to capture
- Any outbound network request made by the extension
- Privilege escalation beyond the four declared permissions
- Persisting captured content beyond its documented lifetime

Out of scope:

- Findings that require a compromised browser profile or a malicious extension
  already installed
- The fact that captures of an authenticated page contain that page's content,
  which is the product's purpose
- Denial of service through deliberately enormous pages; capture limits are
  documented in [docs/compatibility.md](docs/compatibility.md)

## Design measures

- **No remote code.** Everything executable ships in the package. The extension
  page CSP is `script-src 'self'; object-src 'self'; worker-src 'self'`.
- **No `eval`.** Page-provided strings are never evaluated. A lint rule enforces
  this.
- **Allowlist sanitization.** Extracted content passes through
  `src/capture/document/sanitize.ts`, which removes scripts, event handlers,
  embedded and interactive content, and rejects any URL scheme outside
  `http`, `https`, `mailto` and image-only `data:` URLs. Unknown elements are
  unwrapped to their text rather than passed through.
- **Never mutating the live page during extraction.** Readability rewrites the
  document it is handed, so it only ever sees a clone.
- **Minimum permissions.** No `<all_urls>`, no `debugger`, no host permissions.
  Downloads use a blob URL on an extension page rather than the `downloads`
  permission.
- **Short-lived capture data.** Captures live in `chrome.storage.session`, which
  never touches disk and is cleared when the browser closes; they are also
  deleted on save, cancellation, expiry and service-worker startup.
- **Pinned dependencies.** Exact versions in `package.json` with a lockfile.

## Verification

`npm run verify` runs formatting, linting, type checking and the unit and
integration suites. `npm run test:e2e` additionally asserts, in a real browser,
that no request leaves the machine during a capture and that captured content is
removed from storage afterwards.
