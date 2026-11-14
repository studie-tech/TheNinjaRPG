"use client";

import { Loader2, OctagonX, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_WEAPONS,
} from "@/drizzle/constants";
import type { Item, Jutsu } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import BanInfo from "@/layout/BanInfo";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuFiltering, { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import {
  buildJutsuEquipCaps,
  getJutsuCapFlags,
  getJutsuCategoryDef,
} from "@/libs/jutsu";
import { validateItemLoadout, validateJutsuLoadout } from "@/libs/ranked_pvp";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import { useRequireInVillage } from "@/utils/UserContext";
import type { RankedLoadoutSchema } from "@/validators/pvpRank";

type RankedLoadoutSaveKind =
  | "unequip-all"
  | "favorite-jutsu"
  | "favorite-weapon"
  | "favorite-consumable"
  | "equip-jutsu"
  | "equip-weapon"
  | "equip-consumable";

interface RankedLoadoutSaveSnapshot {
  userId: string;
  loadoutId: string;
  kind: RankedLoadoutSaveKind;
  targetId: string | null;
  loadout: RankedLoadoutSchema;
}

/**
 * Component for selecting a ranked loadout
 * @returns The ranked loadout selector component
 */
export const RankedLoadoutSelector: React.FC = () => {
  const limitsQuery = api.misc.getJutsuEquipLimits.useQuery();
  const caps = buildJutsuEquipCaps(limitsQuery.data ?? [], "ranked");
  const utils = api.useUtils();

  // Two-level filtering for jutsu
  const state = useFiltering();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedJutsu, setSelectedJutsu] = useState<Jutsu | undefined>(undefined);
  const [selectedItem, setSelectedItem] = useState<Item | undefined>(undefined);
  const [isItemModalOpen, setIsItemModalOpen] = useState<boolean>(false);

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // Track which tab is active
  const [activeTab, setActiveTab] = useState<"weapons" | "consumables" | "jutsu">(
    "weapons",
  );

  const { data: weapons, isFetching: isLoadingWeapons } = api.item.getAll.useQuery(
    { itemType: "WEAPON", ...RANKED_SHOP_ITEMS },
    {
      enabled: activeTab === "weapons",
    },
  );

  const { data: consumables, isFetching: isLoadingConsumables } =
    api.item.getAll.useQuery(
      { itemType: "CONSUMABLE", ...RANKED_SHOP_ITEMS },
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

  // All seven controls replace the same JSON document, so they share one editor-scoped lock.
  const updateLoadout = api.pvpRank.updateRankedLoadout.useMutation({
    meta: { handlesTransportError: true },
  });
  const saveFlight = useSingleFlight<RankedLoadoutSaveSnapshot>();
  const pendingSave = saveFlight.pending;
  const isSaving = saveFlight.isPending;

  const saveLoadout = async (
    loadout: RankedLoadoutSchema,
    kind: RankedLoadoutSaveKind,
    targetId: string | null,
  ) => {
    if (!rankedLoadout || !userData) return false;

    const snapshot: RankedLoadoutSaveSnapshot = {
      userId: userData.userId,
      loadoutId: rankedLoadout.id,
      kind,
      targetId,
      loadout,
    };

    const saved = await saveFlight.run(snapshot, async () => {
      try {
        const result = await updateLoadout.mutateAsync({
          ...snapshot.loadout,
        });
        if (!saveFlight.owns(snapshot)) return false;

        if (!result.success) {
          showMutationToast(result);
          return false;
        }
        showMutationToast(result);

        if (kind === "equip-weapon" || kind === "equip-consumable") {
          setIsItemModalOpen(false);
          setSelectedItem((current) =>
            current?.id === targetId ? undefined : current,
          );
        } else if (kind === "equip-jutsu") {
          setIsOpen(false);
          setSelectedJutsu((current) =>
            current?.id === targetId ? undefined : current,
          );
        }
        void utils.pvpRank.getRankedLoadout.invalidate();
        return true;
      } catch (error) {
        showRetryableErrorToast(
          error,
          "Could not save the ranked loadout. Check your connection and retry.",
        );
        return false;
      }
    });
    return saved ?? false;
  };

  // Ignore a late response if the authenticated user or selected loadout changes underneath it.
  useEffect(() => {
    const pending = saveFlight.current();
    if (
      pending &&
      (pending.userId !== userData?.userId || pending.loadoutId !== rankedLoadout?.id)
    ) {
      saveFlight.release();
    }
  }, [rankedLoadout?.id, userData?.userId]);

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

  // Get favorite arrays
  const favoriteJutsus = rankedLoadout?.loadout.favoriteJutsuIds ?? [];
  const favoriteWeapons = rankedLoadout?.loadout.favoriteWeaponIds ?? [];
  const favoriteConsumables = rankedLoadout?.loadout.favoriteConsumableIds ?? [];

  const handleUnequipAll = () => {
    if (!rankedLoadout || saveFlight.current()) return;
    void saveLoadout(
      {
        ...rankedLoadout.loadout,
        jutsuIds: [],
        weaponIds: [],
        consumableIds: [],
      },
      "unequip-all",
      null,
    );
  };

  // Process data with favorite sorting. Restricted items/jutsu are hidden unless
  // already equipped so players can unequip them before queueing.
  const filteredWeapons =
    weapons?.data.filter((weapon) => isRankedItemShown(weapon, loadoutWeapons)) || [];
  const filteredConsumables =
    consumables?.data.filter((consumable) =>
      isRankedItemShown(consumable, loadoutConsumables),
    ) || [];
  const flatJutsu = allJutsu?.pages.flatMap((page) => page.data) ?? [];
  const equippedItems = rankedLoadout
    ? [...rankedLoadout.loadout.weaponIds, ...rankedLoadout.loadout.consumableIds]
    : [];

  // Sort items with equipped first, then favorites, then normal ordering
  const sortedWeapons = filteredWeapons.sort(
    equippedThenFavorite(loadoutWeapons, favoriteWeapons),
  );
  const sortedConsumables = filteredConsumables.sort(
    equippedThenFavorite(loadoutConsumables, favoriteConsumables),
  );

  const processedJutsu = flatJutsu
    .map((jutsu) => ({
      ...jutsu,
      highlight: loadoutJutsus.includes(jutsu.id),
      isFavorite: favoriteJutsus.includes(jutsu.id),
    }))
    .filter((jutsu) => jutsu.jutsuType === "NORMAL")
    .filter((jutsu) => !jutsu.effects.some((e) => e.type === "summon")) // Exclude summon jutsu from ranked
    // Skill-gated / PVE-only / village jutsu stay visible only when already equipped
    .filter((jutsu) => !jutsu.requiredSkillId || loadoutJutsus.includes(jutsu.id))
    .filter(
      (jutsu) => jutsu.battleUsageType !== "PVE" || loadoutJutsus.includes(jutsu.id),
    )
    .filter((jutsu) => !jutsu.villageId || loadoutJutsus.includes(jutsu.id))
    .sort(equippedThenFavorite(loadoutJutsus, favoriteJutsus, true));

  // Handle favorite toggling
  const handleToggleFavorite = (kind: keyof typeof FAVORITE_FIELDS, id: string) => {
    if (!rankedLoadout || saveFlight.current()) return;
    const field = FAVORITE_FIELDS[kind];
    void saveLoadout(
      {
        ...rankedLoadout.loadout,
        [field]: toggleId(rankedLoadout.loadout[field] ?? [], id),
      },
      kind,
      id,
    );
  };

  // Handle jutsu equipping
  const handleToggleJutsu = (jutsu: Jutsu) => {
    if (!rankedLoadout || saveFlight.current()) return;
    const alreadyEquipped = loadoutJutsus.includes(jutsu.id);

    // If equipping (not unequipping), check limits
    if (!alreadyEquipped) {
      if (limitsQuery.data === undefined) return;
      const newJutsuLoadout = processedJutsu.filter((j) =>
        [...loadoutJutsus, jutsu.id].includes(j.id),
      );
      const jutsuCheck = validateJutsuLoadout(newJutsuLoadout, caps);
      if (!jutsuCheck.check) {
        showMutationToast({
          success: false,
          message: jutsuCheck.message,
        });
        return;
      }
    }

    void saveLoadout(
      {
        ...rankedLoadout.loadout,
        jutsuIds: toggleId(loadoutJutsus, jutsu.id),
      },
      "equip-jutsu",
      jutsu.id,
    );
  };

  /** Validate new item in terms of loadout constraints */
  const validateNewItemLoadout = (newItem: Item) => {
    const newItemLoadout = [...filteredWeapons, ...filteredConsumables].filter((item) =>
      [...loadoutWeapons, ...loadoutConsumables, newItem.id].includes(item.id),
    );
    const itemCheck = validateItemLoadout(newItemLoadout);
    if (!itemCheck.check) {
      showMutationToast({
        success: false,
        message: itemCheck.message,
      });
      return false;
    }
    return true;
  };

  const handleToggleWeapon = (weapon: Item) => {
    if (!rankedLoadout || saveFlight.current()) return;
    const alreadyEquipped = loadoutWeapons.includes(weapon.id);

    // If equipping (not unequipping), check limits
    if (!alreadyEquipped) {
      const check = validateNewItemLoadout(weapon);
      if (!check) return;
    }

    void saveLoadout(
      {
        ...rankedLoadout.loadout,
        weaponIds: toggleId(loadoutWeapons, weapon.id),
      },
      "equip-weapon",
      weapon.id,
    );
  };

  const handleToggleConsumable = (consumable: Item) => {
    if (!rankedLoadout || saveFlight.current()) return;
    const alreadyEquipped = loadoutConsumables.includes(consumable.id);

    // If equipping (not unequipping), check limits
    if (!alreadyEquipped) {
      const check = validateNewItemLoadout(consumable);
      if (!check) return;
    }

    void saveLoadout(
      {
        ...rankedLoadout.loadout,
        consumableIds: toggleId(loadoutConsumables, consumable.id),
      },
      "equip-consumable",
      consumable.id,
    );
  };

  // Guards
  if (!access) return <Loader explanation="Accessing Ranked PvP" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData?.isBanned) return <BanInfo />;

  return (
    <>
      <div aria-busy={isSaving}>
        {pendingSave && (
          <div
            className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-blue-400/50 bg-blue-950/40 px-3 py-2 text-sm text-blue-100"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving
          </div>
        )}
        <div className={isSaving ? "pointer-events-none opacity-60" : undefined}>
          <ContentBox
            title="Ranked Loadout"
            subtitle={`Select up to ${RANKED_LOADOUT_MAX_WEAPONS} weapons, ${RANKED_LOADOUT_MAX_CONSUMABLES} consumables and ${RANKED_LOADOUT_MAX_JUTSUS} jutsu`}
            initialBreak={true}
            topRightContent={
              activeTab === "jutsu" && !isOpen ? (
                <div className="flex flex-row items-center gap-2">
                  <JutsuFiltering state={state} disabled={isSaving} />
                </div>
              ) : undefined
            }
            bottomRightContent={
              activeTab === "jutsu" ? (
                <Button onClick={() => handleUnequipAll()} disabled={isSaving}>
                  {pendingSave?.kind === "unequip-all" ? (
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                  ) : (
                    <OctagonX className="mr-2 h-6 w-6" />
                  )}
                  {pendingSave?.kind === "unequip-all" ? "Saving" : "Unequip All"}
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
                <TabsTrigger value="weapons" disabled={isSaving}>
                  Weapons
                </TabsTrigger>
                <TabsTrigger value="consumables" disabled={isSaving}>
                  Consumables
                </TabsTrigger>
                <TabsTrigger value="jutsu" disabled={isSaving}>
                  Jutsu
                </TabsTrigger>
              </TabsList>

              {/* Weapons */}
              <TabsContent value="weapons">
                {isLoadingWeapons && <Loader explanation="Loading Weapons" />}
                <ActionSelector
                  items={sortedWeapons?.map((weapon) => ({
                    ...weapon,
                    highlight: rankedLoadout?.loadout.weaponIds.includes(weapon.id),
                    isFavorite: favoriteWeapons.includes(weapon.id),
                  }))}
                  selectedId={selectedItem?.id}
                  showBgColor={false}
                  showLabels={false}
                  onClick={(id) => {
                    if (saveFlight.current()) return;
                    const item = sortedWeapons?.find((w) => w.id === id);
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
                  items={sortedConsumables?.map((consumable) => ({
                    ...consumable,
                    highlight: rankedLoadout?.loadout.consumableIds.includes(
                      consumable.id,
                    ),
                    isFavorite: favoriteConsumables.includes(consumable.id),
                  }))}
                  selectedId={selectedItem?.id}
                  showBgColor={false}
                  showLabels={false}
                  onClick={(id) => {
                    if (saveFlight.current()) return;
                    const item = sortedConsumables?.find((c) => c.id === id);
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
                    if (saveFlight.current()) return;
                    setSelectedJutsu(processedJutsu?.find((jutsu) => jutsu.id === id));
                    setIsOpen(true);
                  }}
                  isLoading={isLoadingJutsu}
                  emptyText="No jutsu match the current filters."
                />
              </TabsContent>
            </Tabs>
          </ContentBox>
        </div>
      </div>

      {/* Item Modal */}
      {isItemModalOpen && selectedItem && (
        <Modal
          title={selectedItem.name}
          isOpen={isItemModalOpen}
          setIsOpen={setIsItemModalOpen}
          isLoading={isSaving}
          keepOpenOnAccept={true}
          proceed_label={equippedItems.includes(selectedItem.id) ? "Unequip" : "Equip"}
          proceed_loading_label="Saving"
          onAccept={() => {
            if (selectedItem.itemType === "WEAPON") {
              handleToggleWeapon(selectedItem);
            } else {
              handleToggleConsumable(selectedItem);
            }
          }}
        >
          <div className="flex flex-col gap-4">
            <ItemWithEffects item={selectedItem} showStatistic="item" />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() =>
                  handleToggleFavorite(
                    selectedItem.itemType === "WEAPON"
                      ? "favorite-weapon"
                      : "favorite-consumable",
                    selectedItem.id,
                  )
                }
                className="flex items-center gap-2"
              >
                {pendingSave?.targetId === selectedItem.id &&
                (pendingSave.kind === "favorite-weapon" ||
                  pendingSave.kind === "favorite-consumable") ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Star
                      className={`h-4 w-4 ${(selectedItem.itemType === "WEAPON" ? favoriteWeapons.includes(selectedItem.id) : favoriteConsumables.includes(selectedItem.id)) ? "fill-yellow-400 text-yellow-400" : "text-gray-400"}`}
                    />
                    {(
                      selectedItem.itemType === "WEAPON"
                        ? favoriteWeapons.includes(selectedItem.id)
                        : favoriteConsumables.includes(selectedItem.id)
                    )
                      ? "Unfavorite"
                      : "Favorite"}
                  </>
                )}
              </Button>
            </div>
            {!equippedItems.includes(selectedItem.id) &&
              selectedItem.effects.some((e) => e.type === "poison") && (
                <div className="text-muted-foreground text-sm">
                  <p>
                    ⚠️ This is a poison item. You can equip up to{" "}
                    {RANKED_LOADOUT_MAX_POISON_ITEMS} poison item in ranked PvP.
                  </p>
                </div>
              )}
            {!equippedItems.includes(selectedItem.id) &&
              selectedItem.effects.some((e) => e.type === "increasepoolcost") && (
                <div className="text-muted-foreground text-sm">
                  <p>
                    ⚠️ This is an increasecost item. You can equip up to{" "}
                    {RANKED_LOADOUT_MAX_INCREASECOST_ITEMS} increasecost item in ranked
                    PvP.
                  </p>
                </div>
              )}
          </div>
        </Modal>
      )}

      {/* Jutsu Modal */}
      {isOpen && selectedJutsu && (
        <Modal
          title={selectedJutsu.name}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isLoading={isSaving}
          keepOpenOnAccept={true}
          proceed_label={loadoutJutsus.includes(selectedJutsu.id) ? "Unequip" : "Equip"}
          proceedDisabled={
            !loadoutJutsus.includes(selectedJutsu.id) && limitsQuery.data === undefined
          }
          proceed_loading_label="Saving"
          onAccept={() => {
            handleToggleJutsu(selectedJutsu);
          }}
        >
          <div className="flex flex-col gap-4">
            <ItemWithEffects item={selectedJutsu} showStatistic="jutsu" />
            {limitsQuery.data === undefined &&
              (limitsQuery.isError ? (
                <div role="alert" className="text-sm">
                  <p>Could not load jutsu limits.</p>
                  <Button
                    variant="outline"
                    disabled={limitsQuery.isFetching}
                    onClick={() => void limitsQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <p role="status" className="text-muted-foreground text-sm">
                  Loading jutsu limits
                </p>
              ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => handleToggleFavorite("favorite-jutsu", selectedJutsu.id)}
                className="flex items-center gap-2"
              >
                {pendingSave?.kind === "favorite-jutsu" &&
                pendingSave.targetId === selectedJutsu.id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Star
                      className={`h-4 w-4 ${favoriteJutsus.includes(selectedJutsu.id) ? "fill-yellow-400 text-yellow-400" : "text-gray-400"}`}
                    />
                    {favoriteJutsus.includes(selectedJutsu.id)
                      ? "Unfavorite"
                      : "Favorite"}
                  </>
                )}
              </Button>
            </div>
            {!loadoutJutsus.includes(selectedJutsu.id) &&
              caps.map((cap) => {
                const key = cap.key;
                const flags = getJutsuCapFlags(selectedJutsu);
                if (!flags[key]) return null;

                const label = getJutsuCategoryDef(key).label;
                return (
                  <div key={key} className="text-muted-foreground text-sm">
                    <p>
                      ⚠️ This is a {label} jutsu. You can equip up to {cap.max} {label}{" "}
                      jutsu in ranked PvP.
                    </p>
                  </div>
                );
              })}
          </div>
        </Modal>
      )}
    </>
  );
};

/** Ranked battles draw from free shop items only. */
const RANKED_SHOP_ITEMS = {
  limit: 100,
  onlyInShop: true,
  eventItems: false,
  minRepsCost: 0,
  maxSeichiSilverCost: 0,
};

/** Loadout field behind each favorite save. */
const FAVORITE_FIELDS = {
  "favorite-jutsu": "favoriteJutsuIds",
  "favorite-weapon": "favoriteWeaponIds",
  "favorite-consumable": "favoriteConsumableIds",
} as const;

/** Add an id, or remove it when already present. */
const toggleId = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];

/** Restricted items stay listed once equipped, so they can be taken off before queueing. */
const isRankedItemShown = (item: Item, equippedIds: string[]) =>
  item.repsCost === 0 &&
  (!item.requiredSkillId || equippedIds.includes(item.id)) &&
  (!item.bloodlineId || equippedIds.includes(item.id));

/** Order equipped entries first, then favorites; other ties keep their incoming order. */
const equippedThenFavorite =
  (equippedIds: string[], favoriteIds: string[], keepLoadoutOrder = false) =>
  (a: { id: string }, b: { id: string }) => {
    const aIsEquipped = equippedIds.includes(a.id);
    const bIsEquipped = equippedIds.includes(b.id);
    if (aIsEquipped !== bIsEquipped) return aIsEquipped ? -1 : 1;
    if (keepLoadoutOrder && aIsEquipped) {
      return equippedIds.indexOf(a.id) - equippedIds.indexOf(b.id);
    }
    const aIsFavorite = favoriteIds.includes(a.id);
    const bIsFavorite = favoriteIds.includes(b.id);
    if (aIsFavorite !== bIsFavorite) return aIsFavorite ? -1 : 1;
    return 0;
  };
