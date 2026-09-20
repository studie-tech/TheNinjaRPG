"use client";

import { FISHING_SPECIES } from "@/libs/fishing";

export type CatchResultData = {
  speciesId: string;
  fishingExperienceDelta: number;
  isFirstDiscovery: boolean;
  size: number;
  quality: number;
  pendingInventoryClaim: boolean;
};

export function CatchResult({ result }: { result: CatchResultData }) {
  const fish = FISHING_SPECIES.find((entry) => entry.id === result.speciesId);
  return (
    <section
      className="rounded-xl border border-cyan-400/40 bg-cyan-950/30 p-4"
      aria-live="polite"
    >
      <p className="font-semibold text-cyan-300 text-xs uppercase tracking-widest">
        {result.isFirstDiscovery ? "New discovery" : "Catch recorded"}
      </p>
      <h2 className="mt-1 font-bold text-xl">{fish?.name ?? "Unknown fish"}</h2>
      <p className="mt-2 text-sm">
        Size {result.size} · Quality {result.quality}/5 · +
        {result.fishingExperienceDelta} fishing XP
      </p>
      {result.pendingInventoryClaim && (
        <p className="mt-2 text-amber-300 text-sm">
          Your inventory was full. The catch is safely waiting below.
        </p>
      )}
    </section>
  );
}
