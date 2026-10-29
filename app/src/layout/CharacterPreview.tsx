"use client";

import { useEffect, useRef, useState } from "react";
import { resolveSpriteAppearance, type SpriteUser } from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";
import type { LpcAnimation } from "@/validators/lpc";

/**
 * Preview drafts and saved appearances with the same renderer and atlas leases as the maps.
 * Recipe changes abort the previous render scope; load failures leave the surrounding form usable.
 */
export const CharacterPreview = ({
  user,
  animation = "idle",
  className,
  label = "Your ninja",
}: {
  user: SpriteUser;
  animation?: LpcAnimation;
  className?: string;
  label?: string;
}) => {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const signature = JSON.stringify(resolveSpriteAppearance(user));
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    setError(false);
    setReady(false);
    void Promise.all([
      import("@/libs/rendering/runtime"),
      import("@/libs/rendering/primitives/character"),
    ])
      .then(async ([{ createGameRenderer }, { createLpcCharacter }]) => {
        if (controller.signal.aborted) return;
        const game = await createGameRenderer({
          mount: element,
          signal: controller.signal,
          width: 256,
          height: () => 256,
          onError: () => setError(true),
        });
        dispose = game.dispose;
        // Preserve the square aspect when the rem-sized mount follows the player's font scale.
        game.canvas.style.height = "auto";
        try {
          const actor = await createLpcCharacter(
            game,
            JSON.parse(signature),
            animation === "idle" || animation === "walk" ? "travel" : "all",
          );
          if (controller.signal.aborted) return;
          actor.sprite.position.set(128, 125);
          actor.sprite.scale.set(128);
          game.stage.addChild(actor.sprite);
          let start = 0;
          game.setUpdate((frame) => {
            if (!start) start = frame.now;
            // Show the front first so appearance edits are visible as soon as they load.
            const direction = frame.reducedMotion
              ? 2
              : (2 + Math.floor((frame.now - start) / 3000)) % 4;
            actor.render(frame, animation, direction as 0 | 1 | 2 | 3);
          });
          setReady(true);
        } catch (cause) {
          game.dispose();
          throw cause;
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [signature, animation]);
  return (
    <figure className={cn("mx-auto w-64 max-w-full text-center", className)}>
      <div
        ref={mount}
        className="aspect-square w-full overflow-hidden rounded-lg bg-black/10"
        role="img"
        aria-label={`Animated appearance: ${label}`}
      />
      <figcaption className="text-muted-foreground min-h-6 text-sm" role="status">
        {error
          ? "Character preview unavailable. You can continue editing."
          : ready
            ? label
            : "Loading character preview…"}
      </figcaption>
    </figure>
  );
};
