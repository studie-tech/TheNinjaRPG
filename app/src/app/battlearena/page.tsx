"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendGTMEvent } from "@next/third-parties/google";
import { Bot, Info, Sun, Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  BATTLE_ARENA_DAILY_LIMIT,
  IMG_AVATAR_DEFAULT,
  TUTORIAL_ARENA_DUMMY_ID,
} from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useLocalStorage } from "@/hooks/localstorage";
import { useSleepToggle } from "@/hooks/sleep";
import { useTutorialStep } from "@/hooks/tutorial";
import BanInfo from "@/layout/BanInfo";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import { RankedArenaMain, RankedLoadoutSelector } from "@/layout/PvpRank";
import QuestPicker from "@/layout/QuestPicker";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData, useRequireInVillage } from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";
import { createStatSchema } from "@/validators/combat";
import { getSearchValidator } from "@/validators/register";

export default function Arena() {
  // Tab selection
  const availableTabs = [
    "Arena",
    "Sparring",
    "Training",
    "PVP Rank",
    "Battle Pyramid",
  ] as const;
  type TabType = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<TabType | null>("arenaTab", "Arena", true);

  const [aiId, setAiId] = useLocalStorage<string | undefined>(
    "arenaAI4",
    TUTORIAL_ARENA_DUMMY_ID,
  );
  const [statDistribution, setStatDistribution] = useLocalStorage<
    StatSchemaType | undefined
  >("statDistribution", undefined);

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // Tutorial step
  const { currentStep } = useTutorialStep();

  // If we're on "Start arena match", set tab to arena & set to current AI id
  useEffect(() => {
    if (
      currentStep?.title === "Start Arena Match" &&
      (aiId !== TUTORIAL_ARENA_DUMMY_ID || tab !== "Arena")
    ) {
      setTab("Arena");
      setAiId(TUTORIAL_ARENA_DUMMY_ID);
    }
  }, [currentStep, aiId, tab]);

  // Guards
  if (!access) return <Loader explanation="Accessing Battle Arena" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData?.isBanned) return <BanInfo />;

  // Derived values
  const title = tab ?? "";
  let subtitle = "";
  switch (tab) {
    case "Arena":
      subtitle = "Test your skills against opponents at your level";
      break;
    case "Sparring":
      subtitle = "PVP Challenges";
      break;
    case "Training":
      subtitle = "Training Dummy";
      break;
    case "PVP Rank":
      subtitle = "Ranked PVP";
      break;
    case "Battle Pyramid":
      subtitle = "Climb the Battle Pyramid";
      break;
  }

  return (
    <>
      <ContentBox
        title={title}
        subtitle={subtitle}
        defaultBackHref="/village"
        padding={tab === "Arena"}
        topRightContent={
          <Select
            value={tab || "Arena"}
            onValueChange={(value) => setTab(value as TabType)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select arena type" />
            </SelectTrigger>
            <SelectContent>
              {availableTabs.map((option, i) => (
                <SelectItem key={`${option}-${i}`} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {tab === "Arena" && (
          <ArenaChallenge key="challenge-ai" aiId={aiId} setAiId={setAiId} />
        )}
        {tab === "Sparring" && <ChallengeUser key="challenge-user" />}
        {tab === "PVP Rank" && <RankedArenaMain key="ranked-arena" />}
        {tab === "Training" && (
          <div key="training-info" className="flex flex-col items-center">
            <p className="m-2">
              The arena is a fairly basic circular and raw battleground, where you can
              train your skills as a ninja. Opponent is an invicible training dummy who
              will self destruct. Test and hone your skills for future battles.
            </p>
          </div>
        )}
        {tab === "Battle Pyramid" && <BattlePyramid key="battle-pyramid" />}
      </ContentBox>
      {tab === "Sparring" && <ActiveChallenges key="active-challenges" />}
      {tab === "Training" && (
        <AssignTrainingDummyStats
          key="training-stats"
          statDistribution={statDistribution}
          setStatDistribution={setStatDistribution}
        />
      )}
      {tab === "PVP Rank" && <RankedLoadoutSelector key="ranked-loadout" />}
      {tab === "Battle Pyramid" && (
        <QuestPicker
          key="quest-picker"
          questType="battlepyramid"
          title="Battle Pyramids"
          subtitle="Select a tower to start"
          unavailableText="No current battle pyramid quests available"
          initialBreak={true}
        />
      )}
    </>
  );
}

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
  const { currentStep, handleNextStep } = useTutorialStep();

  // Sleep toggle
  const { toggleSleep, isTogglingSleep } = useSleepToggle();

  // Auto combat preference
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();

  // Queries
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined);

  // Sorted by proximity to the user's level, so relevant opponents come first
  const sortedAis = useMemo(
    () =>
      aiData
        ?.filter((ai) => !ai.isSummon && ai.inArena)
        .sort((a, b) => {
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
      onSuccess: async (result) => {
        if (result.success && result.battleId) {
          await updateUser({
            status: "BATTLE",
            battleId: result.battleId,
            updatedAt: new Date(),
          });
          router.push("/combat");
          sendGTMEvent({ event: "enter_arena" });
          if (currentStep?.title === "Start Arena Match") {
            handleNextStep();
          }
        } else {
          showMutationToast(result);
        }
      },
    });

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

      {/* OPPONENT PICKER */}
      {canDoArena && (
        <div>
          <div className="mb-2 flex flex-row items-end justify-between">
            <p className="font-semibold">Choose your opponent</p>
            <p className="text-muted-foreground text-xs">Sorted by level match</p>
          </div>
          <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-lg border bg-popover/30 p-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
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
                  <OpponentInfoButton aiId={opponent.userId} alwaysShow={isSelected} />
                </div>
              );
            })}
            {!sortedAis && <Loader explanation="Loading opponents" />}
          </div>
        </div>
      )}

      {/* BATTLE OPTIONS */}
      {canDoArena && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="font-semibold text-[10px] text-muted-foreground uppercase">
            Battle setup
          </p>
          <div className="flex flex-row gap-3">
            <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
            <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="flex items-center gap-2 font-semibold text-sm">
                <Bot className="h-4 w-4" /> Auto combat
              </p>
              <p className="text-muted-foreground text-xs">
                Your{" "}
                <Link href="/profile/edit" className="underline hover:text-orange-500">
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
        </div>
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

      {/* WAKE UP / ENTER CTA */}
      {isAsleep && canDoArena && (
        <div className="flex flex-col items-center p-3">
          {isTogglingSleep ? (
            <Loader explanation="Waking up..." />
          ) : (
            <Button
              size="xl"
              decoration="gold"
              animation="pulse"
              className="text-2xl italic"
              onClick={() => toggleSleep()}
            >
              <Sun className="mr-4 h-10 w-10" />
              Wake up!
            </Button>
          )}
        </div>
      )}
      {!isAttacking && canDoArena && !isAsleep && (
        <div className="flex flex-col items-center gap-2 p-3">
          <Button
            id="tutorial-battlearena-challenge-ai-enter"
            size="xl"
            decoration="gold"
            animation="pulse"
            className="text-2xl italic"
            onClick={() => aiId && attack({ aiId, autoCombat })}
          >
            <Swords className="mr-4 h-10 w-10" />
            Enter arena
          </Button>
          {autoCombat && (
            <p className="text-muted-foreground text-xs">
              <Bot className="mr-1 inline h-3 w-3" />
              Auto combat is on — your AI profile will fight this battle
            </p>
          )}
        </div>
      )}
      {isAttacking && (
        <div className="min-h-64">
          <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
            <div className="m-auto text-white">
              <p className="text-5xl">Entering the Arena</p>
              <Loader />
            </div>
          </div>
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

const ChallengeUser: React.FC = () => {
  // Data from database
  const { data: userData } = useRequiredUserData();

  // User search
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Ranked rules toggle
  const [useRankedRules, setUseRankedRules] = useState(false);

  // Spectate toggle
  const [spectatable, setSpectatable] = useState(false);

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: create, isPending } = api.sparring.createChallenge.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        userSearchMethods.setValue("users", []);
        await utils.sparring.getUserChallenges.invalidate();
      }
    },
  });

  // If loading
  if (isPending) return <Loader explanation="Loading" />;
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Render
  return (
    <div>
      <p className="p-2">
        You can directly challenge ninja from across the continent to spar against you
        with no consequence to your alliances or village.
      </p>
      <div className="flex flex-row gap-3 p-2">
        <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
        <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
      </div>
      <div className="mb-5 p-2">
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          selectedUsers={[]}
          showYourself={false}
          inline={true}
          showAi={false}
          maxUsers={maxUsers}
        />
        <div className="mt-2 mb-2 flex items-center space-x-2">
          <Checkbox
            id="useRankedRules"
            checked={useRankedRules}
            onCheckedChange={(checked) => setUseRankedRules(checked === true)}
          />
          <label htmlFor="useRankedRules" className="text-sm">
            Use ranked rules (ranked loadouts, level 100 stats, no LP rewards)
          </label>
        </div>
        <div className="mt-2 mb-2 flex items-center space-x-2">
          <Checkbox
            id="spectatable"
            checked={spectatable}
            onCheckedChange={(checked) => setSpectatable(checked === true)}
          />
          <label htmlFor="spectatable" className="text-sm">
            Allow spectators to watch this spar
          </label>
        </div>
        {targetUser && (
          <Button
            id="challenge"
            className="mt-2 w-full"
            onClick={() =>
              create({
                targetId: targetUser.userId,
                useRankedRules,
                spectatable,
              })
            }
          >
            <Swords className="mr-2 h-5 w-5" />
            Challenge Now!
          </Button>
        )}
      </div>
    </div>
  );
};

