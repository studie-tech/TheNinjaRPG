"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { Bot, Info, Loader2, Sun, Swords } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { BATTLE_ARENA_DAILY_LIMIT, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useSleepToggle } from "@/hooks/sleep";
import { useTutorialStep } from "@/hooks/tutorial";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";

/** The arena: fight an AI opponent picked for your level. */
export const ArenaMode = (props: ArenaChallengeProps) => <ArenaChallenge {...props} />;

interface ArenaChallengeProps {
  aiId: string | undefined;
  setAiId: (newValue: string | undefined) => void;
}

const ArenaChallenge: React.FC<ArenaChallengeProps> = (props) => {
  // Data from database
  const { aiId, setAiId } = props;
  const { data: userData, updateUser } = useRequiredUserData();

  // Router for forwarding
  const router = useRouter();

  // Tutorial step
  const { currentStep, completeTutorialAction } = useTutorialStep();
  // The tutorial teaches fighting by hand, so its fights never start on auto.
  const isTutorialFight = currentStep?.advanceOn === "arenaStart";

  // Sleep toggle
  const { toggleSleep, isTogglingSleep } = useSleepToggle();

  // Auto combat preference
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();
  const attackInFlightRef = useRef(false);

  // Queries
  const { data: aiData } = api.profile.getAllAiNames.useQuery({ arenaOnly: true });

  // Sorted by proximity to the user's level, so relevant opponents come first
  const sortedAis = useMemo(
    () =>
      aiData?.slice().sort((a, b) => {
        if (userData?.level) {
          return (
            Math.abs(a.level - userData.level) - Math.abs(b.level - userData.level)
          );
        }
        return 1;
      }),
    [aiData, userData?.level],
  );

  // Set initially selected AI
  useEffect(() => {
    if (!aiId && userData) {
      const selectedAI = sortedAis?.[0];
      if (selectedAI) {
        setAiId(selectedAI.userId);
      }
    }
  }, [userData, sortedAis, aiId]);

  // Mutation for starting a fight
  const { mutate: attack, isPending: isAttacking } =
    api.combat.startArenaBattle.useMutation({
      onSuccess: (result) => {
        if (result.success && result.battleId) {
          void updateUser({
            status: "BATTLE",
            battleId: result.battleId,
            updatedAt: new Date(),
          });
          pushToCombat(router, result.battleId);
          sendGTMEvent({ event: "enter_arena" });
          void completeTutorialAction("arenaStart");
        } else {
          attackInFlightRef.current = false;
          showMutationToast(result);
        }
      },
      onError: (error) => {
        attackInFlightRef.current = false;
        showMutationToast({ success: false, message: error.message });
      },
    });

  const handleAttack = () => {
    if (attackInFlightRef.current || isAttacking || !aiId) return;
    attackInFlightRef.current = true;
    attack({ aiId, autoCombat: autoCombat && !isTutorialFight });
  };

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const fightsUsed = userData.dailyArenaFights;
  const canDoArena = fightsUsed < BATTLE_ARENA_DAILY_LIMIT;
  const isAsleep = userData.status === "ASLEEP";
  const bestMatchId = sortedAis?.[0]?.userId;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        The arena is a fairly basic circular and raw battleground, where you can train &
        test your skills as a ninja. Opponents are various creatures or ninja deemed to
        be at your level.
      </p>

      {/* Picker on the left, setup and the enter button on the right once the
          centre column is wide enough for two (the village sidebars eat most of
          the width below xl, where a rail would squeeze the grid to a sliver).
          Stacked, the opponent grid alone is tall enough to push the primary
          action below the fold on a short screen — side by side the two are as
          tall as the taller one, so the button stays in view, which the
          tutorial step highlighting it depends on. */}
      {canDoArena && (
        <fieldset
          disabled={isAttacking}
          aria-busy={isAttacking}
          className="flex flex-col gap-4 xl:flex-row xl:items-stretch"
        >
          {/* OPPONENT PICKER — same card shell and heading treatment as the
              setup panel beside it, so the two line up top and bottom instead
              of one starting lower and ending shorter than the other. */}
          <div className="flex flex-col gap-3 rounded-lg border p-3 xl:min-w-0 xl:flex-1">
            <div className="flex flex-row items-baseline justify-between gap-2">
              <p className="font-semibold text-[10px] text-muted-foreground uppercase">
                Choose your opponent
              </p>
              <p className="text-[10px] text-muted-foreground">Sorted by level match</p>
            </div>
            {/* Cap against the window, not just a fixed height: the grid always
                scrolls internally rather than growing the page and pushing
                "Enter arena" out of sight — and side by side, an uncapped grid
                would stretch its card far past the setup panel next to it. The
                opponents fill that cap, so it is also held while they load, keeping
                the setup panel below from dropping when they arrive. */}
            <div
              className={cn(
                "grid max-h-[min(16rem,26vh)] min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto rounded-lg bg-popover/30 p-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-4 2xl:grid-cols-5",
                !sortedAis && "min-h-[min(16rem,26vh)]",
              )}
            >
              {sortedAis?.map((opponent) => {
                const isSelected = opponent.userId === aiId;
                return (
                  <div key={opponent.userId} className="group relative">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setAiId(opponent.userId)}
                      className={`flex w-full flex-col items-center rounded-lg border-2 p-2 transition-colors hover:bg-popover ${
                        isSelected
                          ? "border-amber-500 bg-popover shadow-md"
                          : "border-transparent"
                      }`}
                    >
                      <Image
                        alt={opponent.username}
                        src={opponent.avatar ?? IMG_AVATAR_DEFAULT}
                        width={80}
                        height={80}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                      <p className="w-full truncate text-center font-semibold text-xs">
                        {opponent.username}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Level {opponent.level}
                      </p>
                    </button>
                    {opponent.userId === bestMatchId && (
                      <Badge className="pointer-events-none absolute -top-1 -right-1 px-1 py-0 text-[9px]">
                        Best match
                      </Badge>
                    )}
                    <OpponentInfoButton
                      aiId={opponent.userId}
                      alwaysShow={isSelected}
                    />
                  </div>
                );
              })}
              {!sortedAis && <Loader explanation="Loading opponents" />}
            </div>
          </div>

          {/* BATTLE SETUP + PRIMARY ACTION */}
          <div className="flex flex-col gap-3 rounded-lg border p-3 xl:w-80 xl:shrink-0">
            <p className="font-semibold text-[10px] text-muted-foreground uppercase">
              Battle setup
            </p>
            <div className="flex flex-row gap-3">
              <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
              <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
            </div>
            {isTutorialFight ? (
              <p className="flex items-center gap-2 text-muted-foreground text-xs">
                <Bot className="h-4 w-4 shrink-0" /> Auto combat stays off during your
                academy training, so you learn to fight by hand.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <p className="flex items-center gap-2 font-semibold text-sm">
                    <Bot className="h-4 w-4" /> Auto combat
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Your{" "}
                    <Link
                      href="/profile/edit"
                      className="underline hover:text-orange-500"
                    >
                      AI profile
                    </Link>{" "}
                    fights for you while you watch the battle live. You can take back
                    control at any time.
                  </p>
                </div>
                <Switch
                  checked={autoCombat}
                  onCheckedChange={setAutoCombat}
                  aria-label="Toggle auto combat"
                />
              </div>
            )}

            {/* WAKE UP / ENTER CTA */}
            {isAsleep && (
              <div className="flex flex-col items-center border-t pt-3">
                {isTogglingSleep ? (
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
                )}
              </div>
            )}
            {!isAsleep && (
              <div className="flex flex-col items-center gap-2 border-t pt-3">
                <Button
                  id="tutorial-battlearena-challenge-ai-enter"
                  size="xl"
                  decoration="gold"
                  animation="pulse"
                  className="w-full text-2xl italic"
                  disabled={isAttacking || !aiId}
                  aria-live="polite"
                  onClick={handleAttack}
                >
                  {isAttacking ? (
                    <Loader2 className="mr-4 h-10 w-10 animate-spin" aria-hidden />
                  ) : (
                    <Swords className="mr-4 h-10 w-10" />
                  )}
                  {isAttacking ? "Starting" : "Enter arena"}
                </Button>
                {autoCombat && !isTutorialFight && (
                  <p className="text-center text-muted-foreground text-xs">
                    <Bot className="mr-1 inline h-3 w-3" />
                    Auto combat is on — your AI profile will fight this battle
                  </p>
                )}
              </div>
            )}
          </div>
        </fieldset>
      )}

      {/* DAILY LIMIT REACHED */}
      {!canDoArena && (
        <div className="flex flex-col items-center py-5">
          <h1 className="pb-3 text-5xl italic">Wait till tomorrow</h1>
          <p className="text-muted-foreground text-sm">
            You have used all of your daily arena fights
          </p>
        </div>
      )}

      {/* DAILY FIGHTS PROGRESS (plain counter while the limit is effectively disabled) */}
      <div className="mx-auto flex w-full max-w-xs flex-col gap-1 pb-1">
        {BATTLE_ARENA_DAILY_LIMIT < 1000 ? (
          <>
            <Progress
              value={Math.min(100, (fightsUsed / BATTLE_ARENA_DAILY_LIMIT) * 100)}
            />
            <p className="text-center text-muted-foreground text-xs">
              {fightsUsed} / {BATTLE_ARENA_DAILY_LIMIT} daily arena fights used
            </p>
          </>
        ) : (
          <p className="text-center text-muted-foreground text-xs">
            Arena fights today: {fightsUsed}
          </p>
        )}
      </div>
    </div>
  );
};

interface OpponentInfoButtonProps {
  aiId: string;
  alwaysShow: boolean;
}

const OpponentInfoButton: React.FC<OpponentInfoButtonProps> = (props) => {
  const [open, setOpen] = useState(false);
  // Details are only fetched once the popover is opened
  const { data: ai, isPending } = api.profile.getAi.useQuery(
    { userId: props.aiId },
    { enabled: open, staleTime: Number.POSITIVE_INFINITY },
  );
  // Hidden by default to keep the grid calm: shown on the selected tile, on
  // tile hover (desktop), and while its popover is open. Touch users select a
  // tile first, which reveals its info button — so while it is invisible it
  // must also stop swallowing taps meant for the avatar underneath it.
  const isVisible = props.alwaysShow || open;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Opponent details"
          className={`absolute top-2.5 left-2.5 rounded-full bg-black/40 p-1 text-white/80 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white ${
            isVisible
              ? "opacity-100"
              : "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          }`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[70vh] w-[500px] max-w-[90vw] overflow-y-auto">
        {isPending && <Loader explanation="Loading opponent" />}
        {!isPending && !ai && (
          <p className="p-2 text-center text-muted-foreground text-sm">
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
};
