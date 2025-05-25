"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import BanInfo from "@/layout/BanInfo";
import { useRequireInVillage } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal from "@/layout/Modal";
import { ActionSelector } from "@/layout/CombatActions";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import type { Jutsu } from "@/drizzle/schema";
import { OctagonX } from "lucide-react";
import LoadoutSelector from "@/layout/LoadoutSelector";

const QueueTimer = ({ createdAt }: { createdAt: Date }) => {
  const [queueTime, setQueueTime] = useState("0:00");

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = now.getTime() - new Date(createdAt).getTime();
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setQueueTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer(); // Initial update
    const interval = setInterval(updateTimer, 1000);
  
    return () => clearInterval(interval);
  }, [createdAt]);

  return (
    <span className="font-mono">{queueTime}</span>
  );
};

export default function Ranked() {
  // Router for forwarding
  const router = useRouter();
  const utils = api.useUtils();

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // Get items and loadout data
  const { data: weapons } = api.item.getAll.useQuery({ itemType: "WEAPON", limit: 100 });
  const { data: consumables } = api.item.getAll.useQuery({ itemType: "CONSUMABLE", limit: 100 });
  const { data: rankedLoadout } = api.combat.getRankedLoadout.useQuery();
  const updateLoadout = api.combat.updateRankedLoadout.useMutation({
    onSuccess: () => {
      void utils.combat.getRankedLoadout.invalidate();
    },
  });

  // Two-level filtering for jutsu
  const state = useFiltering();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedJutsu, setSelectedJutsu] = useState<Jutsu | undefined>(undefined);

  // Ranked PvP queue state and mutations
  const { data: queueData } = api.combat.getRankedPvpQueue.useQuery(undefined, {
    enabled: !!userData,
    refetchInterval: 5000, // Refetch queue status every 5 seconds
  });

  // Get all jutsu and user jutsu data
  const { 
    data: allJutsu, 
    isFetching: isLoadingJutsu, 
    fetchNextPage, 
    hasNextPage 
  } = api.jutsu.getAll.useInfiniteQuery(
    { limit: 100, hideAi: true, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: !!userData,
    }
  );

  useEffect(() => {
    if (hasNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage]);

  const { data: userJutsus, isFetching: isLoadingUserJutsu } = api.jutsu.getRankedUserJutsus.useQuery(
    getFilter(state),
    { enabled: !!userData }
  );

  // Get total count of equipped jutsu without any filters
  const { data: totalEquipped } = api.jutsu.getRankedUserJutsus.useQuery(
    {}, // No filters to get total count
    { enabled: !!userData }
  );

  // Check if user has reached the jutsu limit
  const equippedCount = totalEquipped?.filter(uj => uj.equipped).length ?? 0;
  const hasReachedLimit = equippedCount >= 15;

  // Mutations for queue management
  const { mutate: queue, isPending: isQueuing } = api.combat.queueForRankedPvp.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        showMutationToast({ ...result, message: "Queued for ranked PvP" });
        if (result.battleId) {
          router.push("/combat");
        }
      } else {
        showMutationToast(result);
      }
    },
  });

  const { mutate: leaveQueue, isPending: isLeaving } = api.combat.leaveRankedPvpQueue.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        showMutationToast({ ...result, message: "Left ranked PvP queue" });
      } else {
        showMutationToast(result);
      }
    },
  });

  // Mutations for jutsu management
  const { mutate: equip, isPending: isToggling } = api.jutsu.toggleRankedEquip.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      await utils.jutsu.getRankedUserJutsus.invalidate();
    },
    onSettled: () => {
      setIsOpen(false);
      setSelectedJutsu(undefined);
    },
  });

  const handleEquip = (jutsu: Jutsu) => {
    if (hasReachedLimit && !userJutsuMap.get(jutsu.id)?.equipped) {
      showMutationToast({
        success: false,
        message: `You can only select up to 15 jutsu for ranked battles`,
      });
      return;
    }
    equip({ jutsuId: jutsu.id });
  };

  const { mutate: unequipAllRanked, isPending: isUnequipping } = api.jutsu.unequipAllRanked.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      await utils.jutsu.getRankedUserJutsus.invalidate();
    },
  });

  const { mutate: checkMatches } = api.combat.checkRankedPvpMatches.useMutation({
    onSuccess: (result) => {
      if (result.success && result.battleId) {
        router.push("/combat");
      }
    },
  });

  // Check for matches periodically when in queue
  useEffect(() => {
    if (queueData?.inQueue) {
      const interval = setInterval(() => {
        checkMatches();
      }, 5000); // Check for matches every 5 seconds
      return () => clearInterval(interval);
    }
  }, [queueData?.inQueue, checkMatches]);

  // Process jutsu data
  const flatJutsu = allJutsu?.pages.flatMap((page) => page.data) ?? [];
  const userJutsuMap = new Map(
    userJutsus?.map((uj) => [uj.jutsuId, uj]) ?? []
  );
  const totalEquippedMap = new Map(
    totalEquipped?.map((uj) => [uj.jutsuId, uj]) ?? []
  );

  const processedJutsu = flatJutsu
    .map((jutsu) => {
      const equipped = !!totalEquippedMap.get(jutsu.id)?.equipped;
      return {
        ...jutsu,
        highlight: equipped,
      };
    })
    .filter(jutsu => {
      // Filter out jutsu types not allowed in ranked battles
      const restrictedTypes = ["SPECIAL", "BLOODLINE", "LOYALTY", "CLAN", "EVENT", "AI"];
      return !restrictedTypes.includes(jutsu.jutsuType);
    });

  // Sort if we have a loadout
  if (processedJutsu) {
    processedJutsu.sort((a, b) => {
      const aEquipped = !!totalEquippedMap.get(a.id)?.equipped;
      const bEquipped = !!totalEquippedMap.get(b.id)?.equipped;
  
      // 1. Always sort equipped jutsu to the top
      if (aEquipped !== bEquipped) {
        return aEquipped ? -1 : 1;
      }
  
      // 2. If both are equipped, sort by loadout order
      if (aEquipped && bEquipped && userData?.loadout?.jutsuIds) {
        const aIndex = userData.loadout.jutsuIds.indexOf(a.id);
        const bIndex = userData.loadout.jutsuIds.indexOf(b.id);
        // If both are in loadout, sort by loadout order
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        // If only one is in loadout, prioritize the one in loadout
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }
  
      // 3. For non-equipped jutsu or if no loadout, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  }
  

  // Guards
  if (!access) return <Loader explanation="Accessing Ranked PvP" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData?.isBanned) return <BanInfo />;

  return (
    <>
      <ContentBox
        title="Ranked PvP"
        subtitle={`Current LP: ${userData?.rankedLp || 0}`}
        back_href="/village"
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Queue for ranked PvP battles! You will be matched with players of similar LP.
            All battles are fought with level 100 characters with max stats.
          </p>
          <p className="text-sm text-muted-foreground">
            Players in queue: {queueData?.queueCount ?? 0}
          </p>
          <p className="text-sm font-medium">
            Selected Jutsu: {equippedCount}/15
          </p>
          {queueData?.inQueue && (
            <p className="text-yellow-500">
              You are currently in queue. Waiting for opponent... 
              {queueData.createdAt && (
                <span className="ml-2">
                  Time in queue: <QueueTimer createdAt={queueData.createdAt} />
                </span>
              )}
            </p>
          )}
          {!queueData?.inQueue ? (
            <Button
              className="w-full"
              onClick={() => {
                if (userData.status === "BATTLE") {
                  showMutationToast({ 
                    success: false, 
                    message: "You cannot queue while in battle. Please finish your current battle first."
                  });
                  return;
                }
            
                if (equippedCount > 15) {
                  showMutationToast({
                    success: false,
                    message: `You have selected ${equippedCount} jutsu. You can only have 15 equipped for ranked battles.`,
                  });
                  return;
                }
            
                queue();
              }}
              disabled={isQueuing}
            >
              {isQueuing ? "Queuing..." : "Queue for Ranked PvP"}
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={() => leaveQueue()}
              disabled={isLeaving}
            >
              {isLeaving ? "Leaving..." : "Leave Queue"}
            </Button>
          )}
        </div>
      </ContentBox>

      <ContentBox
        title="Ranked PvP"
        subtitle="Select your items for ranked battles"
      >
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Weapon</h3>
            <div className="grid grid-cols-2 gap-2">
              {weapons?.data.map((weapon) => (
                <div
                  key={weapon.id}
                  className={`p-2 border rounded cursor-pointer ${
                    rankedLoadout?.weaponId === weapon.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => updateLoadout.mutate({ weaponId: weapon.id })}
                >
                  <ItemWithEffects item={weapon} showStatistic="item" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">Consumables</h3>
            <div className="grid grid-cols-2 gap-2">
              {consumables?.data.map((consumable) => (
                <div
                  key={consumable.id}
                  className={`p-2 border rounded cursor-pointer ${
                    rankedLoadout?.consumable1Id === consumable.id ||
                    rankedLoadout?.consumable2Id === consumable.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => {
                    if (rankedLoadout?.consumable1Id === consumable.id) {
                      updateLoadout.mutate({ consumable1Id: undefined });
                    } else if (rankedLoadout?.consumable2Id === consumable.id) {
                      updateLoadout.mutate({ consumable2Id: undefined });
                    } else if (!rankedLoadout?.consumable1Id) {
                      updateLoadout.mutate({ consumable1Id: consumable.id });
                    } else if (!rankedLoadout?.consumable2Id) {
                      updateLoadout.mutate({ consumable2Id: consumable.id });
                    }
                  }}
                >
                  <ItemWithEffects item={consumable} showStatistic="item" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </ContentBox>

      <ContentBox
        title="Ranked PvP"
        subtitle="Select your jutsu for ranked battles"
        bottomRightContent={
          <Button onClick={() => unequipAllRanked()}>
            <OctagonX className="h-6 w-6 mr-2" />
            Unequip All
          </Button>
        }
        topRightContent={
          !isOpen && (
            <div className="flex flex-row items-center gap-2">
              <LoadoutSelector />
              <JutsuFiltering state={state} />
            </div>
          )
        }
      >
        {isLoadingJutsu && <Loader explanation="Loading Jutsu" />}
        <ActionSelector
          items={processedJutsu}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            setSelectedJutsu(processedJutsu?.find((jutsu) => jutsu.id === id));
            setIsOpen(true);
          }}
          emptyText="No jutsu available. Go to the training grounds in your village to learn some."
        />
      </ContentBox>

      {isOpen && selectedJutsu && (
        <Modal
          title={selectedJutsu.name}
          setIsOpen={setIsOpen}
          isValid={false}
          proceed_label={userJutsuMap.get(selectedJutsu.id)?.equipped ? "Unequip" : "Equip"}
          onAccept={() => handleEquip(selectedJutsu)}
        >
          <ItemWithEffects item={selectedJutsu} showStatistic="jutsu" />
        </Modal>
      )}
    </>
  );
} 
