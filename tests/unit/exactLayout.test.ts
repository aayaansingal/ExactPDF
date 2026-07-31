import { describe, expect, it } from 'vitest';
import { planExactLayout, type ExactLayoutInput } from '../../src/pdf/exactLayout.js';
import { MAX_PDF_DIMENSION_PT } from '../../src/shared/constants.js';
import { cssPixelsToPoints, PAPER_SIZES } from '../../src/pdf/units.js';

const ZERO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 };

function input(overrides: Partial<ExactLayoutInput> = {}): ExactLayoutInput {
  return {
    imageWidth: 1600,
    imageHeight: 1200,
    scale: 2,
    pageSize: 'original',
    orientation: 'auto',
    margins: ZERO_MARGINS,
    ...overrides,
  };
}

describe('planExactLayout: original size', () => {
  it('makes one page matching the capture at 96 DPI', () => {
    const layout = planExactLayout(input());
    expect(layout.slices).toHaveLength(1);

    const slice = layout.slices[0]!;
    // 1600 device px at scale 2 is 800 CSS px, which is 600 pt.
    expect(slice.pageWidth).toBeCloseTo(cssPixelsToPoints(800), 4);
    expect(slice.pageHeight).toBeCloseTo(cssPixelsToPoints(600), 4);
    expect(layout.scaledDown).toBe(false);
  });

  it('grows the page to hold the margins', () => {
    const layout = planExactLayout(input({ margins: { top: 10, right: 10, bottom: 10, left: 10 } }));
    const slice = layout.slices[0]!;
    expect(slice.pageWidth).toBeGreaterThan(cssPixelsToPoints(800));
    expect(slice.drawX).toBeGreaterThan(0);
    expect(slice.drawY).toBeGreaterThan(0);
  });

  it('paginates only once the format limit is exceeded', () => {
    const layout = planExactLayout(input({ imageWidth: 1000, imageHeight: 200_000, scale: 1 }));
    expect(layout.slices.length).toBeGreaterThan(1);
    for (const slice of layout.slices) {
      expect(slice.pageHeight).toBeLessThanOrEqual(MAX_PDF_DIMENSION_PT);
    }
  });

  it('covers the whole capture across its slices', () => {
    const layout = planExactLayout(input({ imageWidth: 1000, imageHeight: 200_000, scale: 1 }));
    const covered = layout.slices.reduce((total, slice) => total + slice.sourceHeight, 0);
    expect(covered).toBeCloseTo(200_000, 0);
  });
});

describe('planExactLayout: continuous', () => {
  it('always produces exactly one page', () => {
    const layout = planExactLayout(input({ pageSize: 'continuous' }));
    expect(layout.slices).toHaveLength(1);
  });

  it('scales an oversized capture down instead of splitting it', () => {
    const layout = planExactLayout(
      input({ pageSize: 'continuous', imageWidth: 1000, imageHeight: 200_000, scale: 1 }),
    );
    expect(layout.slices).toHaveLength(1);
    expect(layout.scaledDown).toBe(true);
    expect(layout.slices[0]!.pageHeight).toBeLessThanOrEqual(MAX_PDF_DIMENSION_PT);
  });
});

describe('planExactLayout: paper sizes', () => {
  it('uses A4 dimensions in portrait for tall content', () => {
    const layout = planExactLayout(input({ pageSize: 'a4', imageWidth: 800, imageHeight: 2000, scale: 1 }));
    expect(layout.slices[0]!.pageWidth).toBeCloseTo(PAPER_SIZES.a4.width, 2);
    expect(layout.slices[0]!.pageHeight).toBeCloseTo(PAPER_SIZES.a4.height, 2);
  });

  it('turns the page landscape automatically for wide content', () => {
    const layout = planExactLayout(input({ pageSize: 'a4', imageWidth: 3000, imageHeight: 800, scale: 1 }));
    expect(layout.slices[0]!.pageWidth).toBeGreaterThan(layout.slices[0]!.pageHeight);
  });

  it('respects an explicit portrait choice for wide content', () => {
    const layout = planExactLayout(
      input({ pageSize: 'a4', orientation: 'portrait', imageWidth: 3000, imageHeight: 800, scale: 1 }),
    );
    expect(layout.slices[0]!.pageWidth).toBeLessThan(layout.slices[0]!.pageHeight);
  });

  it('never enlarges content smaller than the page', () => {
    const layout = planExactLayout(
      input({ pageSize: 'letter', imageWidth: 200, imageHeight: 100, scale: 1 }),
    );
    const slice = layout.slices[0]!;
    expect(slice.drawWidth).toBeCloseTo(cssPixelsToPoints(200), 4);
    expect(layout.scaledDown).toBe(false);
  });

  it('centres narrow content horizontally', () => {
    const layout = planExactLayout(
      input({ pageSize: 'letter', orientation: 'portrait', imageWidth: 200, imageHeight: 100, scale: 1 }),
    );
    const slice = layout.slices[0]!;
    const rightGap = slice.pageWidth - (slice.drawX + slice.drawWidth);
    expect(slice.drawX).toBeCloseTo(rightGap, 4);
  });

  it('slices long content across whole sheets and top-aligns each', () => {
    const layout = planExactLayout(
      input({
        pageSize: 'a4',
        imageWidth: 800,
        imageHeight: 6000,
        scale: 1,
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      }),
    );
    expect(layout.slices.length).toBeGreaterThan(1);

    for (const slice of layout.slices) {
      const topEdge = slice.drawY + slice.drawHeight;
      expect(topEdge).toBeLessThanOrEqual(slice.pageHeight);
      expect(slice.drawY).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads consecutive source bands with no overlap or gap', () => {
    const layout = planExactLayout(input({ pageSize: 'a4', imageWidth: 800, imageHeight: 6000, scale: 1 }));
    let expectedY = 0;
    for (const slice of layout.slices) {
      expect(slice.sourceY).toBeCloseTo(expectedY, 3);
      expectedY += slice.sourceHeight;
    }
    expect(expectedY).toBeCloseTo(6000, 0);
  });
});
