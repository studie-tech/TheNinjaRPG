"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { FISHING_STARTER_BAIT } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { FishingRaidActivity } from "@/layout/FishingRaidActivity";
import Loader from "@/layout/Loader";
import { FISHING_SPECIES, getFishingCue } from "@/libs/fishing";
import { useRequiredUserData } from "@/utils/UserContext";

/** Keyboard-friendly fishing controls. The server remains authoritative for every state change. */
export function FishingActivity() {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const query = api.fishing.getState.useQuery(undefined, { refetchInterval: 5_000 });
  const [notice, setNotice] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<
    "ALL" | "DISCOVERED" | "UNDISCOVERED"
  >("ALL");
  const [habitatFilter, setHabitatFilter] = useState("ALL");
  const [lastDiscoverySpeciesId, setLastDiscoverySpeciesId] = useState<string | null>(
    null,
  );
  const [rodUserItemId, setRodUserItemId] = useState("");
  const [baitUserItemId, setBaitUserItemId] = useState("");
  const [tackleUserItemId, setTackleUserItemId] = useState<string | null>(null);
  const refresh = () => void utils.fishing.getState.invalidate();
  const tutorial = api.fishing.claimTutorialSupplies.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const recoverStarter = api.fishing.recoverStarterSupplies.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const cast = api.fishing.cast.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const act = api.fishing.act.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const resolve = api.fishing.resolve.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      setLastDiscoverySpeciesId(
        result.success && result.isFirstDiscovery ? result.speciesId : null,
      );
      refresh();
    },
  });
  const claimPendingCatch = api.fishing.claimPendingCatch.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const markSchool = api.fishing.markSchool.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const trackSpecies = api.fishing.trackSpecies.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const inspectCollection = api.fishing.inspectCollection.useMutation({
    onSuccess: (result) => setNotice(result.message),
  });
  const activeSession = query.data?.activeSession;
  useEffect(() => {
    const equipment = query.data?.equipment;
    if (!equipment) return;
    const selectFirst = (kind: "ROD" | "BAIT" | "TACKLE", current: string) =>
      equipment.some((entry) => entry.userItemId === current && entry.kind === kind)
        ? current
        : (equipment.find((entry) => entry.kind === kind)?.userItemId ?? "");
    setRodUserItemId((current) => selectFirst("ROD", current));
    setBaitUserItemId((current) => selectFirst("BAIT", current));
    setTackleUserItemId((current) => {
      if (!current) return null;
      return equipment.some(
        (entry) => entry.userItemId === current && entry.kind === "TACKLE",
      )
        ? current
        : null;
    });
  }, [query.data?.equipment]);
  useEffect(() => {
    const keyActions = {
      l: "LURE",
      h: "HOOK",
      r: "REEL",
      s: "SLACK",
      t: "STEER",
    } as const;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !activeSession ||
        act.isPending ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            "input, textarea, select, button, [contenteditable='true']",
          ))
      )
        return;
      const action = keyActions[event.key.toLowerCase() as keyof typeof keyActions];
      const isExpectedAction =
        action &&
        ((activeSession.state === "ATTRACT" && action === "LURE") ||
          (activeSession.state === "HOOK" && action === "HOOK") ||
          (activeSession.state === "FIGHT" &&
            (action === "REEL" || action === "SLACK" || action === "STEER")));
      if (!isExpectedAction) return;
      event.preventDefault();
      act.mutate({
        sessionId: activeSession.id,
        version: activeSession.version,
        action,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [act, activeSession]);
  if (!query.data) return <Loader explanation="Preparing fishing..." />;
  const state = query.data;
  const session = state.activeSession;
  const fish = session
    ? FISHING_SPECIES.find((entry) => entry.id === session.speciesId)
    : undefined;
  const availableActions =
    session?.state === "ATTRACT"
      ? (["LURE"] as const)
      : session?.state === "HOOK"
        ? (["HOOK"] as const)
        : session?.state === "FIGHT"
          ? (["REEL", "SLACK", "STEER"] as const)
          : [];
  const collectionBySpecies = new Map(
    state.collection.map((record) => [record.speciesId, record]),
  );
  const habitats = [...new Set(FISHING_SPECIES.map((entry) => entry.habitat))];
  const filteredSpecies = FISHING_SPECIES.filter((entry) => {
    const discovered = collectionBySpecies.has(entry.id);
    return (
      (collectionFilter === "ALL" ||
        (collectionFilter === "DISCOVERED" && discovered) ||
        (collectionFilter === "UNDISCOVERED" && !discovered)) &&
      (habitatFilter === "ALL" || entry.habitat === habitatFilter)
    );
  });
  return (
    <ContentBox
      title="Fishing"
      subtitle="Explore water, read each fish, and build your collection"
      defaultBackHref="/home"
      initialBreak
    >
      <div className="space-y-4" aria-live="polite">
        <p>
          Level {state.fishingLevel} · {state.fishingExperience.toLocaleString()} XP ·{" "}
          {state.equipment
            .filter((entry) => entry.kind === "BAIT")
            .reduce((total, entry) => total + entry.quantity, 0)}{" "}
          bait
        </p>
        <p className="text-sm">
          Fishing Together: {state.participantCount} active angler
          {state.participantCount === 1 ? "" : "s"} · +{state.socialBonusPercent}% XP
          and bite attraction
        </p>
        {!state.tutorialClaimed && (
          <section className="rounded border p-4">
            <h2 className="font-semibold">Learn to fish</h2>
            <p className="my-2 text-sm">
              No quest is required. Start the tutorial here to receive a Bamboo Rod and{" "}
              {FISHING_STARTER_BAIT} Starter Grub, then use the live fishing controls
              below.
            </p>
            <button
              type="button"
              className="rounded bg-primary px-4 py-2 text-primary-foreground"
              onClick={() => tutorial.mutate()}
              disabled={tutorial.isPending}
            >
              Start fishing tutorial
            </button>
          </section>
        )}
        {state.tutorialClaimed && (
          <section className="rounded border p-4 text-sm">
            <h2 className="font-semibold">How to fish</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Stand on a reachable bank in an active fishing habitat.</li>
              <li>Select a rod and bait, then choose Fish here.</li>
              <li>Use Lure until the fish bites, then Hook promptly.</li>
              <li>Follow the fish cue with Reel, Slack, or Steer.</li>
              <li>Keep the catch for your cooking inventory or release it.</li>
            </ol>
          </section>
        )}
        {state.tutorialClaimed && !state.starterRecoveryClaimed && (
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() => recoverStarter.mutate()}
            disabled={recoverStarter.isPending}
          >
            Recover starter rod and bait once
          </button>
        )}
        {notice && <p className="rounded border p-3 text-sm">{notice}</p>}
        {!session && state.equipment.some((entry) => entry.kind === "ROD") && (
          <section className="rounded border p-4">
            <h2 className="font-semibold">Current bank</h2>
            <p className="my-2 text-sm">
              Cast from a reachable bank in an active habitat. Schools are optional
              sightings; an active habitat is required.
            </p>
            <div className="my-3 grid gap-2 text-sm sm:grid-cols-3">
              <label>
                Rod
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={rodUserItemId}
                  onChange={(event) => setRodUserItemId(event.target.value)}
                >
                  <option value="">Choose a rod</option>
                  {state.equipment
                    .filter((entry) => entry.kind === "ROD")
                    .map((entry) => (
                      <option key={entry.userItemId} value={entry.userItemId}>
                        {entry.name} (+{entry.attractionBonus}% bite, +
                        {entry.controlBonus} control)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Bait
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={baitUserItemId}
                  onChange={(event) => setBaitUserItemId(event.target.value)}
                >
                  <option value="">Choose bait</option>
                  {state.equipment
                    .filter((entry) => entry.kind === "BAIT")
                    .map((entry) => (
                      <option key={entry.userItemId} value={entry.userItemId}>
                        {entry.name} ×{entry.quantity} (+{entry.attractionBonus}% bite)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Tackle
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={tackleUserItemId ?? ""}
                  onChange={(event) => setTackleUserItemId(event.target.value || null)}
                >
                  <option value="">No tackle</option>
                  {state.equipment
                    .filter((entry) => entry.kind === "TACKLE")
                    .map((entry) => (
                      <option key={entry.userItemId} value={entry.userItemId}>
                        {entry.name} (+{entry.attractionBonus}% bite, +
                        {entry.controlBonus} control)
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="rounded bg-primary px-4 py-2 text-primary-foreground"
              onClick={() =>
                userData && rodUserItemId && baitUserItemId
                  ? cast.mutate({
                      sector: userData.sector,
                      rodUserItemId,
                      baitUserItemId,
                      tackleUserItemId,
                    })
                  : undefined
              }
              disabled={
                cast.isPending || !userData || !rodUserItemId || !baitUserItemId
              }
            >
              Fish here
            </button>
          </section>
        )}
        {session && (
          <section className="rounded border p-4">
            <h2 className="font-semibold">
              {fish?.name ?? "Fish"} — {session.state}
            </h2>
            <p className="my-2 text-sm">
              Tension: {session.tension}% · Landing: {session.landingProgress}%
            </p>
            <p className="my-2 text-sm">
              Cue: {getFishingCue(fish?.behavior, session.state)}
            </p>
            {availableActions.length > 0 && (
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Fishing controls</legend>
                {availableActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="rounded border px-3 py-2"
                    onClick={() =>
                      act.mutate({
                        sessionId: session.id,
                        version: session.version,
                        action,
                      })
                    }
                    disabled={act.isPending}
                  >
                    {action} <span className="text-xs">[{action[0]}]</span>
                  </button>
                ))}
              </fieldset>
            )}
            {session.state === "LANDED" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded bg-primary px-3 py-2 text-primary-foreground"
                  onClick={() =>
                    resolve.mutate({
                      sessionId: session.id,
                      version: session.version,
                      keep: true,
                    })
                  }
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-2"
                  onClick={() =>
                    resolve.mutate({
                      sessionId: session.id,
                      version: session.version,
                      keep: false,
                    })
                  }
                >
                  Release
                </button>
              </div>
            )}
          </section>
        )}
        {state.pendingCatches.length > 0 && (
          <section className="rounded border p-4">
            <h2 className="font-semibold">Pending catches</h2>
            <p className="my-1 text-sm">
              Make room in your cooking inventory, then claim each fish. Your catch and
              XP are safe.
            </p>
            <div className="flex flex-wrap gap-2">
              {state.pendingCatches.map((catchReceipt) => (
                <button
                  key={catchReceipt.sessionId}
                  type="button"
                  className="rounded border px-3 py-2"
                  onClick={() =>
                    claimPendingCatch.mutate({ sessionId: catchReceipt.sessionId })
                  }
                  disabled={claimPendingCatch.isPending}
                >
                  Claim{" "}
                  {FISHING_SPECIES.find((entry) => entry.id === catchReceipt.speciesId)
                    ?.name ?? "fish"}
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="rounded border p-4">
          <h2 className="font-semibold">Nearby schools</h2>
          {state.schools.length === 0 ? (
            <p className="mt-2 text-sm">
              No visible schools. Ordinary water can still hold basic catches.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {state.schools.map((school) => (
                <li
                  key={school.habitatId}
                  className="flex flex-wrap items-center gap-2"
                >
                  School at {school.x}, {school.y}; moving soon{" "}
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    onClick={() => markSchool.mutate({ habitatId: school.habitatId })}
                    disabled={markSchool.isPending}
                  >
                    Mark school
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.recentMarks.length > 0 && (
            <p className="mt-2 text-xs">
              Recent shared sightings: {state.recentMarks.length}
            </p>
          )}
        </section>
        <section>
          <h2 className="font-semibold">
            Collection — {state.collection.length}/{FISHING_SPECIES.length}
          </h2>
          <button
            type="button"
            className="mt-2 rounded border px-3 py-2 text-sm"
            onClick={() => inspectCollection.mutate()}
            disabled={inspectCollection.isPending}
          >
            Review collection
          </button>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <label>
              <span className="sr-only">Collection status</span>
              <select
                className="rounded border p-2"
                value={collectionFilter}
                onChange={(event) =>
                  setCollectionFilter(event.target.value as typeof collectionFilter)
                }
              >
                <option value="ALL">All fish</option>
                <option value="DISCOVERED">Discovered</option>
                <option value="UNDISCOVERED">Undiscovered</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Habitat</span>
              <select
                className="rounded border p-2"
                value={habitatFilter}
                onChange={(event) => setHabitatFilter(event.target.value)}
              >
                <option value="ALL">All habitats</option>
                {habitats.map((habitat) => (
                  <option key={habitat} value={habitat}>
                    {habitat}
                  </option>
                ))}
              </select>
            </label>
            {state.trackedSpeciesId && (
              <span className="self-center">Tracking a discovered fish below.</span>
            )}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredSpecies.map((entry) => {
              const caught = collectionBySpecies.get(entry.id);
              return (
                <li key={entry.id} className="rounded border p-2 text-sm">
                  {caught ? entry.name : "Undiscovered"}
                  <br />
                  {caught
                    ? `${caught.caughtCount} caught · largest ${caught.largestSize} · quality ${caught.bestQuality}`
                    : `${entry.habitat} · ${entry.rarity}`}
                  {caught && (
                    <>
                      <br />
                      <span className="text-xs">
                        First caught {caught.firstCaughtAt.toLocaleDateString()}
                      </span>
                    </>
                  )}
                  {lastDiscoverySpeciesId === entry.id && (
                    <>
                      <br />
                      <span className="font-semibold">New discovery!</span>
                    </>
                  )}
                  {caught && (
                    <button
                      type="button"
                      className="mt-2 block rounded border px-2 py-1 text-xs"
                      onClick={() =>
                        trackSpecies.mutate({
                          speciesId:
                            state.trackedSpeciesId === entry.id ? null : entry.id,
                        })
                      }
                      disabled={trackSpecies.isPending}
                    >
                      {state.trackedSpeciesId === entry.id ? "Clear tracking" : "Track"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <FishingRaidActivity />
      </div>
    </ContentBox>
  );
}
