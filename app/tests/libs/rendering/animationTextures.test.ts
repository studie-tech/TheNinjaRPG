import { afterEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Sprite, Texture } from "pixi.js";
import { assetAnimationClip } from "@/libs/rendering/animation";
import { clearUnusedAnimationTextures } from "@/libs/rendering/animationTextures";
import { createCharacterAnimation } from "@/libs/rendering/characterAnimation";
import { createSpriteClip } from "@/libs/rendering/primitives/animation";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { CharacterAnimation } from "@/libs/spriteAnimations";

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

describe("character animation sheets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps released sheets cached while another fighter is shown without animation", async () => {
    const load = vi.spyOn(Assets, "load").mockImplementation(
      async () =>
        new Texture({
          source: new BufferImageSource({
            resource: new Uint8Array(512 * 128 * 4),
            width: 512,
            height: 128,
          }),
        }),
    );
    const unload = vi.spyOn(Assets, "unload").mockImplementation(async () => {});
    const clip = (name: string): CharacterAnimation => ({
      id: name,
      name,
      smallUrl: null,
      url: `https://fallen-fighter.test/${name}.png`,
      columns: 4,
      rows: 1,
      frameCount: 4,
      fps: 8,
      facing: "left" as const,
    });
    const animations = { idle: clip("idle"), attack: clip("attack") };
    const fighter = () =>
      createCharacterAnimation(
        new Sprite(
          new Texture({
            source: new BufferImageSource({
              resource: new Uint8Array(16),
              width: 2,
              height: 2,
            }),
          }),
        ),
        50,
        animations,
      );
    const alive = fighter(),
      fallen = fighter();
    let now = 0;
    const frames = async (count: number, eventId: string) => {
      for (let i = 0; i < count; i++) {
        now += 16;
        const input = {
          now,
          moving: false,
          facing: "left",
          sourceFacing: "left",
          reducedMotion: false,
          cellSize: 128,
        } as const;
        alive.render({
          ...input,
          enabled: true,
          event: { id: eventId, actionKey: "attack" },
        });
        fallen.render({ ...input, enabled: false });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    // The attack plays out and the fighter returns to idle, releasing the attack sheet.
    await frames(70, "first");
    await frames(70, "second");
    expect(load).toHaveBeenCalledTimes(2);
    expect(unload).not.toHaveBeenCalled();
    alive.dispose();
    fallen.dispose();
    clearUnusedAnimationTextures();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unload).toHaveBeenCalledTimes(2);
  });
});
