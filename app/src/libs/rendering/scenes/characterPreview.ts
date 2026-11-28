import type { LpcCatalog } from "@/libs/lpc/catalog";
import { loadLpcPreviewCatalog } from "@/libs/lpc/previewAssets";
import {
  CHARACTER_PREVIEW_HEIGHT,
  CHARACTER_PREVIEW_WIDTH,
  characterPreviewFraming,
} from "@/libs/lpc/previewFraming";
import {
  createLpcCharacter,
  type LpcCharacter,
} from "@/libs/rendering/primitives/character";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import { reportRendererFailure } from "@/libs/rendering/telemetry";
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
    characterResolution: "preview",
    width: CHARACTER_PREVIEW_WIDTH,
    height: () => CHARACTER_PREVIEW_HEIGHT,
  });
  // Preserve portrait proportions when the mount follows the player's font scale.
  game.canvas.style.height = "auto";
  let shown: {
    scope: ReturnType<typeof createRenderScope>;
    actor: LpcCharacter;
    animation: LpcAnimation;
  } | null = null;
  let direction: LpcDirection = 2;
  let loading: ReturnType<typeof createRenderScope> | null = null;
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
      loading?.dispose();
      let scope = createRenderScope(game);
      loading = scope;
      try {
        // The appearance owns its catalog load and failure, independently of renderer readiness.
        const base = await catalog;
        if (id !== request || scope.isDisposed()) {
          scope.dispose();
          return;
        }
        // A failed detailed-media request leaves the complete gameplay artwork available.
        scope.lpcCatalog = await loadLpcPreviewCatalog(
          base,
          appearance,
          animation,
          scope.signal,
        ).catch((cause: unknown) => {
          if (scope.signal.aborted) throw cause;
          reportRendererFailure(cause, { surface: "character-preview", phase: "init" });
          return base;
        });
        if (id !== request || scope.isDisposed()) {
          scope.dispose();
          return;
        }
        const mode =
          animation === "stand" || animation === "idle" || animation === "walk"
            ? "travel"
            : "all";
        const actor = await createLpcCharacter(scope, appearance, mode).catch(
          async (cause: unknown) => {
            if (scope.isDisposed() || id !== request || scope.lpcCatalog === base)
              throw cause;
            // Detailed textures can fail independently of their manifest; preserve the usable figure.
            reportRendererFailure(cause, {
              surface: "character-preview",
              phase: "init",
            });
            scope.dispose();
            scope = createRenderScope(game);
            loading = scope;
            scope.lpcCatalog = base;
            return createLpcCharacter(scope, appearance, mode);
          },
        );
        if (id !== request || scope.isDisposed()) {
          scope.dispose();
          return;
        }
        const framing = characterPreviewFraming(
          scope.lpcCatalog,
          appearance,
          animation,
        );
        actor.sprite.position.set(framing.x, framing.y);
        actor.sprite.scale.set(framing.scale);
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
      } finally {
        if (loading === scope) loading = null;
      }
    },
    /** Turn through the six hex facings without reloading the appearance. */
    rotate: () => {
      const order = [2, 3, 5, 0, 4, 1] as const;
      direction = order[(order.indexOf(direction) + 1) % order.length] ?? 2;
      game.invalidate();
    },
  };
};

export type CharacterPreviewScene = Awaited<
  ReturnType<typeof createCharacterPreviewScene>
>;
