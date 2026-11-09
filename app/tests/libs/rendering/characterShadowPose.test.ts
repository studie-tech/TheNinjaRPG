import { expect, it, vi } from "bun:test";
import { BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import { createCharacterShadowPoses } from "@/libs/rendering/characterShadowPose";

const makeTexture = () =>
  new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(64 * 64 * 4),
      width: 64,
      height: 64,
    }),
  });

it("composites actual outfit layers, shares repeated poses and invalidates a changed frame", () => {
  const context = {
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as never);
  const body = makeTexture(),
    gear = makeTexture(),
    frame = makeTexture(),
    root = new Container();
  const parts = [body, gear].map((texture) => {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / 64);
    root.addChild(sprite);
    return sprite;
  });
  const poses = createCharacterShadowPoses();
  try {
    const first = poses.capture(root, parts)!;
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.drawImage.mock.calls.map((call) => call[0])).toEqual([
      body.source.resource,
      gear.source.resource,
    ]);
    expect(first.texture).not.toBe(body);
    expect(first.owned).toBe(true);
    expect(Math.max(first.texture.width, first.texture.height)).toBeLessThanOrEqual(
      128,
    );
    expect(first.minY).toBe(-0.5);
    expect(first.height).toBe(1);
    expect(poses.capture(root, parts)).toBe(first);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    parts[1]!.texture = frame;
    expect(poses.capture(root, parts)).not.toBe(first);
    expect(context.drawImage).toHaveBeenCalledTimes(4);
    poses.destroy();
    expect(first.texture.destroyed).toBe(true);
    expect(body.destroyed).toBe(false);
  } finally {
    poses.destroy();
    root.destroy({ children: true });
    for (const texture of [body, gear, frame]) texture.destroy(true);
    canvas.mockRestore();
  }
});

it("retains shared artwork when canvas composition is unavailable and never evicts active poses", () => {
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const root = new Container(),
    original = makeTexture(),
    part = new Sprite(original);
  root.addChild(part);
  const poses = createCharacterShadowPoses(),
    sources: Texture[] = [original];
  try {
    const active = poses.capture(root, [part])!;
    active.users++;
    for (let i = 0; i < 100; i++) {
      const texture = makeTexture();
      sources.push(texture);
      part.texture = texture;
      poses.capture(root, [part]);
    }
    part.texture = original;
    expect(poses.capture(root, [part])).toBe(active);
    poses.destroy();
    expect(sources.every((texture) => !texture.destroyed)).toBe(true);
  } finally {
    poses.destroy();
    root.destroy({ children: true });
    for (const texture of sources) texture.destroy(true);
    canvas.mockRestore();
  }
});