const ActiveChallenges: React.FC = () => {
  // Data from database
  const { data: userData, updateUser } = useRequiredUserData();

  // Queries
  const { data: challenges } = api.sparring.getUserChallenges.useQuery(undefined, {
    staleTime: 5000,
    enabled: !!userData,
  });

  // tRPC utility
  const utils = api.useUtils();

  // Router for forwarding
  const router = useRouter();

  // Mutations
  const { mutate: accept, isPending: isAccepting } =
    api.sparring.acceptChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.battleId) {
          await updateUser({
            status: "BATTLE",
            battleId: data.battleId,
            updatedAt: new Date(),
          });
          await utils.sparring.getUserChallenges.invalidate();
          router.push("/combat");
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.sparring.rejectChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.sparring.getUserChallenges.invalidate();
        }
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.sparring.cancelChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.sparring.getUserChallenges.invalidate();
        }
      },
    });

  // If loading
  if (!userData) return null;

  // Render
  return (
    challenges &&
    challenges.length > 0 && (
      <ContentBox
        title="Active Challenges"
        subtitle="Sent to or from you"
        initialBreak={true}
        padding={false}
      >
        <UserRequestSystem
          isLoading={isAccepting || isRejecting || isCancelling}
          requests={challenges}
          userId={userData.userId}
          onAccept={accept}
          onReject={reject}
          onCancel={cancel}
        />
      </ContentBox>
    )
  );
};

