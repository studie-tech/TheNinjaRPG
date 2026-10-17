"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HUNTING_RANKS } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { getHuntingRank, getHuntingRankProgress } from "@/libs/hunting";
import { huntingAllowance, huntingEligibility } from "@/libs/hunting/contracts";
import { useUserData } from "@/utils/UserContext";
import type { HuntingReceipt } from "@/validators/hunting";

/** Shared board keeps switching contracts available directly on the combat result screen. */
export function HuntingBoard({
  victory,
  onStarted,
}: {
  victory?: HuntingReceipt;
  onStarted?: (battleId: string) => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const { updateUser } = useUserData();
  const [habitatId, setHabitatId] = useState("");
  const [creature, setCreature] = useState("");
  const [rank, setRank] = useState("");
  const [material, setMaterial] = useState("");
  const [showSelector, setShowSelector] = useState(!victory);
  const selector = useRef<HTMLSelectElement>(null);
  const [message, setMessage] = useState("");
  const board = api.hunting.getBoard.useQuery(undefined, {
    refetchInterval: 5000,
    refetchOnMount: "always",
  });
  const refresh = async (result: { success: boolean; message: string }) => {
    setMessage(result.message);
    if (result.success)
      await Promise.all([board.refetch(), utils.profile.getUser.invalidate()]);
  };
  const accept = api.hunting.accept.useMutation({
    onSuccess: refresh,
    onError: (e) => setMessage(e.message),
  });
  const action = api.hunting.sessionAction.useMutation({
    onSuccess: refresh,
    onError: (e) => setMessage(e.message),
  });
  const start = api.hunting.start.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success && "battleId" in result && result.battleId) {
        await updateUser({
          status: "BATTLE",
          battleId: result.battleId,
          updatedAt: new Date(),
        });
        await Promise.all([
          utils.hunting.getBoard.invalidate(),
          utils.combat.getBattle.invalidate(),
        ]);
        if (onStarted) onStarted(result.battleId);
        else router.push("/combat");
      } else await board.refetch();
    },
    onError: (e) => setMessage(e.message),
  });
  const pending = accept.isPending || action.isPending || start.isPending;
  const data = board.data;
  const session = data?.session;
  const user = data?.user;
  const activeHabitat = data?.habitats.find((h) => h.id === session?.habitatId);
  const active = activeHabitat?.content.contracts.find(
    (c) => c.id === session?.contractId,
  );
  const progress = data?.progress.find((p) => p.contractId === active?.id);
  const allowance = active
    ? huntingAllowance(active, progress, data?.serverTime.getTime())
    : null;
  const now = data?.serverTime.getTime() ?? Date.now();
  const preparing = !!session?.readyAt && session.readyAt.getTime() > now;
  const receipt = session?.lastResult ?? victory;
  const experience = user?.huntingExperience ?? receipt?.totalExperience ?? 0;
  const rankProgress = getHuntingRankProgress(experience);
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
        {user && (
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
        {receipt && <HuntingRewards receipt={receipt} />}
        {session && (
          <div className="space-y-3 rounded border bg-muted/30 p-4">
            <h3 className="font-semibold text-lg">
              {active?.name ?? "Unavailable contract"}
            </h3>
            <p>
              {activeHabitat?.content.name} · Personal encounter in sector{" "}
              <strong>{session.sector}</strong>
            </p>
            <p>
              {session.battleId
                ? "Fighting"
                : allowance?.cooling
                  ? "Contract Cooldown"
                  : !session.readyAt
                    ? "Accepted"
                    : preparing
                      ? `Preparing: ${Math.ceil((session.readyAt.getTime() - now) / 1000)}s remaining`
                      : "Ready to Fight"}
            </p>
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
                Staff changed or disabled this contract. Select a new contract or finish
                this session.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href="/travel">
                <Button variant="secondary">Travel to sector {session.sector}</Button>
              </Link>
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
        {(showSelector || !session) && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                ref={selector}
                aria-label="Habitat filter"
                className="rounded border bg-background p-2"
                value={habitatId}
                onChange={(e) => setHabitatId(e.target.value)}
              >
                <option value="">All habitats</option>
                {data?.habitats.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.content.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Creature filter"
                placeholder="Search creature"
                value={creature}
                onChange={(e) => setCreature(e.target.value)}
              />
              <select
                aria-label="Hunting rank filter"
                className="rounded border bg-background p-2"
                value={rank}
                onChange={(e) => setRank(e.target.value)}
              >
                <option value="">All hunting ranks</option>
                {HUNTING_RANKS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <Input
                aria-label="Material filter"
                placeholder="Search desired material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              />
            </div>
            {!data?.habitats.length && (
              <p className="rounded border p-4">
                No hunting habitats are available yet. Staff are preparing the contract
                board.
              </p>
            )}
            {data?.habitats
              .filter((h) => !habitatId || habitatId === h.id)
              .map((h) => {
                const contracts = h.content.contracts.filter((c) => {
                  const ai = data.creatures.find((a) => a.userId === c.aiId);
                  return (
                    (!rank || c.rank === rank) &&
                    (!creature ||
                      `${ai?.username ?? ""} ${c.name}`
                        .toLowerCase()
                        .includes(creature.toLowerCase())) &&
                    (!material ||
                      c.rewards.some((r) =>
                        data.materials
                          .find((m) => m.id === r.itemId)
                          ?.name.toLowerCase()
                          .includes(material.toLowerCase()),
                      ))
                  );
                });
                return (
                  <section key={h.id} className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-xl">{h.content.name}</h3>
                      <p>{h.content.description}</p>
                      <p className="text-muted-foreground text-sm">
                        Habitat sectors: {h.content.sectors.join(", ")}
                      </p>
                    </div>
                    {!contracts.length && <p>No contracts match these filters.</p>}
                    <div className="grid gap-3 sm:grid-cols-2">
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
                          <article key={c.id} className="space-y-2 rounded border p-4">
                            <h4 className="font-semibold">{c.name}</h4>
                            <p>
                              {ai?.username ?? "Creature unavailable"} · Level{" "}
                              {ai?.level} · {c.rank} · {c.difficulty}
                            </p>
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
                            <Button
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

export function HuntingRewards({ receipt }: { receipt: HuntingReceipt }) {
  return (
    <section className="space-y-1 rounded border p-3" aria-label="Hunting result">
      <h3 className="font-semibold">
        {receipt.outcome === "Won" ? "Victory Settled" : receipt.outcome} ·{" "}
        {receipt.contractName}
      </h3>
      {receipt.outcome === "Won" ? (
        <>
          {receipt.materials.map((m, i) => (
            <p key={`${m.itemId}-${i}`}>
              {m.bonus ? "Bonus" : "Guaranteed"}: {m.quantity}× {m.name}
            </p>
          ))}
          <p>
            +{receipt.experience.toLocaleString()} hunting experience ·{" "}
            {getHuntingRank(receipt.totalExperience)}
          </p>
          <p>{receipt.remaining} successful hunts remaining</p>
          {receipt.cooldownUntil && (
            <p>
              Contract cooldown until {new Date(receipt.cooldownUntil).toLocaleString()}
            </p>
          )}
        </>
      ) : (
        <p>
          No completion rewards. Your hunt allowance and preparation are preserved;
          recover and retry.
        </p>
      )}
    </section>
  );
}
