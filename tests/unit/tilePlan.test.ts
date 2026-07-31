import { describe, expect, it } from 'vitest';
import { isTiled, planTiles, type TilePlanInput } from '../../src/capture/exact/tilePlan.js';
import { TILE_OVERLAP_CSS_PX } from '../../src/shared/constants.js';

function input(overrides: Partial<TilePlanInput> = {}): TilePlanInput {
  return {
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    viewportWidth: 1280,
    viewportHeight: 720,
    pageWidth: 1280,
    pageHeight: 720,
    devicePixelRatio: 2,
    maxScale: 2,
    ...overrides,
  };
}

describe('planTiles', () => {
  it('uses a single tile when the content fits the viewport', () => {
    const plan = planTiles(input());
    expect(plan.tiles).toHaveLength(1);
    expect(isTiled(plan)).toBe(false);
    expect(plan.tiles[0]).toMatchObject({ scrollX: 0, scrollY: 0, destX: 0, destY: 0 });
  });

  it('honours the device pixel ratio up to the quality ceiling', () => {
    expect(planTiles(input({ devicePixelRatio: 3, maxScale: 2 })).scale).toBe(2);
    expect(planTiles(input({ devicePixelRatio: 1, maxScale: 3 })).scale).toBe(1);
  });

  it('tiles a page taller than the viewport with overlap between steps', () => {
    const plan = planTiles(
      input({
        bounds: { x: 0, y: 0, width: 1280, height: 3000 },
        pageHeight: 3000,
      }),
    );

    expect(plan.tiles.length).toBeGreaterThan(1);
    const [first, second] = plan.tiles;
    expect(second!.scrollY - first!.scrollY).toBe(720 - TILE_OVERLAP_CSS_PX);
  });

  it('covers the full requested height without gaps', () => {
    const plan = planTiles(input({ bounds: { x: 0, y: 0, width: 1280, height: 3000 }, pageHeight: 3000 }));

    const covered = plan.tiles.map((tile) => ({
      from: tile.destY,
      to: tile.destY + tile.sourceHeight,
    }));
    covered.sort((a, b) => a.from - b.from);

    let reach = 0;
    for (const span of covered) {
      expect(span.from).toBeLessThanOrEqual(reach);
      reach = Math.max(reach, span.to);
    }
    expect(reach).toBeGreaterThanOrEqual(3000);
  });

  it('clamps scrolling at the bottom of the page and adjusts the source offset', () => {
    const plan = planTiles(input({ bounds: { x: 0, y: 0, width: 1280, height: 1000 }, pageHeight: 1000 }));
    const last = plan.tiles[plan.tiles.length - 1]!;

    // The page can only scroll to 1000 - 720 = 280.
    expect(last.scrollY).toBeLessThanOrEqual(280);
    // Which means the wanted band sits further down inside the viewport.
    expect(last.sourceY).toBeGreaterThan(0);
    expect(last.destY + last.sourceHeight).toBeCloseTo(1000, 5);
  });

  it('reduces the scale rather than exceeding the pixel budget', () => {
    const plan = planTiles(
      input({
        bounds: { x: 0, y: 0, width: 2000, height: 30000 },
        pageHeight: 30000,
        devicePixelRatio: 3,
        maxScale: 3,
        maxPixelArea: 60_000_000,
      }),
    );

    expect(plan.downscaled).toBe(true);
    expect(plan.width * plan.scale * plan.height * plan.scale).toBeLessThanOrEqual(60_000_000);
  });

  it('never drops below a legible half-scale', () => {
    const plan = planTiles(
      input({
        bounds: { x: 0, y: 0, width: 5000, height: 50000 },
        pageHeight: 50000,
        maxPixelArea: 1000,
      }),
    );
    expect(plan.scale).toBe(0.5);
  });

  it('offsets tiles by the capture origin for a region below the fold', () => {
    const plan = planTiles(
      input({
        bounds: { x: 100, y: 900, width: 400, height: 300 },
        pageHeight: 4000,
      }),
    );

    expect(plan.tiles).toHaveLength(1);
    expect(plan.tiles[0]!.scrollY).toBe(900);
    expect(plan.tiles[0]!.destX).toBe(0);
    expect(plan.tiles[0]!.destY).toBe(0);
    expect(plan.tiles[0]!.sourceX).toBe(100);
  });

  it('tiles horizontally for content wider than the viewport', () => {
    const plan = planTiles(
      input({
        bounds: { x: 0, y: 0, width: 3000, height: 500 },
        pageWidth: 3000,
      }),
    );
    expect(plan.tiles.filter((tile) => tile.destY === 0).length).toBeGreaterThan(1);
  });
});
