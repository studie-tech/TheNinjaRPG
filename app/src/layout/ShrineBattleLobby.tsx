"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { secondsFromDate } from "@/utils/time";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { showUserRank } from "@/libs/profile";
import AvatarImage from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DoorOpen, CirclePlay, Swords, Users, Shield, Loader2 } from "lucide-react";
import { cn } from "src/libs/shadui";
import {
  SHRINE_BATTLE_MIN_ATTACKERS,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BATTLE_LOBBY_SECONDS,
} from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/api/root";

type ShrineBattleData =
  inferRouterOutputs<AppRouter>["shrine"]["getShrineBattles"][number];

interface ShrineBattleLobbyProps {
  sectorNumber: number;
  userId: string;
  userVillageId: string;
  defenderVillageId?: string | null;
  isProtected?: boolean;
}

export const ShrineBattleLobby: React.FC<ShrineBattleLobbyProps> = ({
  sectorNumber,
  userId,
  userVillageId,
  defenderVillageId,
  isProtected = false,
}) => {
  const utils = api.useUtils();
  const router = useRouter();

  // Query for shrine battles
  const { data: shrineBattles, isLoading } = api.shrine.getShrineBattles.useQuery(
    { sectorNumber },
    { refetchInterval: 5000 },
  );

  // Mutations
  const { mutate: challengeShrine, isPending: isChallenging } =
    api.shrine.challengeShrine.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.shrine.getShrineBattles.invalidate();
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: joinBattle, isPending: isJoining } =
    api.shrine.joinShrineBattle.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.shrine.getShrineBattles.invalidate();
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: leaveBattle, isPending: isLeaving } =
    api.shrine.leaveShrineBattle.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.shrine.getShrineBattles.invalidate();
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: initiateBattle, isPending: isInitiating } =
    api.shrine.initiateShrineBattle.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.shrine.getShrineBattles.invalidate();
          await utils.profile.getUser.invalidate();
          router.push("/combat");
        }
      },
    });

  // Determine if user can create a challenge
  const canCreateChallenge =
    defenderVillageId &&
    userVillageId !== defenderVillageId &&
    !isChallenging &&
    !isProtected;

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
            <Swords className="mr-2 h-5 w-5" />
            Create Shrine Attack Party
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
              userVillageId={userVillageId}
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
          No active shrine battles for this sector. Create an attack party to challenge
          the shrine!
        </p>
      )}
    </div>
  );
};

interface ShrineBattleCardProps {
  battle: ShrineBattleData;
  userId: string;
  userVillageId: string;
  onJoin: (side: "ATTACKER" | "DEFENDER") => void;
  onLeave: () => void;
  onInitiate: () => void;
  isJoining: boolean;
  isLeaving: boolean;
  isInitiating: boolean;
}

const ShrineBattleCard: React.FC<ShrineBattleCardProps> = ({
  battle,
  userId,
  userVillageId,
  onJoin,
  onLeave,
  onInitiate,
  isJoining,
  isLeaving,
  isInitiating,
}) => {
  const attackers = battle.queue.filter((q) => q.side === "ATTACKER");
  const defenders = battle.queue.filter((q) => q.side === "DEFENDER");
  const userInBattle = battle.queue.some((q) => q.userId === userId);
  const startTime = secondsFromDate(SHRINE_BATTLE_LOBBY_SECONDS, battle.createdAt);
  const canInitiate = attackers.length >= SHRINE_BATTLE_MIN_ATTACKERS;

  // Determine if user can join as attacker or defender
  const canJoinAsAttacker =
    !userInBattle &&
    userVillageId !== battle.defenderEntityId &&
    attackers.length < SHRINE_BATTLE_MAX_USERS_PER_SIDE;
  const canJoinAsDefender =
    !userInBattle &&
    userVillageId === battle.defenderEntityId &&
    defenders.length < SHRINE_BATTLE_MAX_USERS_PER_SIDE;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Attackers Section */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Swords className="h-4 w-4 text-red-500" />
            Attackers ({attackers.length}/{SHRINE_BATTLE_MAX_USERS_PER_SIDE})
          </div>
          <div className="flex flex-wrap gap-2">
            {attackers.map((q) => (
              <UserSlot key={q.userId} user={q.user} />
            ))}
            {Array.from({
              length: SHRINE_BATTLE_MAX_USERS_PER_SIDE - attackers.length,
            }).map((_, i) => (
              <EmptySlot
                key={`attacker-empty-${i}`}
                canJoin={canJoinAsAttacker}
                onJoin={() => onJoin("ATTACKER")}
              />
            ))}
          </div>
        </div>

        {/* VS Divider */}
        <div className="flex items-center justify-center px-4">
          <span className="text-lg font-bold text-muted-foreground">VS</span>
        </div>

        {/* Defenders Section */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-blue-500" />
            Defenders ({defenders.length}/{SHRINE_BATTLE_MAX_USERS_PER_SIDE})
          </div>
          <div className="flex flex-wrap gap-2">
            {defenders.map((q) => (
              <UserSlot key={q.userId} user={q.user} />
            ))}
            {Array.from({
              length: SHRINE_BATTLE_MAX_USERS_PER_SIDE - defenders.length,
            }).map((_, i) => (
              <EmptySlot
                key={`defender-empty-${i}`}
                canJoin={canJoinAsDefender}
                onJoin={() => onJoin("DEFENDER")}
              />
            ))}
          </div>
          {defenders.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              AI defenders will be used if no players join
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons & Timer */}
      <div className="mt-4 flex flex-col items-center gap-2 border-t pt-4 sm:flex-row sm:justify-between">
        <div className="text-sm text-muted-foreground">
          <Countdown
            targetDate={startTime}
            timeDiff={0}
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
                Leave
              </Button>

              <Button
                size="sm"
                onClick={onInitiate}
                disabled={!canInitiate || isInitiating}
                className={cn(!canInitiate && "opacity-50")}
              >
                {isInitiating ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : (
                  <CirclePlay className="mr-1 h-4 w-4" />
                )}
                Start Battle
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
                  Join Attack
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
                  Defend
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
        <div className="flex flex-col items-center w-10">
          <AvatarImage
            href={user.avatar}
            alt={user.username}
            size={35}
            hover_effect={true}
            priority
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="text-center">
          <p className="font-bold">{user.username}</p>
          <p className="text-sm text-muted-foreground">
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
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-gray-400 text-sm",
        canJoin &&
          "cursor-pointer hover:border-orange-500 hover:bg-orange-50 hover:text-orange-500",
      )}
      onClick={canJoin ? onJoin : undefined}
    >
      ?
    </div>
  );
};

export default ShrineBattleLobby;
