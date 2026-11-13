"use client";

import { CirclePlay, DoorOpen, Loader2, Shield, Swords, Users } from "lucide-react";
import type React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type MpvpBattleSide,
  SHRINE_BATTLE_LOBBY_SECONDS,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BATTLE_MIN_ATTACKERS,
} from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import AvatarImage from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import { showUserRank } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsFromDate } from "@/utils/time";
import { useRequiredUserInfo, useUserInfo } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

type ShrineBattleData = RouterOutputs["shrine"]["getShrineBattles"][number];

interface ShrineBattleLobbyProps {
  sectorNumber: number;
  userId: string;
  sideVillageId: string | null;
  defenderVillageId?: string | null;
  isProtected?: boolean;
}

export const ShrineBattleLobby: React.FC<ShrineBattleLobbyProps> = ({
  sectorNumber,
  userId,
  sideVillageId,
  defenderVillageId,
  isProtected = false,
}) => {
  const utils = api.useUtils();
  const { updateUser, prepareUserUpdate } = useRequiredUserInfo();
  const router = useRouter();

  // Query for shrine battles
  const { data: shrineBattles, isLoading } = api.shrine.getShrineBattles.useQuery(
    { sectorNumber },
    { refetchInterval: 5000, refetchIntervalInBackground: false },
  );

  /** Applies a lobby mutation's outcome; `applyProfile` is off for plain refusals. */
  const applyLobbyResult = async (
    data: UserDeltaResponse,
    revision: number | undefined,
    applyProfile = data.success || !!data.userPatch,
  ) => {
    if (applyProfile) await updateUser(data, { revision });
    showMutationToast(data);
    if (data.success) {
      await utils.shrine.getShrineBattles.invalidate();
    }
  };

  // Mutations
  const { mutate: challengeShrine, isPending: isChallenging } =
    api.shrine.challengeShrine.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => applyLobbyResult(data, revision),
    });

  const { mutate: joinBattle, isPending: isJoining } =
    api.shrine.joinShrineBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => applyLobbyResult(data, revision),
    });

  const { mutate: leaveBattle, isPending: isLeaving } =
    api.shrine.leaveShrineBattle.useMutation({
      onMutate: prepareUserUpdate,
      // A refused leave means the queue moved on, so the profile always reconciles.
      onSuccess: (data, _variables, revision) => applyLobbyResult(data, revision, true),
    });

  const { mutate: initiateBattle, isPending: isInitiating } =
    api.shrine.initiateShrineBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        await applyLobbyResult(data, revision);
        if (data.success && data.battleId) pushToCombat(router, data.battleId);
      },
    });

  // Determine if user can create a challenge
  const canCreateChallenge =
    defenderVillageId && sideVillageId !== defenderVillageId && !isProtected;

  // Check if user is already in any battle
  const userInBattle = shrineBattles?.some((battle) =>
    battle.queue.some((q) => q.userId === userId),
  );

  if (isLoading) {
    return <Loader explanation="Loading shrine battles..." />;
  }

  return (
    <div className="space-y-4">
      {/* Create new challenge button */}
      {canCreateChallenge && !userInBattle && (
        <div className="flex justify-center">
          <Button
            size="lg"
            className="w-full max-w-md"
            onClick={() => challengeShrine({ sectorNumber })}
            disabled={isChallenging}
          >
            {isChallenging ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Swords className="mr-2 h-5 w-5" />
            )}
            {isChallenging ? "Creating Attack Party..." : "Create Shrine Attack Party"}
          </Button>
        </div>
      )}

      {/* List existing battles */}
      {shrineBattles && shrineBattles.length > 0 ? (
        <div className="space-y-4">
          {shrineBattles.map((battle) => (
            <ShrineBattleCard
              key={battle.id}
              battle={battle}
              userId={userId}
              onJoin={(side) => joinBattle({ shrineBattleId: battle.id, side })}
              onLeave={() => leaveBattle({ shrineBattleId: battle.id })}
              onInitiate={() => initiateBattle({ shrineBattleId: battle.id })}
              isJoining={isJoining}
              isLeaving={isLeaving}
              isInitiating={isInitiating}
            />
          ))}
        </div>
      ) : (
        <p className="text-center text-muted-foreground">
          {sideVillageId === defenderVillageId
            ? "No active attacks on your shrine. You can join as a defender when attackers start a team battle."
            : canCreateChallenge
              ? "No active shrine battles for this sector. Create an attack party to challenge the shrine!"
              : "No active shrine battles for this sector."}
        </p>
      )}
    </div>
  );
};

interface ShrineBattleCardProps {
  battle: ShrineBattleData;
  userId: string;
  onJoin: (side: MpvpBattleSide) => void;
  onLeave: () => void;
  onInitiate: () => void;
  isJoining: boolean;
  isLeaving: boolean;
  isInitiating: boolean;
}

