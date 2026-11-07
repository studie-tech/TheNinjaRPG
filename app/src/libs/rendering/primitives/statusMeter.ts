import { Container, Sprite, Texture } from "pixi.js";

const TRAIL_HOLD_MS = 380;
const TRAIL_DRAIN_MS = 420;

/** Flat color sprites keep status updates inside the normal sprite batch. */
export const createStatusMeter = (options: {
  width: number;
  height: number;
  color: number;
  backgroundColor?: number;
  trackColor?: number;
  y: number;
  x?: number;
  /** Lost value lingers in this color, then drains into the new value. */
  trailColor?: number;
}) => {
  const container = new Container();
  const rect = (color: number, x: number, y: number, width: number, height: number) => {
    const sprite = new Sprite(Texture.WHITE);
    sprite.tint = color;
    sprite.position.set(x, y);
    sprite.width = width;
    sprite.height = height;
    return sprite;
  };
  const { width, height } = options;
  const border = Math.min(height / 2, Math.max(1 / 3, Math.min(4 / 3, height / 6)));
  const background = rect(
    options.backgroundColor ?? 0x000000,
    0,
    -height / 2,
    width,
    height,
  );
  const track = rect(
    options.trackColor ?? 0x808080,
    border / 2,
    -height / 2 + border / 2,
    width - border,
    height - border,
  );
  const fill = rect(options.color, 0, 0, 1, height - border);
  fill.position.set(border / 2, -height / 2 + border / 2);
  const trail =
    options.trailColor === undefined
      ? null
      : rect(
          options.trailColor,
          border / 2,
          -height / 2 + border / 2,
          1,
          height - border,
        );
  container.position.set(options.x ?? width / 2, options.y);
  container.addChild(background, track, fill, ...(trail ? [trail] : []));
  let previous = Number.NaN;
  let trailValue = 0;
  let trailHold = 0;
  const showTrail = () => {
    if (!trail) return;
    // Only the lost section shows, directly after what remains.
    trail.visible = trailValue > previous;
    trail.x = border / 2 + (width - border) * previous;
    trail.width = Math.max(0, (width - border) * (trailValue - previous));
  };
  return {
    container,
    set: (fraction: number, color = options.color) => {
      fill.tint = color;
      const value = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
      if (value === previous) return;
      if (value < previous) {
        trailValue = Math.max(trailValue, previous);
        trailHold = TRAIL_HOLD_MS;
      } else trailValue = 0;
      previous = value;
      fill.width = Math.max(0, (width - border) * value);
      fill.visible = value > 0;
      showTrail();
    },
    /** Drain lost value after a beat; true while it is still on show. */
    drain: (deltaMs: number, reducedMotion = false) => {
      if (!trail || trailValue <= previous) return false;
      if (reducedMotion) trailValue = 0;
      else if (trailHold > 0) trailHold -= deltaMs;
      else
        trailValue -= (deltaMs / TRAIL_DRAIN_MS) * Math.max(0.2, trailValue - previous);
      showTrail();
      return trailValue > previous;
    },
  };
};