interface AssignTrainingDummyStatsProps {
  statDistribution: StatSchemaType | undefined;
  setStatDistribution: (newValue: StatSchemaType | undefined) => void;
}

const AssignTrainingDummyStats: React.FC<AssignTrainingDummyStatsProps> = (props) => {
  // Destructure
  const { statDistribution, setStatDistribution } = props;
  // Data from database
  const { data: userData, updateUser } = useRequiredUserData();
  // Seeded Training Dummy Id
  const aiId = "tra93opw09262024jut5ufa8f";
  // Router for forwarding
  const router = useRouter();

  // Sleep toggle
  const { toggleSleep, isTogglingSleep } = useSleepToggle();

  // Auto combat preference
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();

  // Mutation for starting a fight
  const { mutate: attack, isPending: isAttacking } =
    api.combat.startArenaBattle.useMutation({
      onSuccess: async (data) => {
        if (data.success && data.battleId) {
          await updateUser({
            status: "BATTLE",
            battleId: data.battleId,
            updatedAt: new Date(),
          });
          router.push("/combat");
          showMutationToast({ ...data, message: "Entering the Training" });
        } else {
          showMutationToast(data);
        }
      },
    });

  // Stats Schema
  const { schema: statSchema, maxValues } = createStatSchema(10, 10, undefined);
  const defaultValues = statSchema.parse(statDistribution ?? {});
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<z.input<typeof statSchema>, unknown, StatSchemaType>({
    defaultValues: defaultValues as z.input<typeof statSchema>,
    mode: "all",
    resolver: zodResolver(statSchema),
  });

  // Submit handler
  const onSubmit = form.handleSubmit((data) => {
    setStatDistribution(data);
    attack({ aiId: aiId, stats: data, autoCombat });
  });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const isAsleep = userData.status === "ASLEEP";

  // Show component
  return (
    <ContentBox title="Assign Dummy stats" subtitle="" initialBreak={true}>
      <Form {...form}>
        <form className="grid grid-cols-2 gap-2" onSubmit={onSubmit}>
          {statNames
            .filter((x) => !x.includes("Offence"))
            .map((stat, i) => {
              const maxValue = maxValues[stat];
              if (maxValue && maxValue > 0) {
                return (
                  <FormField
                    key={`${stat}-${i}`}
                    control={form.control}
                    name={stat}
                    render={({ field }) => (
                      <FormItem className="pt-1">
                        <FormLabel>{stat}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={stat}
                            {...field}
                            value={field.value as number}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                );
              } else {
                return (
                  <FormItem className="pt-1" key={`${stat}-${i}`}>
                    <FormLabel>{stat}</FormLabel>
                    <FormControl>
                      <div>- Max</div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }
            })}
          <div className="col-span-2 flex flex-row gap-3">
            <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
            <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col">
              <p className="flex items-center gap-2 font-semibold text-sm">
                <Bot className="h-4 w-4" /> Auto combat
              </p>
              <p className="text-muted-foreground text-xs">
                Your AI profile fights for you while you watch the battle live
              </p>
            </div>
            <Switch
              checked={autoCombat}
              onCheckedChange={setAutoCombat}
              aria-label="Toggle auto combat"
            />
          </div>
          {isAsleep ? (
            <div className="col-span-2 flex flex-row justify-center">
              {isTogglingSleep ? (
                <Loader explanation="Waking up..." />
              ) : (
                <Button
                  type="button"
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
          ) : !isAttacking ? (
            <div className="col-span-2 flex flex-row justify-center">
              <Button
                size="xl"
                decoration="gold"
                animation="pulse"
                className="w-full text-2xl italic"
              >
                <Swords className="mr-4 h-10 w-10" />
                Enter arena
              </Button>
            </div>
          ) : (
            <div className="min-h-64">
              <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
                <div className="m-auto text-white">
                  <p className="text-5xl">Entering the Training</p>
                  <Loader />
                </div>
              </div>
            </div>
          )}
        </form>
      </Form>
    </ContentBox>
  );
};

const BattlePyramid: React.FC = () => {
  return (
    <div className="p-3">
      Test your skills against increasingly difficult opponents as you climb battle
      pyramid towers. Each level brings new challenges and greater rewards for those
      brave enough to ascend. You can only climb one tower at a time.
    </div>
  );
};
