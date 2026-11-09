import { describe, expect, it } from "bun:test";
import { BufferImageSource, Texture } from "pixi.js";
import { assetAnimationClip } from "@/libs/rendering/animation";
import { createSpriteClip } from "@/libs/rendering/primitives/animation";
import type { GameRenderer } from "@/libs/rendering/runtime";

describe("animation texture ownership", () => {
  it("keeps atlas sources immutable while independently sampling two actors", async () => {
    const source = new BufferImageSource({
      resource: new Uint8Array(4 * 4 * 4),
      width: 4,
      height: 4,
    });
    const texture = new Texture({ source });
    const cleanups: (() => void)[] = [];
    const game = {
      assets: { texture: async () => texture },
      own: (cleanup: () => void) => cleanups.push(cleanup),
      isDisposed: () => false,
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const descriptor = assetAnimationClip(
      { image: "atlas", frames: 4, speed: 100 },
      true,
    );
    const [first, second] = await Promise.all([
      createSpriteClip(game, descriptor, { size: 50 }),
      createSpriteClip(game, descriptor, { size: 50 }),
    ]);
    first.renderAt(200);
    second.renderAt(300);
    expect(first.sprite.texture.frame.y).toBe(2);
    expect(second.sprite.texture.frame.y).toBe(3);
    expect(texture.frame).toMatchObject({ x: 0, y: 0, width: 4, height: 4 });
    first.dispose();
    second.renderAt(100);
    expect(second.sprite.texture.frame.y).toBe(1);
    expect(source.destroyed).toBe(false);
    for (const cleanup of cleanups) cleanup();
    expect(source.destroyed).toBe(false);
    texture.destroy(true);
  });
  it("cancels a late image load before creating animation objects", async () => {
    let complete = (_texture: Texture) => {};
    const controller = new AbortController();
    const game = {
      assets: {
        texture: () =>
          new Promise<Texture>((resolve) => {
            complete = resolve;
          }),
      },
      signal: controller.signal,
      isDisposed: () => controller.signal.aborted,
    } as unknown as GameRenderer;
    const animation = createSpriteClip(
      game,
      assetAnimationClip({ image: "atlas", frames: 1, speed: 100 }),
      { size: 50 },
    );
    controller.abort();
    complete(Texture.WHITE);
    await expect(animation).rejects.toMatchObject({ name: "AbortError" });
  });
});
