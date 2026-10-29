import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { lpcCatalog, lpcFrame, spriteLayerSheets } from "@/libs/lpc/catalog";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

/** Layer atlases share scene leases; only lightweight frame views belong to this actor. */
export const createLpcCharacter = async (
  game: GameRenderer,
  appearance: SpriteAppearance,
  mode: "all" | "travel" = "all",
) => {
  const parts = appearance.layers.flatMap((layer) => {
    const sheets = spriteLayerSheets(appearance, layer, mode);
    // Oversized weapons split held and attack poses across separate sheets.
    const authored = new Set(
      sheets.flatMap((sheet) =>
        Object.keys(lpcCatalog.layouts[sheet.layout]?.clips ?? {}),
      ),
    );
    return sheets.map((sheet) => ({ layer, sheet, authored }));
  });
  const loaded = await Promise.all(
    parts.map(async (part) => ({
      ...part,
      texture: await game.assets.texture(part.sheet.image, 0, "nearest"),
    })),
  );
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Character cancelled", "AbortError");
  // A unit-square root preserves the existing actor/hit-testing contract.
  const sprite = new Container({ boundsArea: new Rectangle(-0.5, -0.5, 1, 1) });
  sprite.sortableChildren = true;
  const views = new Map<string, Texture>();
  const layers = loaded.map((part) => {
    const child = new Sprite(Texture.EMPTY);
    child.anchor.set(0.5);
    child.zIndex = part.sheet.z;
    sprite.addChild(child);
    return { ...part, child };
  });
  let state: LpcAnimation = "idle",
    direction: LpcDirection = 2,
    startedAt = 0,
    disposed = false;
  const render = (
    frame: GameFrame,
    nextState: LpcAnimation = "idle",
    nextDirection: LpcDirection = direction,
    restart = false,
  ) => {
    if (disposed) return;
    if (state !== nextState || restart) {
      state = nextState;
      startedAt = frame.now;
    }
    direction = nextDirection;
    for (const entry of layers) {
      if (
        entry.authored.has(state) &&
        !lpcCatalog.layouts[entry.sheet.layout]?.clips[state]
      ) {
        entry.child.visible = false;
        continue;
      }
      const sample = lpcFrame(
        entry.sheet,
        state,
        entry.layer.mirror && (direction === 1 || direction === 3)
          ? direction === 1
            ? 3
            : 1
          : direction,
        frame.now - startedAt,
        frame.reducedMotion,
      );
      entry.child.visible = !!sample;
      if (!sample) continue;
      const key = `${entry.sheet.image}:${sample.x}:${sample.y}`;
      let texture = views.get(key);
      if (!texture) {
        texture = new Texture({
          source: entry.texture.source,
          frame: new Rectangle(sample.x, sample.y, sample.size, sample.size),
        });
        views.set(key, texture);
      }
      if (entry.child.texture !== texture) entry.child.texture = texture;
      entry.child.width = sample.size / 64;
      entry.child.height = sample.size / 64;
      entry.child.scale.x =
        Math.abs(entry.child.scale.x) * (entry.layer.mirror ? -1 : 1);
    }
  };
  render({ now: 0, delta: 0, reducedMotion: true });
  game.own(() => {
    disposed = true;
    if (!sprite.destroyed)
      sprite.destroy({ children: true, texture: false, textureSource: false });
    for (const texture of views.values()) texture.destroy(false);
    views.clear();
  });
  return { sprite, render };
};

export type LpcCharacter = Awaited<ReturnType<typeof createLpcCharacter>>;
