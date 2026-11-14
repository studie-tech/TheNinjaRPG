"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  IMG_ICON_MOVE,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_ROB,
  MAX_PVP_BRACKET,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import HealingPopover from "@/layout/HealingPopover";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Modal from "@/layout/Modal";
import type { TerrainHex } from "@/libs/hexgrid";
import {
  getKnownEffectiveLevel,
  getKnownExpBracket,
  getScoutingUsers,
} from "@/libs/profile";
import { hasRequiredRank } from "@/libs/rank";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { canShowMapAttack, mapAttackRelation } from "@/utils/alliance";

/** Scouted players in responsive rows, with persistent filters and eligible map actions. */
export const SurroundingUsers: React.FC<SurroundingUsersProps> = (props) => {
  const { userData, storedBrackets, setStoredBrackets } = props;
  const { data: villages } = api.village.getAll.useQuery(undefined);
  const nearbyUsers = getScoutingUsers(props.users, userData.userId, null);
  const users = getScoutingUsers(props.users, userData.userId, storedBrackets).filter(
    (user) =>
      !props.excludeAllies || mapAttackRelation(userData, user, props.wars) !== "ALLY",
  );

  return (
    <Modal
      isOpen={userData.status === "AWAKE"}
      title={`Scouting. Your position: [${props.hex.col}, ${props.hex.row}]`}
      setIsOpen={props.setIsOpen}
      isValid={false}
      className="md:max-w-6xl"
    >
      <fieldset className="space-y-2 border-b pb-3">
        <legend className="mb-2 font-semibold">Brackets</legend>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={storedBrackets === null ? "default" : "outline"}
            size="sm"
            aria-pressed={storedBrackets === null}
            onClick={() => setStoredBrackets(null)}
          >
            All
          </Button>
          {Array.from({ length: MAX_PVP_BRACKET + 1 }, (_, bracket) => {
            const selected = storedBrackets?.includes(bracket) ?? false;
            return (
              <Button
                key={bracket}
                variant={selected ? "default" : "outline"}
                size="sm"
                aria-label={`Bracket ${bracket}`}
                aria-pressed={selected}
                onClick={() => {
                  // Selecting a bracket from All starts a focused selection.
                  const next =
                    storedBrackets === null
                      ? [bracket]
                      : selected
                        ? storedBrackets.filter((value) => value !== bracket)
                        : [...storedBrackets, bracket];
                  setStoredBrackets(next.length === MAX_PVP_BRACKET + 1 ? null : next);
                }}
              >
                {bracket}
              </Button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          Select one or more brackets, or All to show every bracket.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="scouting-exclude-allies"
              checked={props.excludeAllies}
              onCheckedChange={(checked) => props.setExcludeAllies(checked === true)}
            />
            <Label htmlFor="scouting-exclude-allies">Exclude allies</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="scouting-attack-allies"
              checked={props.allyAttack}
              onCheckedChange={(checked) => props.setAllyAttack(checked === true)}
            />
            <Label htmlFor="scouting-attack-allies">Attack button on allies</Label>
          </div>
        </div>
      </fieldset>
      <p role="status" className="text-muted-foreground text-sm">
        {users.length} of {nearbyUsers.length} awake players shown
      </p>
      {users.length === 0 ? (
        <p className="py-4 text-center">
          {nearbyUsers.length === 0
            ? "No awake users in this sector"
            : "No awake users match your scouting filters. Select All or turn off Exclude allies to see more players."}
        </p>
      ) : (
        <div>
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-3 border-b px-2 py-2 text-sm font-semibold lg:grid"
          >
            <span>Player</span>
            <span>Village</span>
            <span>Level / bracket</span>
            <span>Position</span>
            <span>Actions</span>
          </div>
          <ul aria-label="Scouted players" className="divide-y">
            {users.map((user) => {
              const sameHex =
                user.latitude === props.hex.row && user.longitude === props.hex.col;
              const village = villages?.find((v) => v.id === user.villageId);
              const showAttack =
                sameHex &&
                canShowMapAttack(userData, user, props.allyAttack, props.wars);
              const showRob =
                !RANKS_RESTRICTED_FROM_PVP.includes(user.rank) &&
                sameHex &&
                userData.isOutlaw;
              const isRobImmune =
                !!user.robImmunityUntil && user.robImmunityUntil > new Date();
              return (
                <li
                  key={user.userId}
                  className="grid min-w-0 grid-cols-2 items-center gap-3 px-2 py-3 text-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]"
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                    <AvatarImage
                      href={user.avatar}
                      alt={user.username}
                      size={40}
                      className="m-0 w-10 shrink-0 rounded-lg"
                    />
                    <span className="min-w-0 font-semibold wrap-anywhere">
                      {user.username}
                    </span>
                  </div>
                  <span className="flex min-w-0 items-center gap-2 font-semibold wrap-anywhere">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full border"
                      style={{ backgroundColor: village?.hexColor ?? "gray" }}
                    />
                    {village?.name ?? "Unknown"}
                  </span>
                  <span>
                    Lvl. {getKnownEffectiveLevel(user) ?? "?"} · Bracket{" "}
                    {getKnownExpBracket(user) ?? "?"}
                  </span>
                  <span className="text-muted-foreground">
                    [{user.longitude}, {user.latitude}]
                  </span>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1">
                    {!sameHex && (
                      <ScoutAction
                        label="Move"
                        targetName={user.username}
                        icon={IMG_ICON_MOVE}
                        onClick={() => props.move(user.longitude, user.latitude)}
                      />
                    )}
                    {showAttack && (
                      <ScoutAction
                        label="Attack"
                        targetName={user.username}
                        icon={IMG_SECTOR_ATTACK}
                        onClick={() => props.attackUser(user.userId)}
                      />
                    )}
                    {showRob && (
                      <ScoutAction
                        label="Rob"
                        targetName={user.username}
                        icon={IMG_SECTOR_ROB}
                        isUnavailable={isRobImmune}
                        title={
                          isRobImmune ? "Target is immune from being robbed" : undefined
                        }
                        onClick={() => {
                          if (
                            user.robImmunityUntil &&
                            user.robImmunityUntil > new Date()
                          ) {
                            showMutationToast({
                              success: false,
                              message: "Target is immune from being robbed",
                            });
                          } else {
                            props.robUser(user.userId);
                          }
                        }}
                      />
                    )}
                    {user.curHealth < user.maxHealth &&
                      hasRequiredRank(userData.rank, MEDNIN_MIN_RANK) && (
                        <HealingPopover
                          targetUser={user}
                          side="top"
                          trigger={
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Heal ${user.username}`}
                            >
                              Heal
                            </Button>
                          }
                        />
                      )}
                    {!user.isMasked && (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={`/userid/${user.userId}`}
                          aria-label={`Profile of ${user.username}`}
                        >
                          Profile
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
};

/** Labelled keyboard-accessible map action with the game's existing artwork. */
const ScoutAction = ({
  label,
  targetName,
  icon,
  onClick,
  isUnavailable,
  title,
}: {
  label: string;
  targetName: string;
  icon: string;
  onClick: () => void;
  isUnavailable?: boolean;
  title?: string;
}) => (
  <Button
    variant="outline"
    size="sm"
    onClick={onClick}
    aria-disabled={isUnavailable}
    className={isUnavailable ? "opacity-50" : undefined}
    title={title}
    aria-label={`${label} ${targetName}`}
  >
    <Image src={icon} width={20} height={20} alt="" />
    {label}
  </Button>
);

interface SurroundingUsersProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userData: NonNullable<UserWithRelations>;
  hex: TerrainHex;
  users: SectorUser[];
  allyAttack: boolean;
  wars: Parameters<typeof canShowMapAttack>[3];
  setAllyAttack: (newValue: boolean) => void;
  storedBrackets: number[] | null;
  setStoredBrackets: (newValue: number[] | null) => void;
  excludeAllies: boolean;
  setExcludeAllies: (newValue: boolean) => void;
  attackUser: (userId: string) => void;
  robUser: (userId: string) => void;
  move: (longitude: number, latitude: number) => void;
}
