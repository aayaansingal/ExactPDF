import { describe, expect, it } from 'vitest';
import {
  countUnsupportedGlyphs,
  encodeForStandardFont,
  toStandardFontText,
} from '../../src/pdf/textEncoding.js';

describe('encodeForStandardFont', () => {
  it('passes ASCII through unchanged', () => {
    const result = encodeForStandardFont('Hello, world! 123');
    expect(result.text).toBe('Hello, world! 123');
    expect(result.unsupportedCount).toBe(0);
  });

  it('keeps accented Latin characters, which WinAnsi covers', () => {
    const result = encodeForStandardFont('café naïve Ünger');
    expect(result.text).toBe('café naïve Ünger');
    expect(result.unsupportedCount).toBe(0);
  });

  it('transliterates smart quotes without counting them as lost', () => {
    const result = encodeForStandardFont('“quoted” and ‘single’');
    expect(result.text).toBe('"quoted" and \'single\'');
    expect(result.unsupportedCount).toBe(0);
  });

  it('expands dashes and ellipses to their ASCII equivalents', () => {
    expect(toStandardFontText('a—b')).toBe('a--b');
    expect(toStandardFontText('a–b')).toBe('a-b');
    expect(toStandardFontText('wait…')).toBe('wait...');
  });

  it('normalizes exotic whitespace to a plain space', () => {
    expect(toStandardFontText('a b c　d')).toBe('a b c d');
  });

  it('drops zero-width characters entirely', () => {
    expect(toStandardFontText('a​b‍c﻿d')).toBe('abcd');
  });

  it('converts a tab to spaces so code blocks keep their shape', () => {
    expect(toStandardFontText('if:\n\tpass')).toBe('if:\n    pass');
  });

  it('replaces characters with no Latin equivalent and counts them', () => {
    const result = encodeForStandardFont('hello 世界');
    expect(result.text).toBe('hello ??');
    expect(result.unsupportedCount).toBe(2);
  });

  it('counts astral-plane characters once each, not per code unit', () => {
    const result = encodeForStandardFont('ok 😀');
    expect(result.unsupportedCount).toBe(1);
    expect(result.text).toBe('ok ?');
  });

  it('preserves newlines, which the layout engine relies on', () => {
    expect(toStandardFontText('one\ntwo')).toBe('one\ntwo');
  });

  it('handles an empty string', () => {
    expect(encodeForStandardFont('')).toEqual({ text: '', unsupportedCount: 0 });
  });
});

describe('countUnsupportedGlyphs', () => {
  it('reports zero for fully supported text', () => {
    expect(countUnsupportedGlyphs('Plain ASCII and café')).toBe(0);
  });

  it('counts only the characters that cannot be represented', () => {
    expect(countUnsupportedGlyphs('a 世 b 界 c')).toBe(2);
  });
});
