"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Swords } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import ContentBox from "@/layout/ContentBox";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";
import { getSearchValidator } from "@/validators/register";

/** Sparring: challenge other players and answer their challenges. */
export const SparringMode = () => (
  <>
    <ChallengeUser />
    <ActiveChallenges />
  </>
);

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
            Use ranked rules (ranked loadouts, level {MAX_PLAYER_LEVEL} stats, no LP
            rewards)
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
          await Promise.all([
            utils.sparring.getUserChallenges.invalidate(),
            utils.pvpRank.getRankedLoadout.invalidate(),
          ]);
          pushToCombat(router, data.battleId);
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
