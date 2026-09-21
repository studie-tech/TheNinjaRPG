"use client";

import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { FISHING_SPECIES } from "@/libs/fishing";

type FishingState = RouterOutputs["fishing"]["getState"];

export function FishingCollection({
  state,
  pending,
  onInspect,
  onTrack,
}: {
  state: FishingState;
  pending: boolean;
  onInspect: () => void;
  onTrack: (speciesId: string | null) => void;
}) {
  const [filter, setFilter] = useState<"ALL" | "DISCOVERED" | "UNDISCOVERED">("ALL");
  const collection = new Map(state.collection.map((entry) => [entry.speciesId, entry]));
  const visible = FISHING_SPECIES.filter((species) => {
    const discovered = collection.has(species.id);
    return filter === "ALL" || (filter === "DISCOVERED" ? discovered : !discovered);
  });
  return (
    <section className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Collection · {state.collection.length}/{FISHING_SPECIES.length}
        </h2>
        <div className="flex gap-2">
          <select
            className="rounded border bg-background p-2 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            aria-label="Filter collection"
          >
            <option value="ALL">All fish</option>
            <option value="DISCOVERED">Discovered</option>
            <option value="UNDISCOVERED">Undiscovered</option>
          </select>
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={onInspect}
          >
            Review
          </button>
        </div>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((species) => {
          const caught = collection.get(species.id);
          return (
            <li
              key={species.id}
              className="rounded-lg border bg-background/60 p-3 text-sm"
            >
              <span className="font-medium">
                {caught ? species.name : "Undiscovered"}
              </span>
              <br />
              <span className="text-muted-foreground text-xs">
                {caught
                  ? `${caught.caughtCount} caught · best ${caught.bestQuality}/5`
                  : `${species.habitat} · ${species.rarity}`}
              </span>
              {caught && (
                <button
                  type="button"
                  className="mt-2 block rounded border px-2 py-1 text-xs"
                  disabled={pending}
                  onClick={() =>
                    onTrack(state.trackedSpeciesId === species.id ? null : species.id)
                  }
                >
                  {state.trackedSpeciesId === species.id
                    ? "Stop tracking"
                    : "Track school"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
