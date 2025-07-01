"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import BanInfo from "@/layout/BanInfo";
import { useRequireInVillage } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal2 from "@/layout/Modal2";
import { ActionSelector } from "@/layout/CombatActions";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import type { Jutsu, Item } from "@/drizzle/schema";
import { OctagonX } from "lucide-react";
import {
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_LOADOUT_MAX_CONSUMABLES,
} from "@/drizzle/constants";
import { QueueTimer } from "@/layout/Countdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * Main ranked arena component for entering/leaving the arena
 * @returns The main ranked arena component
 */
export const RankedArenaMain: React.FC = () => {
  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");
  const utils = api.useUtils();

  // Get queue data
  const { data: queueData } = api.pvpRank.getRankedPvpQueue.useQuery(undefined, {
    enabled: !!userData,
    refetchInterval: 5000, // Refetch queue status every 5 seconds
  });

  // Get current season
  const { data: currentSeason } = api.pvpRank.getCurrentSeason.useQuery();

  // Get ranked loadout
  const { data: rankedLoadout } = api.pvpRank.getRankedLoadout.useQuery();

  // Queue for ranked PvP
  const { mutate: queue, isPending: isQueuing } =
    api.pvpRank.queueForRankedPvp.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.pvpRank.getRankedPvpQueue.invalidate();
        }
      },
    });

  // Leave queue for ranked PvP
  const { mutate: leaveQueue, isPending: isLeaving } =
    api.pvpRank.leaveRankedPvpQueue.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.pvpRank.getRankedPvpQueue.invalidate();
        }
      },
    });

  // Check for any matches – guard concurrent requests with a ref
  const isCheckingRef = useRef(false);

  const { mutate: checkForMatches } = api.pvpRank.checkRankedPvpMatches.useMutation({
    // Mark the request as in-flight before it starts
    onMutate: () => {
      isCheckingRef.current = true;
    },
    // Clear the in-flight flag regardless of outcome
    onSettled: () => {
      isCheckingRef.current = false;
    },
    onSuccess: (data) => {
      if (data.message) {
        showMutationToast(data);
      }
      if (data.success) {
        void utils.pvpRank.getRankedPvpQueue.invalidate();
      }
    },
  });

  // Periodically check for ranked PvP matches while queued
  useEffect(() => {
    // Only start polling when the user is actively in the queue
    if (!queueData?.inQueue) return;

    // Set up an interval to run every 5 seconds (5000 ms)
    const intervalId = setInterval(() => {
      // Avoid overlapping requests by inspecting the ref
      if (!isCheckingRef.current) {
        checkForMatches();
      }
    }, 5000);

    // Clear the interval when the component unmounts or the user leaves the queue
    return () => clearInterval(intervalId);
    // We deliberately omit `isCheckingRef` from the dependency array because the ref doesn't change between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueData?.inQueue, checkForMatches]);

  // Guards
  if (!userData) return <Loader explanation="Loading user" />;
  if (!access) return <Loader explanation="Accessing Ranked PvP" />;
  if (!currentSeason) return <Loader explanation="Searching for Season to Start" />;
  if (userData.isBanned) return <BanInfo />;

  // Process loadout
  const equippedJutsu = rankedLoadout?.loadout.jutsuIds.length ?? 0;
  const equippedWeapons = rankedLoadout?.loadout.weaponIds.length ?? 0;
  const equippedConsumables = rankedLoadout?.loadout.consumableIds.length ?? 0;

  return (
    <div className="flex flex-col items-center gap-4 p-3">
      <p className="text-sm text-muted-foreground">
        Queue for ranked PvP battles! You will be matched with players of similar LP.
        All battles are fought with level 100 characters with max stats.
      </p>
      <p className="text-sm text-muted-foreground">
        Current LP: <b>{userData.rankedLp}</b> | Players in queue:{" "}
        <b>{queueData?.queueCount ?? 0}</b>
      </p>
      <p className="text-sm font-medium">
        Selected Jutsu: {equippedJutsu}/{RANKED_LOADOUT_MAX_JUTSUS} | Weapons:{" "}
        {equippedWeapons}/{RANKED_LOADOUT_MAX_WEAPONS} | Consumables:{" "}
        {equippedConsumables}/{RANKED_LOADOUT_MAX_CONSUMABLES}
      </p>
      {queueData?.inQueue && (
        <p className="text-orange-500">
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
                message:
                  "You cannot queue while in battle. Please finish your current battle first.",
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
        <Button className="w-full" onClick={() => leaveQueue()} disabled={isLeaving}>
          {isLeaving ? "Leaving..." : "Leave Queue"}
        </Button>
      )}
    </div>
  );
};

/**
 * Component for selecting a ranked loadout
 * @returns The ranked loadout selector component
 */
export const RankedLoadoutSelector: React.FC = () => {
  // Router for forwarding
  const utils = api.useUtils();

  // Two-level filtering for jutsu
  const state = useFiltering();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedJutsu, setSelectedJutsu] = useState<Jutsu | undefined>(undefined);

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // Track which tab is active
  const [activeTab, setActiveTab] = useState<"weapons" | "consumables" | "jutsu">(
    "weapons",
  );

  // Get items and loadout data – only fetch for the currently active tab
  const { data: currentSeason } = api.pvpRank.getCurrentSeason.useQuery();

  const { data: weapons, isFetching: isLoadingWeapons } = api.item.getAll.useQuery(
    {
      itemType: "WEAPON",
      limit: 100,
      onlyInShop: true,
      eventItems: false,
      minRepsCost: 0,
    },
    {
      enabled: activeTab === "weapons",
    },
  );

  const { data: consumables, isFetching: isLoadingConsumables } =
    api.item.getAll.useQuery(
      {
        itemType: "CONSUMABLE",
        limit: 100,
        onlyInShop: true,
        eventItems: false,
        minRepsCost: 0,
      },
      {
        enabled: activeTab === "consumables",
      },
    );

  const {
    data: allJutsu,
    isFetching: isLoadingJutsu,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAll.useInfiniteQuery(
    { limit: 100, hideAi: true, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      // Only fetch jutsu when the user actually opens the jutsu tab
      enabled: !!userData && activeTab === "jutsu",
    },
  );

  const { data: rankedLoadout } = api.pvpRank.getRankedLoadout.useQuery();

  // Loadout updating
  const updateLoadout = api.pvpRank.updateRankedLoadout.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      void utils.pvpRank.getRankedLoadout.invalidate();
    },
  });

  // Filter out items that cost reputation
  const filteredWeapons = weapons?.data.filter((weapon) => weapon.repsCost === 0);
  const filteredConsumables = consumables?.data.filter(
    (consumable) => consumable.repsCost === 0,
  );

  // Get all jutsu and user jutsu data

  // Auto-paginate when the jutsu tab is active
  useEffect(() => {
    if (activeTab === "jutsu" && hasNextPage) {
      void fetchNextPage();
    }
  }, [activeTab, hasNextPage, fetchNextPage]);

  // Get number of equipped jutsus, weapons and items
  const loadoutJutsus = rankedLoadout?.loadout.jutsuIds ?? [];
  const loadoutWeapons = rankedLoadout?.loadout.weaponIds ?? [];
  const loadoutConsumables = rankedLoadout?.loadout.consumableIds ?? [];

  // Handle jutsu equipping
  const handleToggleJutsu = (jutsu: Jutsu) => {
    if (!rankedLoadout) return;
    const alreadyEquipped = loadoutJutsus.includes(jutsu.id);
    updateLoadout.mutate({
      ...rankedLoadout.loadout,
      jutsuIds: !alreadyEquipped
        ? [...loadoutJutsus, jutsu.id]
        : loadoutJutsus.filter((id) => id !== jutsu.id),
    });
  };

  const handleToggleWeapon = (weapon: Item) => {
    if (!rankedLoadout) return;
    const alreadyEquipped = loadoutWeapons.includes(weapon.id);
    updateLoadout.mutate({
      ...rankedLoadout.loadout,
      weaponIds: !alreadyEquipped
        ? [...loadoutWeapons, weapon.id]
        : loadoutWeapons.filter((id) => id !== weapon.id),
    });
  };

  const handleToggleConsumable = (consumable: Item) => {
    if (!rankedLoadout) return;
    const alreadyEquipped = loadoutConsumables.includes(consumable.id);
    updateLoadout.mutate({
      ...rankedLoadout.loadout,
      consumableIds: !alreadyEquipped
        ? [...loadoutConsumables, consumable.id]
        : loadoutConsumables.filter((id) => id !== consumable.id),
    });
  };

  const handleUnequipAll = () => {
    if (!rankedLoadout) return;
    updateLoadout.mutate({
      ...rankedLoadout.loadout,
      jutsuIds: [],
      weaponIds: [],
      consumableIds: [],
    });
  };

  // Process data
  const flatJutsu = allJutsu?.pages.flatMap((page) => page.data) ?? [];
  const equippedItems = rankedLoadout
    ? [...rankedLoadout.loadout.weaponIds, ...rankedLoadout.loadout.consumableIds]
    : [];
  const processedJutsu = flatJutsu
    .map((jutsu) => ({ ...jutsu, highlight: loadoutJutsus.includes(jutsu.id) }))
    .filter((jutsu) => jutsu.jutsuType === "NORMAL")
    .sort((a, b) => {
      const aIndex = loadoutJutsus.indexOf(a.id) ?? -1;
      const bIndex = loadoutJutsus.indexOf(b.id) ?? -1;
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

  // State for item selection
  const [selectedItem, setSelectedItem] = useState<Item | undefined>(undefined);
  const [isItemModalOpen, setIsItemModalOpen] = useState<boolean>(false);

  // Guards
  if (!access) return <Loader explanation="Accessing Ranked PvP" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData?.isBanned) return <BanInfo />;
  if (!currentSeason) return null;

  return (
    <>
      <ContentBox
        title="Ranked Loadout"
        subtitle={`Select up to ${RANKED_LOADOUT_MAX_WEAPONS} weapons, ${RANKED_LOADOUT_MAX_CONSUMABLES} consumables and ${RANKED_LOADOUT_MAX_JUTSUS} jutsu`}
        initialBreak={true}
        topRightContent={
          activeTab === "jutsu" && !isOpen ? (
            <div className="flex flex-row items-center gap-2">
              <JutsuFiltering state={state} />
            </div>
          ) : undefined
        }
        bottomRightContent={
          activeTab === "jutsu" ? (
            <Button onClick={() => handleUnequipAll()}>
              <OctagonX className="h-6 w-6 mr-2" />
              Unequip All
            </Button>
          ) : undefined
        }
      >
        <Tabs
          value={activeTab}
          onValueChange={(val) =>
            setActiveTab(val as "weapons" | "consumables" | "jutsu")
          }
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="weapons">Weapons</TabsTrigger>
            <TabsTrigger value="consumables">Consumables</TabsTrigger>
            <TabsTrigger value="jutsu">Jutsu</TabsTrigger>
          </TabsList>

          {/* Weapons */}
          <TabsContent value="weapons">
            {isLoadingWeapons && <Loader explanation="Loading Weapons" />}
            <ActionSelector
              items={filteredWeapons?.map((weapon) => ({
                ...weapon,
                highlight: rankedLoadout?.loadout.weaponIds.includes(weapon.id),
              }))}
              selectedId={selectedItem?.id}
              showBgColor={false}
              showLabels={false}
              onClick={(id) => {
                const item = filteredWeapons?.find((w) => w.id === id);
                if (item) {
                  setSelectedItem(item);
                  setIsItemModalOpen(true);
                }
              }}
            />
          </TabsContent>

          {/* Consumables */}
          <TabsContent value="consumables">
            {isLoadingConsumables && <Loader explanation="Loading Consumables" />}
            <ActionSelector
              items={filteredConsumables?.map((consumable) => ({
                ...consumable,
                highlight: rankedLoadout?.loadout.consumableIds.includes(consumable.id),
              }))}
              selectedId={selectedItem?.id}
              showBgColor={false}
              showLabels={false}
              onClick={(id) => {
                const item = filteredConsumables?.find((c) => c.id === id);
                if (item) {
                  setSelectedItem(item);
                  setIsItemModalOpen(true);
                }
              }}
            />
          </TabsContent>

          {/* Jutsu */}
          <TabsContent value="jutsu">
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
          </TabsContent>
        </Tabs>
      </ContentBox>

      {/* Item Modal */}
      {isItemModalOpen && selectedItem && (
        <Modal2
          title={selectedItem.name}
          isOpen={isItemModalOpen}
          setIsOpen={setIsItemModalOpen}
          isValid={false}
          proceed_label={equippedItems.includes(selectedItem.id) ? "Unequip" : "Equip"}
          onAccept={() => {
            if (selectedItem.itemType === "WEAPON") {
              handleToggleWeapon(selectedItem);
            } else {
              handleToggleConsumable(selectedItem);
            }
            setIsItemModalOpen(false);
            setSelectedItem(undefined);
          }}
        >
          <div className="flex flex-col gap-4">
            <ItemWithEffects item={selectedItem} showStatistic="item" />
          </div>
        </Modal2>
      )}

      {/* Jutsu Modal */}
      {isOpen && selectedJutsu && (
        <Modal2
          title={selectedJutsu.name}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          proceed_label={loadoutJutsus.includes(selectedJutsu.id) ? "Unequip" : "Equip"}
          onAccept={() => {
            handleToggleJutsu(selectedJutsu);
            setIsOpen(false);
            setSelectedJutsu(undefined);
          }}
        >
          <ItemWithEffects item={selectedJutsu} showStatistic="jutsu" />
        </Modal2>
      )}
    </>
  );
};
