"use client";

import { ChevronDown, CircleAlert, Gamepad2, Lock, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useQuestStartCacheUpdate } from "@/hooks/useQuestStartCacheUpdate";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import { QuestTeams } from "@/layout/QuestTeams";
import { orderTowers, type TowerState, towerState } from "@/libs/battleArena";
import { getRewardArray } from "@/libs/objectives";
import { questTypeConcurrentBlockMessage } from "@/libs/quest/missionHall";
import { formatQuestEntryCost, getPyramidRunTracker } from "@/libs/questRun";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Battle Pyramid: towers you can climb, what entering costs, the tower you are climbing, and
 * towers you are still working towards.
 */
export function PyramidMode() {
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const { prepareQuestStartUpdate, updateQuestStart } = useQuestStartCacheUpdate();
  const [startError, setStartError] = useState<{
    questId: string;
    message: string;
  } | null>(null);
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false);

  const { data: towers } = api.quests.specificQuests.useQuery(
    { level: userData?.level ?? 0, questType: "battlepyramid" },
    // Owned counts gate the button, and inventory changes elsewhere leave this list cached.
    { enabled: !!userData, refetchOnMount: "always" },
  );
  const { data: upcoming } = api.quests.upcomingQuests.useQuery(
    { questType: "battlepyramid" },
    {
      enabled: !!userData,
      // Level and mastery can change outside quest reward claims.
      staleTime: 0,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  );
  const { data: itemNames } = api.item.getAllNames.useQuery(undefined, {
    enabled: towers?.some((tower) => tower.entryRequirements.length > 0) ?? false,
  });

  const { mutate: startQuest, isPending } = api.quests.startQuest.useMutation({
    onMutate: () => {
      setStartError(null);
      return {
        userRevision: prepareUserUpdate(),
        quests: prepareQuestStartUpdate(),
      };
    },
    onSuccess: async (data, variables, snapshot) => {
      // Failures show above the towers, so only successes get a toast.
      showMutationToast(data.success ? data : { ...data, message: "" });
      if (!data.success) {
        const tower = towers?.find((q) => q.id === variables.questId);
        setStartError({
          questId: variables.questId,
          message:
            tower &&
            userData &&
            data.message === questTypeConcurrentBlockMessage(tower, userData)
              ? "You can only climb one tower at a time. Finish or abandon your current climb first."
              : data.message,
        });
      }
      const profileApplied = await updateUser(data, {
        revision: snapshot?.userRevision,
      });
      await updateQuestStart(data, snapshot.quests, profileApplied);
    },
  });

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!towers) return <Loader explanation="Loading towers" />;

  const activeQuest = userData.userQuests?.find(
    (uq) => !uq.endAt && uq.quest?.questType === "battlepyramid",
  );
  const activeTower = activeQuest
    ? { id: activeQuest.quest.id, name: activeQuest.quest.name }
    : null;
  const activeTracker = activeQuest
    ? getPyramidRunTracker(activeQuest, userData.questData)
    : undefined;
  const ordered = orderTowers(towers, activeTower);
  const itemName = (itemId: string, fallback: string) =>
    itemNames?.find((item) => item.id === itemId)?.name ?? fallback;
  const start = (questId: string) =>
    startQuest({ questId, userSector: userData.sector, supportsAnnouncements: true });

  return (
    <div className="flex flex-col gap-3">
      {startError && (
        <Alert className="border-destructive/30 bg-destructive/5 [&>svg]:text-destructive pr-12">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>
            Couldn&apos;t start{" "}
            {towers.find((tower) => tower.id === startError.questId)?.name ??
              "this tower"}
          </AlertTitle>
          <AlertDescription>
            <p>{startError.message}</p>
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5 h-8 w-8"
            aria-label="Dismiss"
            onClick={() => setStartError(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}
      {isPending && <Loader explanation="Starting climb" />}
      {ordered.length === 0 && !activeQuest && (
        <p className="bg-card rounded-xl border p-3 text-sm">
          No towers are open to you right now.
        </p>
      )}
      <ul aria-label="Towers" className="flex flex-col gap-3">
        {activeQuest && !towers.some((tower) => tower.id === activeTower?.id) && (
          <li>
            <article
              aria-label={activeQuest.quest.name}
              className="bg-card flex flex-col gap-2 rounded-xl border border-amber-500 p-3"
            >
              <TowerHeading
                name={activeQuest.quest.name}
                state={{ kind: "climbing" }}
              />
              {activeTracker && (
                <LogbookEntry
                  userQuest={activeQuest}
                  tracker={activeTracker}
                  hideTitle
                  showScene
                />
              )}
            </article>
          </li>
        )}
        {ordered.map((tower) => {
          const state = towerState(tower, activeTower);
          const rewards = getRewardArray(tower.content.reward);
          const requirements = tower.entryRequirements.map((required) => ({
            ...required,
            name: itemName(required.itemId, required.name),
          }));
          const needsConfirm = requirements.length > 0 || tower.content.isolated;
          // The climbing tower is named in its own card above and in the busy button's title.
          const climbLabel =
            state.kind === "busy"
              ? "Finish current climb"
              : state.kind === "missingItems"
                ? `Missing ${state.missing} ${state.missing === 1 ? "item" : "items"}`
                : "Climb tower";
          const climbButton = (
            <Button
              id={`tutorial-take-quest-${tower.id}`}
              className="@container h-11 w-full @min-[600px]:w-44"
              title={
                state.kind === "busy" ? `Finish ${state.climbing} first` : climbLabel
              }
              disabled={state.kind !== "open" || isPending}
              onClick={needsConfirm ? undefined : () => start(tower.id)}
            >
              {state.kind === "missingItems" ? (
                <Lock className="mr-2 h-5 w-5 shrink-0" aria-hidden />
              ) : (
                <Gamepad2 className="mr-2 h-5 w-5 shrink-0" aria-hidden />
              )}
              <span
                className="min-w-0 truncate"
                style={{ fontSize: climbLabelFontSize(climbLabel) }}
              >
                {climbLabel}
              </span>
            </Button>
          );
          return (
            <li key={tower.id}>
              <article
                aria-label={tower.name}
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-xl border p-3 @min-[600px]:flex-row",
                  state.kind === "climbing" && "border-amber-500",
                )}
              >
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-amber-700 to-amber-950 @min-[600px]:h-28 @min-[600px]:w-28">
                  {tower.image && (
                    <Image
                      alt=""
                      src={tower.image}
                      fill
                      sizes="112px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <TowerHeading name={tower.name} state={state} />
                  {tower.description && (
                    <p className="line-clamp-2 text-sm">{tower.description}</p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Level{" "}
                    <b className="text-foreground">
                      {tower.requiredLevel}–{tower.maxLevel}
                    </b>
                  </p>
                  {state.kind === "climbing" ? (
                    activeQuest &&
                    activeTracker && (
                      <LogbookEntry
                        userQuest={activeQuest}
                        tracker={activeTracker}
                        hideTitle
                        showScene
                      />
                    )
                  ) : (
                    <>
                      {requirements.map((required) => {
                        const isShort = required.owned < required.quantity;
                        return (
                          <p
                            key={required.itemId}
                            className={cn(
                              "rounded-md border border-dashed px-2 py-1.5 text-xs",
                              isShort
                                ? "border-destructive bg-destructive/5 text-destructive"
                                : "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
                            )}
                          >
                            <b>
                              Uses {required.quantity}× {required.name}
                            </b>{" "}
                            · you have {required.owned}
                            <span className="text-muted-foreground block">
                              Used up when you enter, not refunded if you abandon
                            </span>
                          </p>
                        );
                      })}
                      {tower.content.isolated && (
                        <p className="text-muted-foreground text-xs">
                          Isolated run: other activities are blocked until you finish or
                          abandon.
                        </p>
                      )}
                      <QuestTeams
                        questId={tower.id}
                        teamEnabled={tower.teamEnabled}
                        maxPlayers={tower.teamMaxPlayers}
                      />
                    </>
                  )}
                  {rewards.length > 0 ? (
                    <ul aria-label="Rewards" className="flex flex-wrap gap-1.5">
                      {rewards.map((reward) => (
                        <li
                          key={reward}
                          className="bg-muted rounded-md px-2 py-0.5 text-xs font-semibold"
                        >
                          {reward}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-xs">No reward listed</p>
                  )}
                </div>
                {state.kind !== "climbing" && (
                  <div className="flex shrink-0 items-center">
                    {needsConfirm && state.kind === "open" ? (
                      <Confirm
                        title={`Start ${tower.name}?`}
                        triggerClassName="w-full"
                        button={climbButton}
                        onAccept={() => start(tower.id)}
                      >
                        {requirements.length > 0 && (
                          <span className="block">
                            Entering costs{" "}
                            <strong>{formatQuestEntryCost(requirements)}</strong>. The
                            items are consumed when you enter and are not refunded on
                            abandonment. Proceed?
                          </span>
                        )}
                        {tower.content.isolated &&
                          "Outside activities are blocked until this run is completed or abandoned."}
                      </Confirm>
                    ) : (
                      climbButton
                    )}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {upcoming && upcoming.length > 0 && (
        <section aria-label="Coming up section" className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={isUpcomingOpen}
            onClick={() => setIsUpcomingOpen((open) => !open)}
            className="flex min-h-11 items-center justify-between gap-2 text-left @min-[600px]:pointer-events-none"
          >
            <h2 className="text-base font-bold">Coming up · {upcoming.length}</h2>
            <ChevronDown
              aria-hidden
              className={cn(
                "h-5 w-5 transition-transform @min-[600px]:hidden",
                isUpcomingOpen && "rotate-180",
              )}
            />
          </button>
          <ul
            aria-label="Coming up"
            className={cn(
              "grid gap-2 @min-[600px]:grid-cols-2",
              !isUpcomingOpen && "@max-[600px]:hidden",
            )}
          >
            {upcoming.map((tower) => (
              <li
                key={tower.id}
                className="bg-muted/40 flex items-center gap-3 rounded-xl border p-2"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-500 to-slate-800">
                  {tower.image && (
                    <Image
                      alt=""
                      src={tower.image}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {tower.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Level {tower.requiredLevel}–{tower.maxLevel}
                  </p>
                  <p className="text-destructive text-xs">
                    {tower.block.kind === "level"
                      ? `Needs level ${tower.block.required} · you are ${tower.block.current}`
                      : `Needs ${tower.block.required} ${tower.block.label} · you have ${tower.block.current}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TowerHeading({ name, state }: { name: string; state: TowerState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-bold">{name}</h2>
      {state.kind === "climbing" && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Climbing now
        </span>
      )}
      {state.kind === "open" && (
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-900 dark:bg-green-950 dark:text-green-100">
          Open to you
        </span>
      )}
      {state.kind === "missingItems" && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-bold">
          Missing items
        </span>
      )}
    </div>
  );
}

/**
 * Font size that fits a climb label on one line of its fixed-size button: the button's content
 * width minus its icon (1.75rem), shared by the label's characters at about 0.55em each,
 * between 0.625rem and the button's usual 0.875rem so it follows the user's font scale.
 */
export const climbLabelFontSize = (label: string) =>
  `clamp(0.625rem, calc((100cqi - 1.75rem) / ${Number((label.length * 0.55).toFixed(2))}), 0.875rem)`;
