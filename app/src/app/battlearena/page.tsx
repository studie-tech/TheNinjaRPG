"use client";

import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import NavTabs from "@/layout/NavTabs";
import ItemWithEffects from "@/layout/ItemWithEffects";
import UserSearchSelect from "@/layout/UserSearchSelect";
import BanInfo from "@/layout/BanInfo";
import LoadoutSelector from "@/layout/LoadoutSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getSearchValidator } from "@/validators/register";
import { useRouter } from "next/navigation";
import { useRequiredUserData } from "@/utils/UserContext";
import { useRequireInVillage } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentBox from "@/layout/ContentBox";
import UserRequestSystem from "@/layout/UserRequestSystem";
import Loader from "@/layout/Loader";
import { sendGTMEvent } from "@next/third-parties/google";
import { Swords } from "lucide-react";
import { RankedArenaMain, RankedLoadoutSelector } from "@/layout/PvpRank";
import { BATTLE_ARENA_DAILY_LIMIT } from "@/drizzle/constants";
import { createStatSchema } from "@/libs/combat/types";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { z } from "zod";
import type { GenericObject } from "@/layout/ItemWithEffects";
import type { StatSchemaType } from "@/libs/combat/types";

export default function Arena() {
  // Tab selection
  const availableTabs = ["Arena", "Sparring", "Training", "PVP Rank"] as const;
  type TabType = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<TabType | null>("arenaTab", "Arena", true);

  const [aiId, setAiId] = useLocalStorage<string | undefined>("arenaAI", undefined);
  const [statDistribution, setStatDistribution] = useLocalStorage<
    StatSchemaType | undefined
  >("statDistribution", undefined);

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // Guards
  if (!access) return <Loader explanation="Accessing Battle Arena" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData?.isBanned) return <BanInfo />;

  // Derived values
  const title = tab ?? "";
  let subtitle = "";
  switch (tab) {
    case "Arena":
      subtitle = `Battle Arena Fights Today: ${userData?.dailyArenaFights}`;
      break;
    case "Sparring":
      subtitle = "PVP Challenges";
      break;
    case "Training":
      subtitle = "Training Dummy";
      break;
    case "PVP Rank":
      subtitle = "Ranked PVP (Preview Feature)";
      break;
  }

  return (
    <>
      <ContentBox
        title={title}
        subtitle={subtitle}
        back_href="/village"
        padding={tab === "Arena"}
        topRightContent={
          <NavTabs
            id="arenaSelection"
            current={tab}
            options={availableTabs}
            setValue={setTab}
          />
        }
      >
        {tab === "Arena" && <ChallengeAI aiId={aiId} />}
        {tab === "Sparring" && <ChallengeUser />}
        {tab === "PVP Rank" && <RankedArenaMain />}
        {tab === "Training" && (
          <div className="flex flex-col items-center">
            <p className="m-2">
              The arena is a fairly basic circular and raw battleground, where you can
              train your skills as a ninja. Opponent is an invicible training dummy who
              will self destruct. Test and hone your skills for future battles.
            </p>
          </div>
        )}
      </ContentBox>
      {tab === "Arena" && <SelectAI aiId={aiId} setAiId={setAiId} />}
      {tab === "Sparring" && <ActiveChallenges />}
      {tab === "Training" && (
        <AssignTrainingDummyStats
          statDistribution={statDistribution}
          setStatDistribution={setStatDistribution}
        />
      )}
      {tab === "PVP Rank" && <RankedLoadoutSelector />}
    </>
  );
}

interface SelectAIProps {
  aiId: string | undefined;
  setAiId: (newValue: string | undefined) => void;
}

