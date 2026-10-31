"use client";

import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HUNTING_RANKS } from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { HuntingRewards } from "@/layout/CombatRewards";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { SearchSelect } from "@/layout/SearchSelect";
import { getHuntingRank, getHuntingRankProgress } from "@/libs/hunting";
import {
  huntingAllowance,
  huntingEligibility,
  huntingSessionStage,
} from "@/libs/hunting/contracts";
import { useUserData } from "@/utils/UserContext";
import type { HuntingReceipt } from "@/validators/hunting";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Browse and manage the same personal session from the occupation or combat result.
 * Active summaries and catalogue rows use accepted terms until the session is released.
 * Successful starts own profile/cache updates; onStarted clears an existing combat result.
 * sessionOnly omits browsing and reward summaries to keep arrival dialogs focused.
 */
export function HuntingBoard({
  victory,
  onStarted,
  sessionOnly = false,
}: {
  victory?: HuntingReceipt;
  onStarted?: () => void;
  sessionOnly?: boolean;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const { updateUser, prepareUserUpdate } = useUserData();
  const [habitatId, setHabitatId] = useState("");
  const [creature, setCreature] = useState("");
  const [rank, setRank] = useState("");
  const [material, setMaterial] = useState("");
  const [showSelector, setShowSelector] = useState(!victory);
  const selector = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const board = api.hunting.getBoard.useQuery(undefined, {
    refetchInterval: 5000,
    refetchOnMount: "always",
  });
  /** Keep expected rejections beside the action and refetch authoritative state after success. */
  const refresh = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    if (result.success || result.userPatch)
      await updateUser(result.userPatch, { revision });
    setMessage(result.message);
    if (result.success)
      await Promise.all([board.refetch(), utils.hunting.getSession.invalidate()]);
  };
  const accept = api.hunting.accept.useMutation({
    onSuccess: refresh,
    onMutate: prepareUserUpdate,
    onError: (e) => setMessage(e.message),
  });
  const action = api.hunting.sessionAction.useMutation({
    onSuccess: refresh,
    onMutate: prepareUserUpdate,
    onError: (e) => setMessage(e.message),
  });
  const start = api.hunting.start.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      setMessage(result.message);
      if (result.success && "battleId" in result && result.battleId) {
        // Clear the previous result before publishing the new battle, as arena starts do.
        onStarted?.();
        await updateUser(result.userPatch, {
          revision,
          ...(result.userDelta ? { delta: result.userDelta } : {}),
        });
        await Promise.all([
          utils.hunting.getBoard.invalidate(),
          utils.hunting.getSession.invalidate(),
          utils.combat.getBattle.invalidate(),
        ]);
        if (!onStarted) router.push("/combat");
      } else await board.refetch();
    },
    onError: (e) => setMessage(e.message),
  });
  const pending = accept.isPending || action.isPending || start.isPending;
  const data = board.data;
  const session = data?.session;
  const user = data?.user;
  const activeHabitat = session?.content;
  const active = activeHabitat?.contracts.find((c) => c.id === session?.contractId);
  const progress = data?.progress.find((p) => p.contractId === active?.id);
  const allowance = active
    ? huntingAllowance(active, progress, data?.serverTime.getTime())
    : null;
  const now = data?.serverTime.getTime() ?? Date.now();
  const preparing = !!session?.readyAt && session.readyAt.getTime() > now;
  const receipt = session?.lastResult ?? victory;
  const experience = user?.huntingExperience ?? receipt?.totalExperience ?? 0;
  const rankProgress = getHuntingRankProgress(experience);
  // Drop empty habitats after combining filters so the board has one empty state.
  const filteredHabitats = (data?.habitats ?? [])
    .filter((h) => !habitatId || habitatId === h.id)
    .map((h) => ({
      ...h,
      content: {
        ...h.content,
        // The active row describes the accepted session until it finishes or switches.
        contracts: h.content.contracts
          .map((c) => (h.id === session?.habitatId && c.id === active?.id ? active : c))
          .filter((c) => {
            const ai = data?.creatures.find((a) => a.userId === c.aiId);
            return (
              (!rank || c.rank === rank) &&
              (!creature.trim() ||
                `${ai?.username ?? ""} ${c.name}`
                  .toLowerCase()
                  .includes(creature.trim().toLowerCase())) &&
              (!material.trim() ||
                c.rewards.some((r) =>
                  data?.materials
                    .find((m) => m.id === r.itemId)
                    ?.name.toLowerCase()
                    .includes(material.trim().toLowerCase()),
                ))
            );
          }),
      },
    }))
    .filter((h) => h.content.contracts.length > 0);
  if (board.isLoading) return <Loader explanation="Loading hunting contracts" />;
  return (
    <ContentBox
      title="Hunting contracts"
      subtitle="Choose a target, travel, prepare and fight"
    >
      <div className="space-y-4 text-left">
        {(message || board.error) && (
          <p role="status" className="rounded border p-3">
            {message || board.error?.message}
          </p>
        )}
        {!sessionOnly && user && (
          <p>
            Hunting rank: <strong>{getHuntingRank(experience)}</strong> ·{" "}
            {experience.toLocaleString()} experience ·{" "}
            {rankProgress.nextRank
              ? `${rankProgress.progress.toFixed(1)}% to next rank`
              : "Maximum rank reached"}
          </p>
        )}
        {user?.occupation !== "HUNTER" && (
          <p>Select the Hunter occupation to accept contracts.</p>
        )}
        {!sessionOnly && receipt && <HuntingRewards receipt={receipt} />}
        {session && (
          <div className="space-y-3 rounded border bg-muted/30 p-4">
            <h3 className="font-semibold text-lg">
              {active?.name ?? "Unavailable contract"}
            </h3>
            <p>
              {activeHabitat?.name} · Personal encounter in sector{" "}
              <strong>{session.sector}</strong>
            </p>
            <p>{huntingSessionStage(session, !!allowance?.cooling, now)}</p>
            {allowance && (
              <p>
                {allowance.remaining} / {active?.hunts} successful hunts remaining
              </p>
            )}
            {progress?.cooldownUntil && allowance?.cooling && (
              <p>Available again: {progress.cooldownUntil.toLocaleString()}</p>
            )}
            {!active && (
              <p>
                The accepted contract is unavailable. Finish this session and select a
                new contract.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 [&_button]:h-full [&_button]:min-h-9 [&_button]:w-full [&_button]:whitespace-normal">
              {user?.sector !== session.sector && (
                <Link href={`/travel?sector=${session.sector}`}>
                  <Button variant="secondary">Travel to sector {session.sector}</Button>
                </Link>
              )}
              {session.battleId ? (
                <Link href="/combat">
                  <Button>Return to fight</Button>
                </Link>
              ) : (
                <>
                  {!session.readyAt && active && (
                    <Button
                      disabled={
                        pending ||
                        user?.sector !== session.sector ||
                        user?.status !== "AWAKE"
                      }
                      onClick={() =>
                        action.mutate({
                          id: session.id,
                          version: session.version,
                          action: "prepare",
                        })
                      }
                    >
                      Prepare ({active.preparationSeconds}s)
                    </Button>
                  )}
                  {session.readyAt && active && (
                    <Button
                      loading={start.isPending}
                      disabled={
                        pending ||
                        preparing ||
                        !allowance?.remaining ||
                        allowance.cooling ||
                        user?.status !== "AWAKE" ||
                        user?.sector !== session.sector ||
                        !huntingEligibility(
                          user?.occupation ?? null,
                          experience,
                          active,
                        )
                      }
                      onClick={() => start.mutate({ id: session.id })}
                    >
                      {receipt?.outcome === "Won" ? "Hunt Again" : "Fight creature"}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      if (sessionOnly) {
                        router.push("/occupation");
                        return;
                      }
                      setShowSelector(true);
                      requestAnimationFrame(() => {
                        selector.current?.focus({ preventScroll: true });
                        selector.current?.scrollIntoView({
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "auto"
                            : "smooth",
                          block: "start",
                        });
                      });
                    }}
                  >
                    Select New Contract
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      action.mutate({
                        id: session.id,
                        version: session.version,
                        action: "finish",
                      })
                    }
                  >
                    Finish Hunting
                  </Button>
                </>
              )}
            </div>
            {user?.sector !== session.sector && (
              <p>
                Travel to the assigned sector before preparing or fighting. Your
                encounter stays assigned when you refresh.
              </p>
            )}
            {user?.status === "HOSPITALIZED" && (
              <Link href="/hospital">
                Recover at the hospital, then retry. Defeat does not consume a hunt.
              </Link>
            )}
          </div>
        )}
        {!sessionOnly && (showSelector || !session) && (
          <>
            <div ref={selector} tabIndex={-1} className="space-y-2">
              <fieldset
                className="flex flex-wrap items-center gap-2"
                aria-label="Hunting rank filter"
              >
                {["", ...HUNTING_RANKS].map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={rank === r ? "default" : "outline"}
                    aria-pressed={rank === r}
                    onClick={() => setRank(r)}
                  >
                    {r || "All ranks"}
                  </Button>
                ))}
                <div className="min-w-48 flex-1">
                  <SearchSelect
                    label="Habitat filter"
                    value={habitatId}
                    onChange={setHabitatId}
                    placeholder="All habitats"
                    options={[
                      { value: "", label: "All habitats" },
                      ...(data?.habitats.map((h) => ({
                        value: h.id,
                        label: h.content.name,
                      })) ?? []),
                    ]}
                  />
                </div>
              </fieldset>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="Creature filter"
                  placeholder="Search creature or contract"
                  value={creature}
                  onChange={(e) => setCreature(e.target.value)}
                />
                <Input
                  aria-label="Material filter"
                  placeholder="Search desired material"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                />
              </div>
            </div>
            {!data?.habitats.length && (
              <p className="rounded border p-4">
                No hunting habitats are available yet. Staff are preparing the contract
                board.
              </p>
            )}
            {!!data?.habitats.length && !filteredHabitats.length && (
              <p role="status">No contracts match these filters.</p>
            )}
            {data &&
              filteredHabitats.map((h) => {
                const contracts = h.content.contracts;
                return (
                  <section key={h.id} className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-xl">{h.content.name}</h3>
                      <p>{h.content.description}</p>
                      <p className="text-muted-foreground text-sm">
                        Habitat sectors: {h.content.sectors.join(", ")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {contracts.map((c) => {
                        const p = data.progress.find((row) => row.contractId === c.id);
                        const available = huntingAllowance(c, p, now);
                        const eligible = huntingEligibility(
                          user?.occupation ?? null,
                          experience,
                          c,
                        );
                        const ai = data.creatures.find((a) => a.userId === c.aiId);
                        return (
                          <article
                            key={c.id}
                            className="grid items-center gap-3 rounded border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]"
                          >
                            <div className="min-w-0 space-y-1">
                              <h4 className="font-semibold">{c.name}</h4>
                              <p>
                                {ai?.username ?? "Creature unavailable"} · Level{" "}
                                {ai?.level} · {c.rank} · {c.difficulty}
                              </p>
                            </div>
                            <div className="min-w-0 space-y-1">
                              <p>
                                Guaranteed:{" "}
                                {c.rewards
                                  .filter((r) => r.chance === 100)
                                  .map(
                                    (r) =>
                                      `${r.quantity}× ${data.materials.find((m) => m.id === r.itemId)?.name ?? "Unavailable material"}`,
                                  )
                                  .join(", ")}
                              </p>
                              <p>
                                Bonus:{" "}
                                {c.rewards
                                  .filter((r) => r.chance < 100)
                                  .map(
                                    (r) =>
                                      `${r.quantity}× ${data.materials.find((m) => m.id === r.itemId)?.name ?? "Unavailable material"} (${r.chance}%)`,
                                  )
                                  .join(", ") || "None"}
                              </p>
                            </div>
                            <div className="space-y-1 sm:col-span-2 sm:row-start-2">
                              <p>
                                +{c.experience.toLocaleString()} hunting experience ·{" "}
                                {c.preparationSeconds}s preparation
                              </p>
                              <p>
                                {available.remaining} / {c.hunts} hunts · Cooldown after
                                final victory: {c.cooldownSeconds}s
                              </p>
                              {available.cooling && p?.cooldownUntil && (
                                <p>Cooldown until {p.cooldownUntil.toLocaleString()}</p>
                              )}
                              {!eligible && (
                                <p>Requires Hunter occupation and {c.rank}.</p>
                              )}
                            </div>
                            <Button
                              className="sm:col-start-3 sm:row-span-2 sm:row-start-1"
                              disabled={
                                pending ||
                                !eligible ||
                                available.cooling ||
                                !available.remaining ||
                                !!session?.battleId ||
                                user?.status !== "AWAKE" ||
                                session?.contractId === c.id
                              }
                              onClick={() =>
                                accept.mutate({
                                  habitatId: h.id,
                                  contractId: c.id,
                                  version: session?.version ?? null,
                                })
                              }
                            >
                              {session?.contractId === c.id
                                ? "Active contract"
                                : session
                                  ? "Switch contract"
                                  : "Accept contract"}
                            </Button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </>
        )}
      </div>
    </ContentBox>
  );
}
