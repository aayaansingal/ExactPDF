# 3. Ship no font files; transliterate instead

**Status:** accepted · **Date:** 23 July 2026

## Context

Document mode draws real text. pdf-lib offers the 14 standard PDF fonts, which
every reader has and which cost nothing to embed, or arbitrary TrueType fonts via
fontkit, which cover any script but add both a dependency and hundreds of
kilobytes of glyphs per face.

The standard fonts use WinAnsi encoding: Latin scripts only. Asking pdf-lib to
draw a character it cannot encode throws.

## Decision

Use the standard fonts. Before layout, run all text through
`encodeBlocksForStandardFont`, which transliterates characters that have an
honest ASCII equivalent and replaces the rest with `?` while counting them. The
preview tells the user how many characters were lost and points them at Exact
mode, which preserves the page's own rendering.

## Why

- The plan asks for a reviewable bundle free of unused heavyweight dependencies.
  Most captures are Latin text; embedding a universal font would make every user
  pay for a minority case.
- Exact mode already handles any script perfectly, because it is a photograph. A
  clearly-signposted fallback is better than a large dependency.
- Silently dropping characters would violate the plan's "honest output modes"
  principle. Counting and surfacing them satisfies it.

## Consequences

- Document mode is not suitable for CJK, Arabic, Hebrew, Cyrillic or Indic
  content. This is stated in the README, the in-app help and the compatibility
  matrix.
- Encoding must happen **before** layout, not at draw time: line breaking
  measures text with the same font that draws it, so measuring an unencodable
  character throws. This also guarantees measured and drawn text are identical.
- If demand justifies it, a future version can embed a subset font behind the
  same interface without changing the layout engine.
