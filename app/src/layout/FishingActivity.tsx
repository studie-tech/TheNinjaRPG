"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { FISHING_STARTER_BAIT } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { FishingRaidActivity } from "@/layout/FishingRaidActivity";
import { FishingCollection } from "@/layout/fishing/FishingCollection";
import { FishingVisualEncounter } from "@/layout/fishing/FishingVisualEncounter";
import Loader from "@/layout/Loader";
import { FISHING_SPECIES } from "@/libs/fishing";
import { useRequiredUserData } from "@/utils/UserContext";

export function FishingActivity() {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const query = api.fishing.getState.useQuery(undefined, { refetchInterval: 5_000 });
  const [notice, setNotice] = useState("");
  const refresh = () => void utils.fishing.getState.invalidate();
  const tutorial = api.fishing.claimTutorialSupplies.useMutation({
    onSuccess: (response) => {
      setNotice(response.message);
      refresh();
    },
  });
  const recover = api.fishing.recoverStarterSupplies.useMutation({
    onSuccess: (response) => {
      setNotice(response.message);
      refresh();
    },
  });
  const claim = api.fishing.claimPendingCatch.useMutation({
    onSuccess: (response) => {
      setNotice(response.message);
      refresh();
    },
  });
  const mark = api.fishing.markSchool.useMutation({
    onSuccess: (response) => {
      setNotice(response.message);
      refresh();
    },
  });
  const track = api.fishing.trackSpecies.useMutation({
    onSuccess: (response) => {
      setNotice(response.message);
      refresh();
    },
  });
  const inspect = api.fishing.inspectCollection.useMutation({
    onSuccess: (response) => setNotice(response.message),
  });

  if (!query.data || !userData)
    return <Loader explanation="Preparing the riverbank…" />;
  const state = query.data;
  const baitCount = state.equipment
    .filter((entry) => entry.kind === "BAIT")
    .reduce((total, entry) => total + entry.quantity, 0);

  return (
    <ContentBox
      title="Fishing"
      subtitle="Cast by hand, read the water, and land fish through direct control"
      defaultBackHref="/home"
      initialBreak
    >
      <div className="space-y-4">
        <header className="grid gap-2 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3">
          <Stat label="Fishing level" value={state.fishingLevel.toString()} />
          <Stat label="Experience" value={state.fishingExperience.toLocaleString()} />
          <Stat label="Bait carried" value={baitCount.toString()} />
          <p className="text-muted-foreground text-xs sm:col-span-3">
            Fishing Together: {state.participantCount} active angler
            {state.participantCount === 1 ? "" : "s"} · +{state.socialBonusPercent}%
            attraction and XP
          </p>
        </header>

        {!state.tutorialClaimed && (
          <section className="rounded-xl border border-cyan-400/40 bg-cyan-950/20 p-4">
            <h2 className="font-semibold">Fishing Fundamentals</h2>
            <p className="mt-2 text-sm">
              Accept the Fishing Fundamentals mission, then claim a Bamboo Rod and{" "}
              {FISHING_STARTER_BAIT} Starter Grub here. The mission walks through a
              cast, catch, collection review, and species tracking.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="rounded border px-3 py-2 text-sm" href="/missionhall">
                Open mission hall
              </Link>
              <button
                type="button"
                className="rounded bg-primary px-3 py-2 text-primary-foreground text-sm"
                disabled={tutorial.isPending}
                onClick={() => tutorial.mutate()}
              >
                Claim mission supplies
              </button>
            </div>
          </section>
        )}

        {state.tutorialClaimed && !state.starterRecoveryClaimed && (
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            disabled={recover.isPending}
            onClick={() => recover.mutate()}
          >
            Recover starter rod and bait once
          </button>
        )}

        {notice && (
          <p className="rounded-lg border p-3 text-sm" aria-live="polite">
            {notice}
          </p>
        )}

        {state.tutorialClaimed && (
          <FishingVisualEncounter
            state={state}
            sector={userData.sector}
            onNotice={setNotice}
            onRefresh={refresh}
          />
        )}

        {state.pendingCatches.length > 0 && (
          <section className="rounded-xl border p-4">
            <h2 className="font-semibold">Pending catches</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Make cooking-inventory space, then claim these secured catches.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {state.pendingCatches.map((entry) => (
                <button
                  key={entry.sessionId}
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate({ sessionId: entry.sessionId })}
                >
                  Claim{" "}
                  {FISHING_SPECIES.find((fish) => fish.id === entry.speciesId)?.name ??
                    "fish"}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl border p-4">
          <h2 className="font-semibold">Live schools</h2>
          {state.schools.length === 0 ? (
            <p className="mt-2 text-muted-foreground text-sm">
              No school is visible from this bank. You can still catch ordinary fish.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {state.schools.map((school) => (
                <li key={school.habitatId} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      Ripples at {school.x}, {school.y}
                      {school.matchesTrackedSpecies && (
                        <strong className="ml-2 text-cyan-400">Tracked match</strong>
                      )}
                    </span>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={mark.isPending}
                      onClick={() => mark.mutate({ habitatId: school.habitatId })}
                    >
                      Mark
                    </button>
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Moves in{" "}
                    {Math.max(
                      0,
                      Math.ceil((school.movesAt.getTime() - Date.now()) / 1_000),
                    )}
                    s
                  </p>
                </li>
              ))}
            </ul>
          )}
          {state.recentMarks.length > 0 && (
            <p className="mt-2 text-muted-foreground text-xs">
              {state.recentMarks.length} shared sighting
              {state.recentMarks.length === 1 ? "" : "s"} still active.
            </p>
          )}
        </section>

        <FishingCollection
          state={state}
          pending={track.isPending}
          onInspect={() => inspect.mutate()}
          onTrack={(speciesId) => track.mutate({ speciesId })}
        />

        <FishingRaidActivity />
      </div>
    </ContentBox>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
      <p className="font-semibold text-lg">{value}</p>
    </div>
  );
}
