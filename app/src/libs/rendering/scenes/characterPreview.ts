import type { LpcCatalog } from "@/libs/lpc/catalog";
import {
  createLpcCharacter,
  type LpcCharacter,
} from "@/libs/rendering/primitives/character";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

/**
 * One renderer previews every appearance shown during its lifetime. Each appearance loads
 * in its own scope while the previous figure stays on screen; only the latest request
 * replaces it. Frames present only when the figure's pose changes.
 */
export const createCharacterPreviewScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
}) => {
  const game = await createGameRenderer({
    ...options,
    surface: "character-preview",
    width: 256,
    height: () => 256,
  });
  // Preserve the square aspect when the rem-sized mount follows the player's font scale.
  game.canvas.style.height = "auto";
  let shown: {
    scope: ReturnType<typeof createRenderScope>;
    actor: LpcCharacter;
    animation: LpcAnimation;
  } | null = null;
  let direction: LpcDirection = 2;
  let request = 0;
  game.setUpdate((frame) => {
    if (!shown) return false;
    const still = frame.reducedMotion || !game.visualEffects.spriteAnimations;
    // A frozen figure changes only on invalidation: a turn, a new appearance or a setting.
    game.setAnimating(!still);
    return shown.actor.render(
      game.visualEffects.spriteAnimations ? frame : { ...frame, reducedMotion: true },
      shown.animation,
      direction,
    );
  });
  return {
    dispose: game.dispose,
    /**
     * Shows an appearance facing front. Resolves once it is on screen, or when a later
     * request supersedes it; rejects when its artwork cannot load.
     */
    show: async (
      appearance: SpriteAppearance,
      animation: LpcAnimation,
      catalog: LpcCatalog | Promise<LpcCatalog>,
    ) => {
      const id = ++request;
      const scope = createRenderScope(game);
      try {
        // The appearance owns its catalog load and failure, independently of renderer readiness.
        scope.lpcCatalog = await catalog;
        if (id !== request || scope.isDisposed()) {
          scope.dispose();
          return;
        }
        const actor = await createLpcCharacter(
          scope,
          appearance,
          animation === "stand" || animation === "idle" || animation === "walk"
            ? "travel"
            : "all",
        );
        if (id !== request || scope.isDisposed()) {
          scope.dispose();
          return;
        }
        actor.sprite.position.set(128, 125);
        // Enlarge facial details within the compact preview without expanding the form.
        actor.sprite.scale.set(160);
        game.stage.addChild(actor.sprite);
        shown?.scope.dispose();
        shown = { scope, actor, animation };
        direction = 2;
        game.invalidate();
      } catch (error) {
        scope.dispose();
        if (id !== request || game.isDisposed()) return;
        // A failed appearance leaves no stale figure behind its error message.
        shown?.scope.dispose();
        shown = null;
        game.invalidate();
        throw error;
      }
    },
    /** Turns the figure a quarter to the right without reloading it. */
    rotate: () => {
      direction = ((direction + 1) % 4) as LpcDirection;
      game.invalidate();
    },
  };
};

export type CharacterPreviewScene = Awaited<
  ReturnType<typeof createCharacterPreviewScene>
>;
