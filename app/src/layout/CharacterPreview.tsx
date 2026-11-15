"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGameScene } from "@/hooks/game-scene";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { resolveSpriteAppearance, type SpriteUser } from "@/libs/lpc/appearance";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { reportRendererFailure } from "@/libs/rendering/telemetry";
import { cn } from "@/libs/shadui";
import type { LpcAnimation, SpriteAppearance } from "@/validators/lpc";

/**
 * Preview drafts and saved appearances with the same renderer and atlas leases as the maps.
 * One renderer serves the component's lifetime: a recipe change keeps the current figure on
 * screen until its replacement loads. Load failures leave the surrounding form usable.
 */
export const CharacterPreview = ({
  user,
  animation = "idle",
  className,
  label = "Your ninja",
  catalog,
  appearance,
}: {
  user: SpriteUser;
  catalog?: LpcCatalog;
  appearance?: SpriteAppearance;
  animation?: LpcAnimation;
  className?: string;
  label?: string;
}) => {
  const loadLpcCatalog = useLpcCatalogLoader({ preload: !catalog });
  const mount = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const signature = JSON.stringify(appearance ?? resolveSpriteAppearance(user));
  const preview = useGameScene(
    "character-preview",
    mount,
    async (element, signal, onError) => {
      const { createCharacterPreviewScene } = await import(
        "@/libs/rendering/scenes/characterPreview"
      );
      return createCharacterPreviewScene({
        mount: element,
        signal,
        onError,
      });
    },
  );
  const { scene: sceneRef, isReady } = preview;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!isReady || !scene) return;
    let isCurrent = true;
    setFailed(false);
    // Catalog failures belong to this appearance, so another edit can retry on the same renderer.
    scene.show(JSON.parse(signature), animation, catalog ?? loadLpcCatalog()).then(
      () => {
        if (isCurrent) setReady(true);
      },
      (cause: unknown) => {
        if (!isCurrent) return;
        reportRendererFailure(cause, { surface: "character-preview", phase: "init" });
        setFailed(true);
        setReady(false);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [isReady, sceneRef, signature, animation, catalog, loadLpcCatalog]);
  const error = preview.error || failed;
  return (
    <figure className={cn("mx-auto w-64 max-w-full text-center", className)}>
      <div
        ref={mount}
        className="aspect-square w-full overflow-hidden rounded-lg bg-black/10"
        role="img"
        aria-label={`Animated appearance: ${label}`}
      />
      {/* The rotate control sits below the figure so it never covers the character. */}
      <div className="mt-1 flex items-start justify-center gap-2">
        <figcaption
          className="text-muted-foreground min-h-6 min-w-0 text-sm"
          role="status"
        >
          {error
            ? "Character preview unavailable. You can continue editing."
            : ready
              ? label
              : "Loading character preview…"}
        </figcaption>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Rotate character preview"
          hoverText="Rotate preview"
          disabled={!ready || error}
          onClick={() => sceneRef.current?.rotate()}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </figure>
  );
};
