"use client";

import { Suspense } from "react";
import { GameAssetLibrary } from "@/layout/GameAssetLibrary";
import Loader from "@/layout/Loader";

/** Isolate URL-dependent library rendering behind the route's loading boundary. */
export function ManualAssetsScreen() {
  return (
    <Suspense fallback={<Loader explanation="Loading asset library" />}>
      <GameAssetLibrary />
    </Suspense>
  );
}
