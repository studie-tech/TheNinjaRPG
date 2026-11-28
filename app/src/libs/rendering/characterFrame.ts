/** Unit-square actors expose this stable foot contact to scenery, shadows and minigames. */
export const CHARACTER_FOOT_Y = 28 / 64;

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