const ShrineBattleCard: React.FC<ShrineBattleCardProps> = ({
  battle,
  userId,
  onJoin,
  onLeave,
  onInitiate,
  isJoining,
  isLeaving,
  isInitiating,
}) => {
  const { timeDiff } = useUserInfo();
  const attackers = battle.queue.filter((q) => q.side === "ATTACKER");
  const defenders = battle.queue.filter((q) => q.side === "DEFENDER");
  const userInBattle = battle.queue.some((q) => q.userId === userId);
  const startTime = secondsFromDate(SHRINE_BATTLE_LOBBY_SECONDS, battle.createdAt);
  const canInitiate = attackers.length >= SHRINE_BATTLE_MIN_ATTACKERS;

  // Determine if user can join as attacker or defender
  const canJoinAsAttacker =
    !userInBattle &&
    battle.viewerSide === "ATTACKER" &&
    attackers.length < SHRINE_BATTLE_MAX_USERS_PER_SIDE;
  const canJoinAsDefender =
    !userInBattle &&
    battle.viewerSide === "DEFENDER" &&
    defenders.length < SHRINE_BATTLE_MAX_USERS_PER_SIDE;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <QueueSide
          side="attacker"
          icon={<Swords className="h-4 w-4 text-red-500" />}
          label="Attackers"
          entries={attackers}
          canJoin={canJoinAsAttacker}
          isJoining={isJoining}
          onJoin={() => onJoin("ATTACKER")}
        />

        {/* VS Divider */}
        <div className="flex items-center justify-center px-4">
          <span className="font-bold text-lg text-muted-foreground">VS</span>
        </div>

        <QueueSide
          side="defender"
          icon={<Shield className="h-4 w-4 text-blue-500" />}
          label="Defenders"
          entries={defenders}
          canJoin={canJoinAsDefender}
          isJoining={isJoining}
          onJoin={() => onJoin("DEFENDER")}
        >
          {defenders.length === 0 && (
            <p className="mt-1 text-muted-foreground text-xs">
              AI defenders will be used if no players join
            </p>
          )}
        </QueueSide>
      </div>

      {/* Action Buttons & Timer */}
      <div className="mt-4 flex flex-col items-center gap-2 border-t pt-4 sm:flex-row sm:justify-between">
        <div className="text-muted-foreground text-sm">
          <Countdown
            targetDate={startTime}
            timeDiff={timeDiff}
            onEndShow={
              canInitiate
                ? "Battle can start!"
                : `Waiting for ${SHRINE_BATTLE_MIN_ATTACKERS - attackers.length} more attacker(s)`
            }
          />
        </div>
        <div className="flex gap-2">
          {userInBattle && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onLeave}
                disabled={isLeaving}
              >
                <DoorOpen className="mr-1 h-4 w-4" />
                {isLeaving ? "Leaving..." : "Leave"}
              </Button>

              <Button
                size="sm"
                onClick={onInitiate}
                disabled={!canInitiate || isInitiating}
                className={cn(!canInitiate && "opacity-50")}
              >
                {isInitiating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CirclePlay className="mr-1 h-4 w-4" />
                )}
                {isInitiating ? "Starting..." : "Start Battle"}
              </Button>
            </>
          )}
          {!userInBattle && (canJoinAsAttacker || canJoinAsDefender) && (
            <div className="flex gap-2">
              {canJoinAsAttacker && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onJoin("ATTACKER")}
                  disabled={isJoining}
                >
                  <Users className="mr-1 h-4 w-4" />
                  {isJoining ? "Joining..." : "Join Attack"}
                </Button>
              )}
              {canJoinAsDefender && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onJoin("DEFENDER")}
                  disabled={isJoining}
                >
                  <Shield className="mr-1 h-4 w-4" />
                  {isJoining ? "Joining..." : "Defend"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Minimum attackers warning */}
      {attackers.length < SHRINE_BATTLE_MIN_ATTACKERS && (
        <p className="mt-2 text-center text-xs text-yellow-600">
          Need at least {SHRINE_BATTLE_MIN_ATTACKERS} attackers to start (currently{" "}
          {attackers.length})
        </p>
      )}
    </div>
  );
};

/** Render one shrine battle roster with its optional join control and side-specific details. */
const QueueSide: React.FC<QueueSideProps> = ({
  side,
  icon,
  label,
  entries,
  canJoin,
  isJoining,
  onJoin,
  children,
}) => (
  <div className="flex-1">
    <div className="mb-2 flex items-center gap-2 font-semibold text-sm">
      {icon}
      {label} ({entries.length}/{SHRINE_BATTLE_MAX_USERS_PER_SIDE})
    </div>
    <div className="flex flex-wrap gap-2">
      {entries.map((q) => (
        <UserSlot key={q.userId} user={q.user} />
      ))}
      {Array.from(
        { length: SHRINE_BATTLE_MAX_USERS_PER_SIDE - entries.length },
        (_, idx) => `${side}-empty-${idx}`,
      ).map((key) => (
        <EmptySlot key={key} canJoin={canJoin && !isJoining} onJoin={onJoin} />
      ))}
    </div>
    {children}
  </div>
);

interface UserSlotProps {
  user: {
    username: string;
    level: number;
    rank: UserRank;
    avatar: string | null;
    villageId: string | null;
  };
}

const UserSlot: React.FC<UserSlotProps> = ({ user }) => {
  return (
    <Popover>
      <PopoverTrigger>
        <div className="flex w-10 flex-col items-center">
          <AvatarImage
            href={user.avatar}
            alt={user.username}
            size={35}
            hover_effect={true}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="text-center">
          <p className="font-bold">{user.username}</p>
          <p className="text-muted-foreground text-sm">
            Lvl. {user.level} {capitalizeFirstLetter(showUserRank(user))}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface EmptySlotProps {
  canJoin: boolean;
  onJoin: () => void;
}

const EmptySlot: React.FC<EmptySlotProps> = ({ canJoin, onJoin }) => {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-300 border-dashed text-gray-400 text-sm",
        canJoin &&
          "cursor-pointer hover:border-orange-500 hover:bg-orange-50 hover:text-orange-500",
      )}
      onClick={canJoin ? onJoin : undefined}
      disabled={!canJoin}
    >
      ?
    </button>
  );
};

export default ShrineBattleLobby;

interface QueueSideProps {
  side: "attacker" | "defender";
  icon: React.ReactNode;
  label: string;
  entries: ShrineBattleData["queue"];
  canJoin: boolean;
  isJoining: boolean;
  onJoin: () => void;
  children?: React.ReactNode;
}
