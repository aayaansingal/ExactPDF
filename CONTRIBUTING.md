# Contributing

Thank you for considering a contribution. ExactPDF is deliberately narrow in
scope, so the most useful contributions are usually compatibility fixes backed by
a fixture page.

## Getting set up

```bash
npm ci
npm run build
npm run verify
```

Load `dist/` through **Load unpacked** in Chrome's extension manager.

## Before you open a pull request

```bash
npm run verify        # format, lint, typecheck, unit and integration tests
npm run test:e2e      # real-browser workflows (needs a Chromium browser)
```

All four must pass. Add tests with your change:

- **Pure logic** (layout, cropping, filenames, sanitization) → `tests/unit/`
- **Messaging, storage, renderers** → `tests/integration/`
- **A user-visible workflow** → `tests/e2e/`

## Reporting a compatibility problem

The most valuable bug report includes a page category and what went wrong. If
you can, reduce the failure to a self-contained fixture in
`tests/fixtures/sites/build-fixtures.mjs` — fixtures are generated, deterministic
and offline, so a regression test built on one stays meaningful. Compatibility
fixes should land with a regression test, per the feedback loop in the product
plan.

## What belongs in ExactPDF

A feature is in scope if it directly improves **selecting, preserving, organising
or exporting web content**. If it primarily edits an existing PDF, downloads
protected media, or converts unrelated file types, it belongs in a different
product.

Explicitly out of scope for version 1: video or audio downloading; DRM, paywall
or login circumvention; PDF editing, signing, merging or splitting; OCR; cloud
sync; user accounts; AI summarisation; and any remote processing of page content.

## Code conventions

- Strict TypeScript. No implicit `any`, no non-null assertions.
- `PascalCase` for types and components, `camelCase` for functions and variables,
  `SCREAMING_SNAKE_CASE` only for true constants.
- Asynchronous commands are named with action verbs: `captureFullPage`,
  `buildDocumentPdf`, `restorePageState`.
- Discriminated unions for capture modes and result states.
- Expected failures are typed `Result` values, not thrown exceptions.
- Chrome API calls go through the adapters in `src/shared/chrome/` so they can be
  faked in tests.
- Comment non-obvious browser constraints. Do not comment what the code says.

## Commits and reviews

Use focused commits with imperative subjects. Record consequential architectural
choices as a short decision record in `docs/decisions/`. Automated tooling must
not push commits without human review.
