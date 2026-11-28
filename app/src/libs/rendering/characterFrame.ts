/** Unit-square actors expose this stable foot contact to scenery, shadows and minigames. */
export const CHARACTER_FOOT_Y = 28 / 64;

/** Native character density retains roughly 128 painted pixels of height at the same world scale. */
export const CHARACTER_PIXELS_PER_UNIT = 500 / 3;
export const CHARACTER_COMPOSITE_CELL = 320;
/** Four cells per row keep a 100-player crowd within the existing eight-page limit. */
export const CHARACTER_COMPOSITE_PAGE_SIZE = 1280;

/** Detailed portraits retain roughly 256 painted pixels; two pages cache an eight-frame pose cycle. */
export const CHARACTER_PREVIEW_PIXELS_PER_UNIT = 128000 / 381;
export const CHARACTER_PREVIEW_COMPOSITE_CELL = 640;
export const CHARACTER_PREVIEW_COMPOSITE_MAX_PAGES = 2;

/** Align an authored ground point without changing the actor's unit-space placement contract. */
export const characterFrameOffset = (
  frame: { size: number; ground?: { x: number; y: number } },
  pixelsPerUnit: number,
  mirror = false,
) =>
  frame.ground
    ? {
        x: ((frame.size / 2 - frame.ground.x) / pixelsPerUnit) * (mirror ? -1 : 1),
        y: CHARACTER_FOOT_Y - (frame.ground.y - frame.size / 2) / pixelsPerUnit,
      }
    : { x: 0, y: 0 };
