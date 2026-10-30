import { Container, Sprite, Texture } from "pixi.js";

/** Flat color sprites keep status updates inside the normal sprite batch. */
export const createStatusMeter = (options: {
  width: number;
  height: number;
  color: number;
  backgroundColor?: number;
  trackColor?: number;
  y: number;
  x?: number;
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
  container.position.set(options.x ?? width / 2, options.y);
  container.addChild(background, track, fill);
  let previous = Number.NaN;
  return {
    container,
    set: (fraction: number, color = options.color) => {
      fill.tint = color;
      const value = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
      if (value === previous) return;
      previous = value;
      fill.width = Math.max(0, (width - border) * value);
      fill.visible = value > 0;
    },
  };
};
