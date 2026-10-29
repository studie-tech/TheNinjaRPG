"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  CircleHelp,
  Clock3,
  Ellipsis,
  Gift,
  Pause,
  Swords,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  DUNGEON_FLOORS_PER_TIER,
  DUNGEON_INACTIVE_ROUNDS,
  DUNGEON_LOBBY_SECONDS,
  DUNGEON_PARTY_SIZE,
  DUNGEON_RUN_SECONDS,
  DUNGEON_SOLO_PETS,
} from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { PartyRoster } from "@/layout/PartyRoster";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { dungeonRequirements } from "@/libs/dungeon";
import { getRewardArray } from "@/libs/objectives";
import { canUsePet } from "@/libs/pets/progression";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import type { DungeonContent, DungeonRewardReceipt } from "@/validators/dungeon";
import { getSearchValidator } from "@/validators/register";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Show entry requirements, human or companion squads, readiness and completion claims. */
export default function DungeonPage() {
  // Reuse the account's calibrated server clock for deadlines, as other game timers do.
  const { data: user, timeDiff, updateUser, prepareUserUpdate } = useRequiredUserData();
  const router = useRouter();
  const [selectedPets, setSelectedPets] = useState<string[]>([]);
  const collection = api.pets.getCollection.useQuery(undefined, { enabled: !!user });
  const [message, setMessage] = useState("");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [abandonId, setAbandonId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(getSearchValidator({ max: 1 })),
    defaultValues: { username: "", users: [] },
  });
  const selected = useWatch({ control: form.control, name: "users" });
  const available = api.coop.dungeon.getAvailable.useQuery(
    { sector: user?.sector ?? 1 },
    {
      enabled: !!user,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
    },
  );
  const state = api.coop.dungeon.getState.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 3000,
  });
  /** Show expected rejections beside the action and refresh party/account state after a mutation. */
  const refresh = async (response: UserDeltaResponse, revision: number | undefined) => {
    if (response.success || response.userPatch)
      await updateUser(response.userPatch, {
        revision,
        achievementProgress: response.achievementProgress,
      });
    setMessage(response.success ? "" : response.message);
    if (response.success) setAbandonId(null);
    showMutationToast(response);
    await Promise.all([state.refetch(), available.refetch()]);
  };
  const create = api.coop.dungeon.create.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: (response, _variables, revision) => refresh(response, revision),
    onError: (e) => setMessage(e.message),
  });
  const act = api.coop.dungeon.act.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (response, input, revision) => {
      if (response.success && input.action === "invite") form.reset();
      await refresh(response, revision);
    },
    onError: (e) => setMessage(e.message),
  });
  const claim = api.coop.dungeon.claim.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (response, _variables, revision) => {
      if (response.success) setIsHistoryOpen(true);
      await refresh(response, revision);
    },
    onError: (e) => setMessage(e.message),
  });
  const runs = state.data?.runs ?? [];
  const current = runs.find(
    (r) =>
      r.state.memberIds.includes(user?.userId ?? "") &&
      !["ENDED", "COMPLETED"].includes(r.status),
  );
  const battleId = current?.status === "FIGHTING" ? current.battleId : null;
  useEffect(() => {
    if (battleId) pushToCombat(router, battleId);
  }, [battleId, router]);
  const pending = create.isPending || act.isPending || claim.isPending;
  /** Send a party command; the shared mutation callbacks display failures and refresh run state. */
  const action = (
    id: string,
    action: Parameters<typeof act.mutate>[0]["action"],
    userId?: string,
  ) => act.mutate({ id, action, userId });
  if (state.error)
    return (
      <ContentBox title="Dungeon Pyramids" defaultBackHref="/travel">
        <p role="alert">{state.error.message}</p>
        <Button onClick={() => void state.refetch()}>Retry</Button>
      </ContentBox>
    );
  if (!user || state.isPending) return <Loader explanation="Loading dungeon parties" />;
  const completed = runs.filter(
    (run) => run.status === "COMPLETED" && run.state.memberIds.includes(user.userId),
  );
  /** State includes only the viewer's persisted receipts; other members claim independently. */
  const receiptFor = (id: string) =>
    state.data?.members.find((member) => member.runId === id)?.reward;
  const claimed = completed.filter((run) => receiptFor(run.id));
  const readyCount = current?.state.readyIds.length ?? 0;
  const isReady = current?.state.readyIds.includes(user.userId) ?? false;
  const allReady =
    current?.state.memberIds.length ===
      (current?.state.pets ? 1 : DUNGEON_PARTY_SIZE) &&
    current.state.memberIds.every((id) => current.state.readyIds.includes(id));
  const endingRun = runs.find((run) => run.id === abandonId);
  return (
    <ContentBox
      title="Dungeon Pyramids"
      subtitle="Player parties and solo companion squads"
      defaultBackHref="/travel"
    >
      <div className="mb-4 flex items-center gap-3 text-muted-foreground text-sm">
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4" aria-hidden="true" />
          {DUNGEON_PARTY_SIZE} players or solo with {DUNGEON_SOLO_PETS} pets
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          {DUNGEON_RUN_SECONDS / 60} min run
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              aria-label="Dungeon rules"
            >
              <CircleHelp className="mr-1.5 h-4 w-4" />
              Rules
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="space-y-2 text-sm">
            <p className="font-semibold">Dungeon rules</p>
            <p>
              Enter with {DUNGEON_PARTY_SIZE} ready players or solo with{" "}
              {DUNGEON_SOLO_PETS} battle-ready pets. Lobbies expire after{" "}
              {DUNGEON_LOBBY_SECONDS / 60} minutes. The {DUNGEON_RUN_SECONDS / 60}
              -minute timer starts on the first floor and keeps running while paused.
            </p>
            <p>
              Each floor fully restores the party. Fleeing is disabled;{" "}
              {DUNGEON_INACTIVE_ROUNDS} inactive rounds end the run.
            </p>
            <p>Completion rewards are claimed separately by each player.</p>
          </PopoverContent>
        </Popover>
      </div>
      {message && !abandonId && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          {message}
        </p>
      )}
      <div className="space-y-4">
        {runs
          .filter(
            (run) =>
              run.status === "LOBBY" && run.state.invitedIds.includes(user.userId),
          )
          .map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{run.content.name}</p>
                <p className="text-muted-foreground text-sm">
                  Invitation from{" "}
                  {state.data?.users.find((u) => u.userId === run.leaderId)?.username}
                </p>
              </div>
              <Button disabled={pending} onClick={() => action(run.id, "accept")}>
                Accept invitation
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => action(run.id, "decline")}
              >
                Decline
              </Button>
            </div>
          ))}
        {completed
          .filter((run) => !receiptFor(run.id))
          .map((run) => (
            <div
              key={run.id}
              className="rounded-lg border border-primary/30 bg-primary/5 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{run.content.name}</h2>
                  <p className="flex items-center gap-1.5 text-primary text-sm">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    All {run.state.clearedFloors.length} floors cleared
                  </p>
                </div>
                <Button disabled={pending} onClick={() => claim.mutate({ id: run.id })}>
                  Claim completion rewards
                </Button>
              </div>
              <DungeonRewards rewards={run.content.rewards} />
            </div>
          ))}
        {current && (
          <div className="space-y-4 rounded-lg border bg-popover p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-lg">{current.content.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">
                    {current.status === "BETWEEN"
                      ? "Between floors"
                      : capitalizeFirstLetter(current.status.toLowerCase())}
                  </Badge>
                  <span className="text-muted-foreground">
                    Tier {Math.floor(current.state.floor / DUNGEON_FLOORS_PER_TIER) + 1}{" "}
                    · Floor {(current.state.floor % DUNGEON_FLOORS_PER_TIER) + 1}
                  </span>
                </div>
              </div>
              <Popover open={isOptionsOpen} onOpenChange={setIsOptionsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Party options"
                    hoverText="Party options"
                  >
                    <Ellipsis className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 space-y-1 p-2">
                  {current.leaderId === user.userId && current.status === "BETWEEN" && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      disabled={pending}
                      onClick={() => {
                        setIsOptionsOpen(false);
                        action(current.id, "pause");
                      }}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Pause dungeon
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-destructive"
                    disabled={pending || current.status === "FIGHTING"}
                    onClick={() => {
                      setIsOptionsOpen(false);
                      setMessage("");
                      setAbandonId(current.id);
                    }}
                  >
                    {current.status === "LOBBY" ? "Leave lobby" : "Abandon dungeon"}
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
                <span>
                  {current.state.clearedFloors.length}/
                  {current.content.tiers.length * DUNGEON_FLOORS_PER_TIER} floors
                  cleared
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {current.expiresAt ? (
                    <Countdown
                      targetDate={current.expiresAt}
                      timeDiff={timeDiff}
                      onFinish={() => void state.refetch()}
                    />
                  ) : (
                    "Timer starts on entry"
                  )}
                </span>
              </div>
              <Progress
                aria-label="Dungeon progress"
                value={
                  (current.state.clearedFloors.length /
                    (current.content.tiers.length * DUNGEON_FLOORS_PER_TIER)) *
                  100
                }
              />
            </div>
            <PartyRoster
              capacity={current.state.pets ? 1 : DUNGEON_PARTY_SIZE}
              members={current.state.memberIds.map((id) => ({
                userId: id,
                username:
                  state.data?.users.find((u) => u.userId === id)?.username ?? id,
                isReady: current.state.readyIds.includes(id),
                details: current.state.readyIds.includes(id) ? "Ready" : "Not ready",
              }))}
              leaderId={current.leaderId}
              viewerId={user.userId}
              disabled={pending}
              onRemove={
                current.status === "LOBBY"
                  ? (id) => action(current.id, "remove", id)
                  : undefined
              }
            />
            {current.state.pets && (
              <ul aria-label="Dungeon companions" className="grid gap-2 sm:grid-cols-2">
                {current.state.pets.map((pet) => (
                  <li
                    key={pet.id}
                    className="min-w-0 rounded-lg border bg-background/50 p-3 text-sm"
                  >
                    <Link
                      href="/pets"
                      className="block truncate font-medium"
                      title={pet.name}
                    >
                      {pet.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Battle companion · Ready
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <DungeonRequirements content={current.content} />
            {current.state.invitedIds.length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {current.state.invitedIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-muted-foreground"
                  >
                    {state.data?.users.find((u) => u.userId === id)?.username} · Invited
                    {current.leaderId === user.userId && current.status === "LOBBY" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => action(current.id, "remove", id)}
                      >
                        Cancel invitation
                      </Button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {current.status === "LOBBY" &&
              !current.state.pets &&
              current.leaderId === user.userId &&
              current.state.memberIds.length + current.state.invitedIds.length <
                DUNGEON_PARTY_SIZE && (
                <div className="flex items-end gap-2">
                  <UserSearchSelect
                    useFormMethods={form}
                    showYourself={false}
                    showAi={false}
                    maxUsers={1}
                  />
                  <Button
                    variant="secondary"
                    disabled={pending || !selected[0]}
                    onClick={() => {
                      const target = selected[0];
                      if (target) action(current.id, "invite", target.userId);
                    }}
                  >
                    Invite
                  </Button>
                </div>
              )}
            <p className="text-muted-foreground text-sm">{current.state.message}</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <span className="text-muted-foreground text-xs">
                {current.status === "PAUSED"
                  ? "The timer continues while paused."
                  : `${readyCount}/${current.state.pets ? 1 : DUNGEON_PARTY_SIZE} ready`}
              </span>
              <div className="flex gap-2">
                {["LOBBY", "BETWEEN"].includes(current.status) && (
                  <Button
                    variant={isReady ? "secondary" : "default"}
                    disabled={pending}
                    onClick={() => action(current.id, isReady ? "unready" : "ready")}
                  >
                    {isReady ? "Undo ready" : "Ready"}
                  </Button>
                )}
                {current.leaderId === user.userId &&
                  ["LOBBY", "BETWEEN"].includes(current.status) && (
                    <Button
                      variant={allReady ? "default" : "secondary"}
                      disabled={pending || !allReady}
                      onClick={() => action(current.id, "start")}
                    >
                      <Swords className="mr-2 h-4 w-4" aria-hidden="true" />
                      Enter next floor
                    </Button>
                  )}
                {current.leaderId === user.userId && current.status === "PAUSED" && (
                  <Button
                    disabled={pending}
                    onClick={() => action(current.id, "resume")}
                  >
                    Resume and ready up
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        {!current &&
          runs
            .slice(0, 1)
            .filter((run) => run.status === "ENDED")
            .map((run) => (
              <p
                key={run.id}
                role="status"
                className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-sm"
              >
                {run.content.name}: {run.state.message}
              </p>
            ))}
        {/* Entrance lookups must not block party controls or completion claims. */}
        {!current && (
          <div className="space-y-3">
            <fieldset className="min-w-0 space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">
                Solo squad companions ({selectedPets.length}/{DUNGEON_SOLO_PETS})
              </legend>
              {collection.error ? (
                <p role="alert">
                  {collection.error.message}{" "}
                  <Button onClick={() => void collection.refetch()}>
                    Retry companions
                  </Button>
                </p>
              ) : collection.isPending ? (
                <Loader explanation="Loading companions" />
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Choose {DUNGEON_SOLO_PETS} fully generated, battle-ready companions
                    who are not on a task.{" "}
                    <Link href="/pets" className="text-primary underline">
                      Manage companions
                    </Link>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {collection.data?.pets
                      .filter(
                        (pet) =>
                          pet.generationStatus === "READY" &&
                          pet.species &&
                          canUsePet(pet, user) &&
                          user.petTask?.petId !== pet.id,
                      )
                      .map((pet) => (
                        <label
                          key={pet.id}
                          className="flex min-w-0 max-w-full items-center gap-2 rounded border px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={selectedPets.includes(pet.id)}
                            disabled={
                              pending ||
                              (!selectedPets.includes(pet.id) &&
                                selectedPets.length >= DUNGEON_SOLO_PETS)
                            }
                            onChange={(event) =>
                              setSelectedPets((ids) =>
                                event.target.checked
                                  ? [...ids, pet.id]
                                  : ids.filter((id) => id !== pet.id),
                              )
                            }
                          />
                          <span className="truncate" title={pet.name}>
                            {pet.name}
                          </span>
                        </label>
                      ))}
                  </div>
                </>
              )}
            </fieldset>
            <h2 className="font-semibold">Dungeons in your sector</h2>
            {available.error ? (
              <p role="alert">
                {available.error.message}{" "}
                <Button onClick={() => void available.refetch()}>Retry</Button>
              </p>
            ) : available.isPending ? (
              <Loader explanation="Loading dungeon entrances" />
            ) : available.data?.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No dungeon entrances are available here.{" "}
                <Link href="/travel" className="text-primary hover:underline">
                  Explore another sector.
                </Link>
              </p>
            ) : (
              available.data?.map((dungeon) => (
                <div
                  key={dungeon.id}
                  className="space-y-3 rounded-lg border bg-popover p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{dungeon.content.name}</h3>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {dungeon.content.tiers.length} tiers ·{" "}
                        {dungeon.content.tiers.length * DUNGEON_FLOORS_PER_TIER} floors
                      </p>
                    </div>
                    <Button
                      disabled={pending || !!dungeon.admission.error}
                      onClick={() => create.mutate({ id: dungeon.id })}
                    >
                      Create lobby
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={
                        pending ||
                        !!dungeon.admission.error ||
                        selectedPets.length !== DUNGEON_SOLO_PETS
                      }
                      onClick={() =>
                        create.mutate({ id: dungeon.id, petIds: selectedPets })
                      }
                    >
                      Enter solo with pets
                    </Button>
                  </div>
                  <DungeonRequirements content={dungeon.content} />
                  <p className="text-xs text-muted-foreground">
                    {dungeon.admission.attempts.length} lifetime attempts ·{" "}
                    {dungeon.admission.completions.length} collected completions
                  </p>
                  {dungeon.admission.error && (
                    <p role="status" className="text-sm text-destructive">
                      {dungeon.admission.error}
                    </p>
                  )}
                  <DungeonRewards rewards={dungeon.content.rewards} />
                  {dungeon.content.description && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        About this dungeon
                      </summary>
                      <p className="pt-2">{dungeon.content.description}</p>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {claimed.length > 0 && (
          <details
            open={isHistoryOpen}
            onToggle={(event) => setIsHistoryOpen(event.currentTarget.open)}
            className="rounded-lg border text-sm"
          >
            <summary className="cursor-pointer p-3 font-medium">
              Completed runs ({claimed.length})
            </summary>
            <div className="max-h-64 divide-y overflow-y-auto px-3 pb-3">
              {claimed.map((run) => {
                const receipt = receiptFor(run.id);
                return (
                  <div key={run.id} className="space-y-1 py-3">
                    <p className="font-medium">{run.content.name}</p>
                    <p
                      role="status"
                      className="flex items-center gap-1.5 text-muted-foreground text-xs"
                    >
                      <CheckCircle2
                        className="h-3.5 w-3.5 text-primary"
                        aria-hidden="true"
                      />
                      Rewards delivered · {receipt?.items.length} item drops ·{" "}
                      {receipt?.jutsus.length} jutsu drops
                    </p>
                    <DungeonRewards rewards={run.content.rewards} receipt={receipt} />
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
      <Modal
        title={
          endingRun?.status === "LOBBY" ? "Leave this lobby?" : "Abandon this dungeon?"
        }
        isOpen={!!abandonId}
        setIsOpen={(open) => {
          if (!open) setAbandonId(null);
        }}
        proceed_label={
          endingRun?.status === "LOBBY" ? "Leave lobby" : "Abandon dungeon"
        }
        isLoading={pending}
        keepOpenOnAccept
        onAccept={() => {
          if (abandonId) action(abandonId, "leave");
        }}
      >
        <p>
          {endingRun?.status === "LOBBY"
            ? endingRun.leaderId === user.userId
              ? "Leaving cancels this lobby. You can create or join another lobby."
              : "Your spot becomes available. The other members can continue forming their party."
            : "This ends the run for the whole party. Unfinished runs grant no completion rewards."}
        </p>
        {message && (
          <p role="alert" className="text-destructive">
            {message}
          </p>
        )}
      </Modal>
    </ContentBox>
  );
}

/**
 * Show the saved reward roll in completion history, including package-only reward types.
 * Delivered item IDs become guaranteed unit drops for the shared preview formatter.
 * Discovery, claim cards and older receipts retain the configured reward summary.
 */
const DungeonRewards = ({
  rewards,
  receipt,
}: {
  rewards: DungeonContent["rewards"];
  receipt?: DungeonRewardReceipt | null;
}) => {
  if (receipt?.rewards)
    return (
      <section
        className="text-muted-foreground text-xs"
        aria-label="Completion reward roll"
      >
        {getRewardArray({
          ...receipt.rewards,
          reward_items: receipt.rewards.reward_items.map((id) => ({
            ids: [id],
            number: 100,
            quantity: 1,
          })),
        }).join(", ") || "No completion rewards"}
      </section>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      <Gift className="h-3.5 w-3.5" aria-label="Completion rewards" />
      {rewards.money > 0 && <span>{rewards.money.toLocaleString()} Ryo</span>}
      {rewards.experience > 0 && <span>{rewards.experience.toLocaleString()} Exp</span>}
      {rewards.tokens > 0 && <span>{rewards.tokens.toLocaleString()} tokens</span>}
      {rewards.prestige > 0 && (
        <span>{rewards.prestige.toLocaleString()} prestige</span>
      )}
      {rewards.drops.length > 0 && <span>{rewards.drops.length} possible drops</span>}
      {!rewards.money &&
        !rewards.experience &&
        !rewards.tokens &&
        !rewards.prestige &&
        rewards.drops.length === 0 && <span>No completion rewards</span>}
    </div>
  );
};

/** Display immutable requirements at the entrance and throughout the reserved run. */
const DungeonRequirements = ({ content }: { content: DungeonContent }) => {
  const r = dungeonRequirements(content);
  return (
    <section
      aria-label="Dungeon entry requirements"
      className="space-y-1 text-xs text-muted-foreground"
    >
      <p>
        Every player: level {r.requiredLevel}
        {r.prerequisiteQuestId
          ? ` · Complete ${r.prerequisiteQuestName ?? r.prerequisiteQuestId}`
          : ""}
      </p>
      {r.requiredItemId && (
        <p>
          {r.requiredItemQuantity} × {r.requiredItemName ?? r.requiredItemId} per
          player, consumed on first-floor entry.
        </p>
      )}
      <p>
        Attempts: {r.maxAttempts ?? "unlimited"} lifetime
        {r.attemptDelay !== "none" ? ` · One per ${r.attemptDelay} period` : ""}.
        Completions: {r.maxCompletes ?? "unlimited"}
        {r.retryDelay === "none" ? " lifetime" : ` per ${r.retryDelay} period`}.
      </p>
    </section>
  );
};
