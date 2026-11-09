"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  IMG_ICON_MOVE,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
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
import SliderField from "@/layout/SliderField";
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
import { canShowMapAttack } from "@/utils/alliance";
import { round } from "@/utils/math";
import { type BracketSliderSchema, bracketSliderSchema } from "@/validators/travel";

/** Show scouted users and bracket filters with the actions available at the selected hex. */
export const SorroundingUsers: React.FC<SorroundingUsersProps> = (props) => {
  // Destructure props
  const { userData, storedBracket, setStoredBracket } = props;

  // Query
  const { data } = api.village.getAll.useQuery(undefined);

  // Form control
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useForm<BracketSliderSchema>({
    resolver: zodResolver(bracketSliderSchema),
    defaultValues: { value: storedBracket ?? -1 },
  });
  const watchedBracket = round(useWatch({ control, name: "value" }));
  const isBracketFilterActive = watchedBracket >= 0;

  const users = getScoutingUsers(props.users, userData.userId, watchedBracket);

  // Update the localStorage whenever we change
  useEffect(() => {
    setStoredBracket(watchedBracket);
  }, [watchedBracket]);

  return (
    <Modal
      isOpen={userData.status === "AWAKE"}
      title={`Scouting. Your position: [${props.hex.col}, ${props.hex.row}]`}
      setIsOpen={props.setIsOpen}
      isValid={false}
      className="md:max-w-[calc(100%-2rem)]"
    >
      {users.length === 0 && (
        <p className="text-red-500">
          {isBracketFilterActive
            ? `No awake users match your scouting filters (bracket ${watchedBracket})`
            : "No awake users in this sector"}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 pb-3 text-center sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 xl:grid-cols-14">
        {users.map((user) => {
          // Derived
          const sameHex =
            user.latitude === props.hex.row && user.longitude === props.hex.col;
          const village = data?.find((v) => v.id === user.villageId);
          const villageName = village ? village.name : "Unknown";
          const villageColor = village ? village.hexColor : "gray";
          const showAttack = canShowMapAttack(
            userData,
            user,
            props.allyAttack,
            props.wars,
          );
          const showRob =
            !RANKS_RESTRICTED_FROM_PVP.includes(user.rank) &&
            sameHex &&
            userData.isOutlaw;
          const userBracket = getKnownExpBracket(user);
          const userLevel = getKnownEffectiveLevel(user);

          // Show user
          return (
            <div key={`${user.userId}-sorrounding-${user.longitude}-${user.latitude}`}>
              <div className="relative">
                <div className="absolute top-0 right-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                  {showAttack && sameHex && (
                    <Image
                      src={IMG_SECTOR_ATTACK}
                      onClick={() => props.attackUser(user.userId)}
                      width={40}
                      height={40}
                      alt={`Attack-${user.userId}`}
                    />
                  )}

                  {!sameHex && (
                    <Image
                      src={IMG_ICON_MOVE}
                      onClick={() => props.move(user.longitude, user.latitude)}
                      width={40}
                      height={40}
                      alt={`Move-${user.userId}`}
                    />
                  )}
                </div>
                {!user.isMasked && (
                  <div className="absolute top-0 left-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                    <Link href={`/userid/${user.userId}`}>
                      <Image
                        src={IMG_SECTOR_INFO}
                        width={40}
                        height={40}
                        alt={`Info-${user.userId}`}
                      />
                    </Link>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 z-50 max-w-1/3 hover:cursor-pointer hover:opacity-80">
                  {user.curHealth < user.maxHealth &&
                    hasRequiredRank(userData.rank, MEDNIN_MIN_RANK) && (
                      <HealingPopover targetUser={user} side="top" />
                    )}
                </div>
                <AvatarImage href={user.avatar} alt={user.username} size={512} />
              </div>
              <div className="relative">
                {showRob && (
                  <div className="absolute right-0 bottom-0 z-50 w-1/3 hover:cursor-pointer hover:opacity-80">
                    <Image
                      src={IMG_SECTOR_ROB}
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
                      width={40}
                      height={40}
                      alt={`Rob-${user.userId}`}
                      className={`ml-1 ${user.robImmunityUntil && user.robImmunityUntil > new Date() ? "opacity-50" : ""}`}
                    />
                  </div>
                )}
              </div>
              <p>{user.username}</p>
              <p className="text-xs">
                Lvl. {userLevel ?? "?"} · Bracket{" "}
                {userBracket == null ? "?" : `${userBracket}/${MAX_PVP_BRACKET}`} [
                {user.longitude}, {user.latitude}]
              </p>
              <p style={{ color: villageColor }} className="font-bold">
                {villageName}
              </p>
            </div>
          );
        })}
      </div>
      <hr />
      <div className="pt-3">
        <SliderField
          id="value"
          default={-1}
          min={-1}
          max={MAX_PVP_BRACKET}
          unit="bracket"
          label="Select bracket to show"
          register={register}
          setValue={setValue}
          watchedValue={watchedBracket}
          formatWatchedValue={(value) =>
            value < 0 ? "Selected: Off (no filter)" : `Selected: bracket ${value}`
          }
          error={errors.value?.message}
        />
        <div className="flex flex-row items-center">
          <Checkbox
            className="m-1 mr-3"
            checked={props.allyAttack}
            onCheckedChange={() => props.setAllyAttack(!props.allyAttack)}
          />
          <Label>Attack button on allies</Label>
        </div>
      </div>
    </Modal>
  );
};

interface SorroundingUsersProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userData: NonNullable<UserWithRelations>;
  hex: TerrainHex;
  users: SectorUser[];
  allyAttack: boolean;
  wars: Parameters<typeof canShowMapAttack>[3];
  setAllyAttack: (newValue: boolean) => void;
  storedBracket: number;
  setStoredBracket: (newValue: number) => void;
  attackUser: (userId: string) => void;
  robUser: (userId: string) => void;
  move: (longitude: number, latitude: number) => void;
}
