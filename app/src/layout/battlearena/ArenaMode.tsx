"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { Bot, Info, Loader2, Sun, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { BATTLE_ARENA_DAILY_LIMIT, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useSleepToggle } from "@/hooks/sleep";
import { useTutorialStep } from "@/hooks/tutorial";
import { useStartArenaBattle } from "@/hooks/useStartArenaBattle";
import { BattleSetupPanel } from "@/layout/battlearena/BattleSetupPanel";
import Image from "@/layout/Image";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** The arena: fight an AI opponent picked for your level. */
export function ArenaMode({ aiId, setAiId }: ArenaModeProps) {
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    autoWakeUp: u.autoWakeUp,
    dailyArenaFights: u.dailyArenaFights,
    level: u.level,
    status: u.status,
  }));

  // The tutorial teaches fighting by hand, so its fights never start on auto.
  const { currentStep, completeTutorialAction } = useTutorialStep();
  const isTutorialFight = currentStep?.advanceOn === "arenaStart";

  const { toggleSleep, isTogglingSleep } = useSleepToggle();
  const [autoCombat] = useAutoCombatSetting();

  const { data: aiData } = api.profile.getAllAiNames.useQuery({ arenaOnly: true });

  // Closest to the player's level first
  const level = userData?.level ?? 0;
  const opponents = aiData
    ?.slice()
    .sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level));

  // Select the best match when nothing, or an opponent no longer in the arena, is chosen.
  // The tutorial's dummy is not listed, so its fight keeps the dummy.
  useEffect(() => {
    const best = opponents?.[0];
    if (
      userData &&
      best &&
      !isTutorialFight &&
      !opponents.some((opponent) => opponent.userId === aiId)
    ) {
      setAiId(best.userId);
    }
  }, [userData, opponents, aiId, isTutorialFight]);

  const { start, isAttacking } = useStartArenaBattle((result) => {
    showActionReadinessToast(result);
    sendGTMEvent({ event: "enter_arena" });
    void completeTutorialAction("arenaStart");
  });

  const handleAttack = () => {
    if (aiId) start({ aiId, autoCombat: autoCombat && !isTutorialFight });
  };

  if (!userData) return <Loader explanation="Loading userdata" />;

  const fightsUsed = userData.dailyArenaFights;
  const canDoArena = fightsUsed < BATTLE_ARENA_DAILY_LIMIT;
  const isAsleep = userData.status === "ASLEEP" && userData.autoWakeUp === false;
  const bestMatchId = opponents?.[0]?.userId;
  const selected = opponents?.find((opponent) => opponent.userId === aiId);

  const fightsCounter =
    BATTLE_ARENA_DAILY_LIMIT < 1000 ? (
      <div className="flex flex-col gap-1">
        <Progress
          value={Math.min(100, (fightsUsed / BATTLE_ARENA_DAILY_LIMIT) * 100)}
        />
        <p className="text-muted-foreground text-center text-xs">
          {fightsUsed} / {BATTLE_ARENA_DAILY_LIMIT} daily arena fights used
        </p>
      </div>
    ) : (
      <p className="text-muted-foreground text-center text-xs">
        Fights today: {fightsUsed}
      </p>
    );

  if (!canDoArena) {
    return (
      <div className="flex flex-col items-center gap-2 py-5">
        <h2 className="pb-1 text-4xl italic">Wait till tomorrow</h2>
        <p className="text-muted-foreground text-sm">
          You have used all of your daily arena fights
        </p>
        {fightsCounter}
      </div>
    );
  }

  const action = isAsleep ? (
    isTogglingSleep ? (
      <Loader explanation="Waking" />
    ) : (
      <Button
        size="xl"
        decoration="gold"
        animation="pulse"
        className="w-full text-2xl italic"
        onClick={() => toggleSleep()}
      >
        <Sun className="mr-4 h-10 w-10" />
        Wake up!
      </Button>
    )
  ) : (
    <div className="flex flex-col gap-2">
      <Button
        id="tutorial-battlearena-challenge-ai-enter"
        size="xl"
        decoration="gold"
        animation="pulse"
        className="w-full text-xl italic"
        disabled={isAttacking || !aiId}
        aria-live="polite"
        onClick={handleAttack}
      >
        {isAttacking ? (
          <Loader2 className="mr-3 h-8 w-8 animate-spin" aria-hidden />
        ) : (
          <Swords className="mr-3 h-8 w-8" aria-hidden />
        )}
        <span className="truncate">
          {isAttacking ? "Starting" : `Fight ${selected?.username ?? ""}`.trim()}
        </span>
      </Button>
      {autoCombat && !isTutorialFight && (
        <p className="text-muted-foreground text-center text-xs">
          <Bot className="mr-1 inline h-3 w-3" aria-hidden />
          Auto combat is on: your AI profile fights this battle
        </p>
      )}
      {fightsCounter}
    </div>
  );

  return (
    <fieldset
      disabled={isAttacking}
      aria-busy={isAttacking}
      className="flex min-w-0 flex-col gap-3"
    >
      <section
        aria-label="Choose your opponent"
        className="bg-card flex min-w-0 flex-1 flex-col gap-3 rounded-xl border p-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Choose your opponent</h2>
          <span className="text-muted-foreground text-xs">
            Closest to your level first
          </span>
        </div>
        {selected && (
          <div className="bg-muted/60 flex items-center gap-3 rounded-lg p-2">
            <Image
              alt=""
              src={selected.avatar ?? IMG_AVATAR_DEFAULT}
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-md object-cover"
            />
            <p className="min-w-0 flex-1 text-sm">
              <b>{selected.username}</b> · Level {selected.level}
            </p>
            <OpponentDetails aiId={selected.userId} />
          </div>
        )}
        {/* One scrolling row keeps the battle setup in view below the picker. */}
        <ul
          aria-label="Opponents"
          className="flex snap-x gap-2 overflow-x-auto pt-2 pb-2"
        >
          {opponents?.map((opponent) => {
            const isSelected = opponent.userId === aiId;
            return (
              <li key={opponent.userId} className="w-24 shrink-0 snap-start">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setAiId(opponent.userId)}
                  className={`bg-background hover:bg-popover relative flex w-full flex-col items-center gap-1 rounded-lg border-2 p-2 transition-colors ${
                    isSelected ? "border-amber-500 shadow-md" : "border-transparent"
                  }`}
                >
                  <Image
                    alt={opponent.username}
                    src={opponent.avatar ?? IMG_AVATAR_DEFAULT}
                    width={80}
                    height={80}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <span className="w-full truncate text-center text-xs font-semibold">
                    {opponent.username}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Level {opponent.level}
                  </span>
                  {opponent.userId === bestMatchId && (
                    <Badge className="pointer-events-none absolute -top-1.5 -right-1 px-1 py-0 text-[10px]">
                      Best match
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {!opponents && <Loader explanation="Loading opponents" />}
      </section>
      <BattleSetupPanel autoCombat={!isTutorialFight} action={action} placement="below">
        {isTutorialFight && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Bot className="h-4 w-4 shrink-0" aria-hidden /> Auto combat stays off
            during your academy training, so you learn to fight by hand.
          </p>
        )}
      </BattleSetupPanel>
    </fieldset>
  );
}

/** The selected opponent's stats and jutsu, fetched when opened. */
function OpponentDetails({ aiId }: { aiId: string }) {
  const [open, setOpen] = useState(false);
  const { data: ai, isPending } = api.profile.getAi.useQuery(
    { userId: aiId },
    { enabled: open, staleTime: Number.POSITIVE_INFINITY },
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-11 shrink-0">
          <Info className="mr-2 h-4 w-4" aria-hidden /> Details
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[70vh] w-[500px] max-w-[90vw] overflow-y-auto">
        {isPending && <Loader explanation="Loading opponent" />}
        {!isPending && !ai && (
          <p className="text-muted-foreground p-2 text-center text-sm">
            Could not load this opponent
          </p>
        )}
        {ai && (
          <ItemWithEffects
            item={
              {
                id: ai.userId,
                name: ai.username,
                image: ai.avatar,
                description: "",
                rarity: "COMMON",
                href: `/userid/${ai.userId}`,
                attacks: ai.jutsus.map((jutsu) => jutsu.jutsu.name),
                ...ai,
              } as GenericObject
            }
            showStatistic="ai"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

interface ArenaModeProps {
  aiId: string | undefined;
  setAiId: (newValue: string | undefined) => void;
}
