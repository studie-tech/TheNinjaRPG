"use client";

import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { useActiveWars } from "@/hooks/useActiveWars";
import { useAllyOfferActions } from "@/hooks/useWarActions";
import ContentBox from "@/layout/ContentBox";
import NavTabs from "@/layout/NavTabs";
import { SectorWar } from "@/layout/SectorWar";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { VillageWar } from "@/layout/VillageWar";
import { WarMap } from "@/layout/WarMap";
import { isOfferForWarCard } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { isKage } from "@/utils/kage";
import { useUserInfo } from "@/utils/UserContext";

/**
 * Wars Component
 */
export const WarRoom: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs?: React.ReactNode;
  initialBreak?: boolean;
}> = ({ user, navTabs, initialBreak }) => {
  const { timeDiff } = useUserInfo();

  // State
  const [warType, setWarType] = useState<"Active" | "Ended">("Active");

  // Queries
  const { data: activeWars } = useActiveWars(user.villageId ?? "", {
    enabled: warType === "Active",
    timeDiff,
  });

  const { data: endedWars } = api.war.getEndedWars.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId && warType === "Ended" },
  );

  const { data: villageData } = api.village.getAlliances.useQuery(undefined, {
    staleTime: 10000,
  });

  const { data: requests } = api.war.getAllyOffers.useQuery(undefined, {
    staleTime: 30000,
  });

  // Mutations
  const allyOffers = useAllyOfferActions();

  // Derived
  const isLeader = isKage(user);
  const villages = villageData?.villages;
  const userVillage = villages?.find((v) => v.id === user.villageId);
  const relationships = villageData?.relationships || [];
  // Ended sector wars have no ended view, so only village wars are listed as ended
  const shownWars =
    warType === "Active"
      ? activeWars
      : endedWars?.filter((war) => war.type !== "SECTOR_WAR");
  // Each village war card lists its own offers with their war; the board keeps the rest.
  const warIdsListingOffers = user.isOutlaw
    ? []
    : (activeWars ?? [])
        .filter((war) => war.type !== "SECTOR_WAR" && war.status === "ACTIVE")
        .map((war) => war.id);
  const boardOffers = requests?.filter(
    (request) => !warIdsListingOffers.some((id) => isOfferForWarCard(request, id)),
  );
  const areAllOffersOnCards = !!requests?.length && boardOffers?.length === 0;

  return (
    <>
      <ContentBox
        title="Wars"
        subtitle="Manage Wars"
        defaultBackHref="/village"
        topRightContent={navTabs}
        initialBreak={initialBreak}
      >
        <WarMap
          user={user}
          isKage={isLeader}
          villages={villages}
          relationships={relationships}
        />
      </ContentBox>

      {/* War Exhaustion Status */}
      {userVillage?.warExhaustionEndedAt &&
        userVillage.warExhaustionEndedAt > new Date() && (
          <ContentBox
            title="War Exhaustion"
            subtitle="Village is under war exhaustion"
            initialBreak={true}
          >
            <div className="space-y-2 text-center">
              <p className="text-muted-foreground">
                Your village cannot declare war until the exhaustion period ends.
              </p>
              <p className="font-semibold text-lg">
                Exhaustion ends:{" "}
                {new Date(userVillage.warExhaustionEndedAt).toLocaleString()}
              </p>
            </div>
          </ContentBox>
        )}

      <ContentBox
        title={`${warType} Wars`}
        subtitle={warType === "Active" ? "Current Conflicts" : "Past Conflicts"}
        initialBreak={true}
        topRightContent={
          <NavTabs
            id="warTypeSelection"
            current={warType}
            options={user.villageId ? ["Active", "Ended"] : ["Active"]}
            setValue={setWarType}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4">
          {shownWars?.map((war) =>
            war.type === "SECTOR_WAR" ? (
              <SectorWar key={war.id} war={war} user={user} isKage={isLeader} />
            ) : (
              <VillageWar
                key={war.id}
                war={war}
                user={user}
                villages={villages}
                relationships={relationships}
                userVillage={userVillage}
                isKage={isLeader}
              />
            ),
          )}
          {shownWars && shownWars.length === 0 && (
            <p>{warType === "Active" ? "No active wars" : "No ended wars"}</p>
          )}
        </div>
      </ContentBox>
      {isLeader && warType === "Active" && !areAllOffersOnCards && (
        <ContentBox
          title="War Contract Offers"
          subtitle="Pending war participation requests"
          initialBreak={true}
          padding={false}
        >
          {boardOffers && boardOffers.length > 0 && (
            <UserRequestSystem
              isLoading={allyOffers.isPending}
              requests={boardOffers}
              userId={user.userId}
              onAccept={allyOffers.onAccept}
              onReject={allyOffers.onReject}
              onCancel={allyOffers.onCancel}
            />
          )}
          {boardOffers && boardOffers.length === 0 && (
            <p className="p-4">No pending war participation requests</p>
          )}
        </ContentBox>
      )}
    </>
  );
};
