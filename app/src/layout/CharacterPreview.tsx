"use client";

import { useEffect, useRef, useState } from "react";
import { resolveSpriteAppearance, type SpriteUser } from "@/libs/lpc/appearance";
import type { LpcAnimation } from "@/validators/lpc";

/** Uses the game renderer and atlas leases so creation and wardrobe previews match the maps. */
export const CharacterPreview = ({
  user,
  animation = "idle",
}: {
  user: SpriteUser;
  animation?: LpcAnimation;
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
        try {
          const actor = await createLpcCharacter(game, JSON.parse(signature));
          if (controller.signal.aborted) return;
          actor.sprite.position.set(128, 125);
          actor.sprite.scale.set(128);
          game.stage.addChild(actor.sprite);
          let start = 0;
          game.setUpdate((frame) => {
            if (!start) start = frame.now;
            const direction = frame.reducedMotion
              ? 2
              : Math.floor((frame.now - start) / 3000) % 4;
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
    <figure className="mx-auto max-w-64 text-center">
      <div
        ref={mount}
        className="aspect-square w-64 max-w-full overflow-hidden rounded-lg bg-black/10"
        role="img"
        aria-label="Animated appearance of your ninja"
      />
      <figcaption className="text-muted-foreground min-h-6 text-sm" role="status">
        {error
          ? "Character preview unavailable. Your choices are still saved."
          : ready
            ? "Your ninja"
            : "Loading character preview…"}
      </figcaption>
    </figure>
  );
};
