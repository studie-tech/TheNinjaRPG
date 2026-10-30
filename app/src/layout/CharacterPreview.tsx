"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveSpriteAppearance, type SpriteUser } from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";
import type { LpcAnimation, LpcDirection } from "@/validators/lpc";

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
  const direction = useRef<LpcDirection>(2);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const signature = JSON.stringify(resolveSpriteAppearance(user));
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    // Appearance edits return to the front; manual turns keep the current renderer and leases.
    direction.current = 2;
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
            animation === "stand" || animation === "idle" || animation === "walk"
              ? "travel"
              : "all",
          );
          if (controller.signal.aborted) return;
          actor.sprite.position.set(128, 125);
          // Enlarge facial details within the compact preview without expanding the form.
          actor.sprite.scale.set(160);
          game.stage.addChild(actor.sprite);
          game.setUpdate((frame) => {
            actor.render(frame, animation, direction.current);
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
      <div className="relative">
        <div
          ref={mount}
          className="aspect-square w-full overflow-hidden rounded-lg bg-black/10"
          role="img"
          aria-label={`Animated appearance: ${label}`}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute top-1 right-1 h-8 w-8"
          aria-label="Rotate character preview"
          hoverText="Rotate preview"
          disabled={!ready || error}
          onClick={() => {
            direction.current = ((direction.current + 1) % 4) as LpcDirection;
          }}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
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