const SelectAI: React.FC<SelectAIProps> = (props) => {
  // Data from database
  const { aiId, setAiId } = props;
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined);

  const { data: ai } = api.profile.getAi.useQuery(
    { userId: aiId ?? "" },
    { enabled: !!aiId },
  );

  const sortedAis = aiData
    ?.filter((ai) => !ai.isSummon && ai.inArena)
    .sort((a, b) => {
      if (userData?.level) {
        return Math.abs(a.level - userData.level) - Math.abs(b.level - userData.level);
      }
      return 1;
    });

  // Set initially selected AI
  useEffect(() => {
    if (!aiId && userData) {
      const selectedAI = sortedAis?.[0];
      if (selectedAI) {
        setAiId(selectedAI.userId);
      }
    }
  }, [userData, sortedAis, aiId, setAiId]);

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const canDoArena = userData.dailyArenaFights < BATTLE_ARENA_DAILY_LIMIT;

  return (
    <ContentBox
      title="Configure"
      subtitle="Choose opponent and jutsu loadout"
      initialBreak={true}
      topRightContent={<LoadoutSelector size="small" />}
    >
      <div className="flex flex-col items-center">
        {canDoArena && (
          <>
            <div className="rounded-2xl mt-3 w-full">
              <div className="mb-1">
                <Select
                  onValueChange={(e) => setAiId(e)}
                  defaultValue={aiId}
                  value={aiId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`None`} />
                  </SelectTrigger>
                  <SelectContent>
                    {aiData
                      ?.filter((ai) => !ai.isSummon && ai.inArena)
                      .map((ai) => (
                        <SelectItem key={ai.userId} value={ai.userId}>
                          {ai.username} (lvl {ai.level})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
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
                      attacks: ai.jutsus?.map((jutsu) =>
                        "jutsu" in jutsu ? jutsu.jutsu?.name : "Unknown",
                      ),
                      ...ai,
                    } as GenericObject
                  }
                  showStatistic="ai"
                />
              )}
            </div>
          </>
        )}
      </div>
    </ContentBox>
  );
};

interface ChallengeAIProps {
  aiId: string | undefined;
}

const ChallengeAI: React.FC<ChallengeAIProps> = (props) => {
  // Data from database
  const { aiId } = props;
  const { data: userData, updateUser } = useRequiredUserData();

  // Router for forwarding
  const router = useRouter();

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
          showMutationToast({ ...result, message: "Entering the Arena" });
          sendGTMEvent({ event: "enter_arena" });
        } else {
          showMutationToast(result);
        }
      },
    });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const canDoArena = userData.dailyArenaFights < BATTLE_ARENA_DAILY_LIMIT;

  return (
    <div className="flex flex-col items-center">
      The arena is a fairly basic circular and raw battleground, where you can train &
      test your skills as a ninja. Opponents are various creatures or ninja deemed to be
      at your level.
      {!canDoArena && (
        <h1 className="pb-3 pt-5 font-fontasia text-7xl">Wait till tomorrow</h1>
      )}
      {!isAttacking && canDoArena && (
        <div className="p-3">
          <Button
            size="xl"
            decoration="gold"
            animation="pulse"
            className="font-fontasia text-4xl"
            onClick={() => aiId && attack({ aiId })}
          >
            <Swords className="h-10 w-10 mr-4" />
            Enter The Arena
          </Button>
        </div>
      )}
      {isAttacking && (
        <div className="min-h-64">
          <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
            <div className="m-auto text-white">
              <p className="text-5xl">Entering the Arena</p>
              <Loader />
            </div>
          </div>
        </div>
      )}
    </div>
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
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

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
      <div className="p-2 mb-5">
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          selectedUsers={[]}
          showYourself={false}
          inline={true}
          showAi={false}
          maxUsers={maxUsers}
        />
        {targetUser && (
          <Button
            id="challenge"
            className="mt-2 w-full"
            onClick={() => create({ targetId: targetUser.userId })}
          >
            <Swords className="h-5 w-5 mr-2" />
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
  const statSchema = createStatSchema(10, 10, undefined);
  const defaultValues = statSchema.parse(statDistribution ?? {});
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<StatSchemaType>({
    defaultValues,
    mode: "all",
    resolver: zodResolver(statSchema),
  });

  // Submit handler
  const onSubmit = form.handleSubmit((data) => {
    setStatDistribution(data);
    attack({ aiId: aiId, stats: data });
  });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Show component
  return (
    <ContentBox title="Assign Dummy stats" subtitle="" initialBreak={true}>
      <Form {...form}>
        <form className="grid grid-cols-2 gap-2" onSubmit={onSubmit}>
          {statNames
            .filter((x) => !x.includes("Offence"))
            .map((stat, i) => {
              const maxValue =
                statSchema.shape[stat]._def.innerType._def.schema.maxValue;
              if (maxValue && maxValue > 0) {
                return (
                  <FormField
                    key={i}
                    control={form.control}
                    name={stat}
                    render={({ field }) => (
                      <FormItem className="pt-1">
                        <FormLabel>{stat}</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder={stat} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                );
              } else {
                return (
                  <FormItem className="pt-1" key={i}>
                    <FormLabel>{stat}</FormLabel>
                    <FormControl>
                      <div>- Max</div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }
            })}
          {!isAttacking ? (
            <div className="col-span-2 flex flex-row justify-center">
              <Button
                size="xl"
                decoration="gold"
                animation="pulse"
                className="font-fontasia text-4xl w-full"
              >
                <Swords className="h-10 w-10 mr-4" />
                Enter The Arena
              </Button>
            </div>
          ) : (
            <div className="min-h-64">
              <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
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
