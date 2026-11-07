"use client";

import { Suspense } from "react";
import Loader from "@/layout/Loader";
import { SpriteStudio } from "@/layout/SpriteStudio";

/** Isolate URL-dependent preselection behind the route's loading boundary. */
export default function ManualSpriteStudio() {
  return (
    <Suspense fallback={<Loader explanation="Loading sprite studio" />}>
      <SpriteStudio />
    </Suspense>
  );
}
