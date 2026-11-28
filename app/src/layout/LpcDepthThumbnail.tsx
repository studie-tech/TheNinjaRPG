"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/libs/shadui";
import type { LpcBody } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Depth-correct neutral artwork loads near the viewport without creating a WebGL scene per card. */
export function LpcDepthThumbnail({
  label,
  config,
  body = "male",
  className,
}: {
  label: string;
  config: LpcConfig;
  body?: LpcBody;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void loadThumbnail()
        .then(({ renderLpcThumbnail }) =>
          renderLpcThumbnail(config, controller.signal, body),
        )
        .then(({ size, pixels }) => {
          if (controller.signal.aborted || !canvas.current) return;
          const context = canvas.current.getContext("2d");
          if (!context) throw new Error("Character thumbnail canvas unavailable");
          let left = size,
            top = size,
            right = -1,
            bottom = -1;
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++)
              if (pixels[(y * size + x) * 4 + 3]) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
          if (right < left) throw new Error("Character thumbnail pose is empty");
          // Transparent overscan protects attacks; neutral thumbnails fit the painted artwork.
          canvas.current.width = right - left + 5;
          canvas.current.height = bottom - top + 5;
          context.putImageData(
            new ImageData(new Uint8ClampedArray(pixels), size, size),
            2 - left,
            2 - top,
          );
          setStatus("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("failed");
        });
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                load();
              }
            },
            { rootMargin: "200px" },
          );
    if (observer && canvas.current) observer.observe(canvas.current);
    else load();
    return () => {
      controller.abort();
      observer?.disconnect();
    };
  }, [config, body]);
  if (status === "failed")
    return <span className="text-muted-foreground text-xs">Preview unavailable</span>;
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      aria-busy={status === "loading"}
      className={cn("object-contain [image-rendering:pixelated]", className)}
    />
  );
}

const loadThumbnail = () => import("@/libs/lpc/thumbnail");
