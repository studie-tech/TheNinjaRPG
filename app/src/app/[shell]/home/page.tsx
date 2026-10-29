"use client";

import {
  BadgeMinus,
  BadgePlus,
  ChefHat,
  Hammer,
  Home,
  House,
  MinusCircle,
  Package,
  PawPrint,
  Pencil,
  PlusCircle,
  ShoppingBag,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HomeTypeDetails,
  IMG_HOME_KITCHEN,
  ITEM_LEVEL_CAP,
  ItemRarities,
  ItemTypes,
  MAP_WAKE_ISLAND_SECTOR,
  PET_SANCTUARY_NAME,
} from "@/drizzle/constants";
import type { UserItemWithItem, UserItemWithRelations } from "@/drizzle/schema";
import { useSleepToggle } from "@/hooks/sleep";
import BanInfo from "@/layout/BanInfo";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import { type HomeDraft, HomeScene } from "@/layout/HomeScene";
import { HomeSharing } from "@/layout/HomeSharing";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { MergeAllStacksButton } from "@/layout/MergeAllStacksButton";
import Modal from "@/layout/Modal";
import { getHomeRooms } from "@/libs/homeProperty";
import {
  byItemName,
  calcMaxHouseCookingItems,
  calcMaxHouseMaterials,
  finishedImbuementItems,
  getHomeStorageBucket,
  showsItemLevelBadge,
  userItemActionBadges,
} from "@/libs/item";
import { showMutationToast } from "@/libs/toast";
import { remainingXpToLevel } from "@/libs/train";
import { useRequireInVillage } from "@/utils/UserContext";
import { getStrucBoost } from "@/utils/village";

// Load the farm and food menu only when their dialogs are opened.
const HomeFarm = dynamic(() => import("@/layout/OccupationFarming"), {
  loading: () => <Loader explanation="Loading farm" />,
});
const HomeKitchen = dynamic(() => import("@/layout/Kitchen"), {
  loading: () => <Loader explanation="Loading kitchen" />,
});

/** Keep the residence's query-driven dialogs behind the same boundary as other deep links. */
export default function HomePage() {
  return (
    <Suspense fallback={<Loader explanation="Loading home" />}>
      <Residence />
    </Suspense>
  );
}

/** Residence hub for shared sleep actions and owner-only storage and home management. */
function Residence() {
  const { userData, sectorVillage, access, ownVillage } = useRequireInVillage("/home");
  const router = useRouter();
  const searchParams = useSearchParams();
  const canOpenKitchen = !!userData && access && ownVillage;

  // State
  const [selectedItem, setSelectedItem] = useState<UserItemWithRelations | undefined>(
    undefined,
  );
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [isFarmOpen, setIsFarmOpen] = useState(false);
  const [isKitchenOpen, setIsKitchenOpen] = useState(false);
  const [isDecorating, setIsDecorating] = useState(false);
  const [furnitureError, setFurnitureError] = useState<string | null>(null);
  // Either a scene hotspot or a text control can open each dialog.
  const storageTriggerRef = useRef<HTMLButtonElement>(null);
  const managementTriggerRef = useRef<HTMLButtonElement>(null);
  const farmTriggerRef = useRef<HTMLButtonElement>(null);
  const kitchenTriggerRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState("ALL");
  const [rarityFilter, setRarityFilter] = useState("ALL");

  // Deep links use the existing owner-only kitchen and are consumed so closing stays final.
  useEffect(() => {
    if (!canOpenKitchen || searchParams.get("panel") !== "kitchen") return;
    setIsKitchenOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    const query = params.toString();
    router.replace(query ? `/home?${query}` : "/home", { scroll: false });
  }, [canOpenKitchen, router, searchParams]);

  // Guests use common navigation without fetching owner-only data; hooks stay unconditional.
  const {
    data: homeData,
    isLoading: isHomeLoading,
    isFetching: isHomeFetching,
    isError: isHomeError,
    refetch: userHomeRefetch,
  } = api.home.getUserHome.useQuery(undefined, {
    enabled: !!userData && access && ownVillage,
    staleTime: 0,
  });
  const {
    data: availableUpgrades,
    isLoading: isUpgradesLoading,
    isError: isUpgradesError,
    refetch: upgradesRefetch,
  } = api.home.getAvailableUpgrades.useQuery(undefined, {
    enabled: !!userData && access && ownVillage,
  });
  const {
    data: userItems,
    isLoading: isItemsLoading,
    isFetching: isItemsFetching,
    isError: isItemsError,
    refetch: userItemsRefetch,
  } = api.item.getUserItems.useQuery(undefined, {
    enabled: !!userData && access && ownVillage,
  });
  const pets = api.pets.getCollection.useQuery(undefined, {
    enabled: !!userData && access && ownVillage,
  });

  const missingFurnitureIds =
    userData && access && ownVillage && userItems
      ? (homeData?.furniture
          .filter((piece) => !userItems.some((owned) => owned.id === piece.id))
          .map((piece) => piece.id)
          .sort()
          .join(",") ?? "")
      : "";
  // Home and inventory queries can return different ownership snapshots. Refresh once for each
  // missing-ID set while keeping an incomplete response retryable; refetch cancellation also
  // replaces any in-flight stale inventory read.
  useEffect(() => {
    if (missingFurnitureIds) void userItemsRefetch();
  }, [missingFurnitureIds, userItemsRefetch]);

  // Mutations
  const { mutate: upgradeHome, isPending: isUpgrading } =
    api.home.upgradeHome.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void userHomeRefetch();
          void upgradesRefetch();
          void userItemsRefetch();
        }
      },
    });

  const { mutate: toggleStoreItem, isPending: isTogglingStoreItem } =
    api.home.toggleStoreItem.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        // Keep item details open after a rejection so the player can read feedback and retry.
        if (data.success) {
          void userHomeRefetch();
          void userItemsRefetch();
          setIsModalOpen(false);
          setSelectedItem(undefined);
        }
      },
    });

  const { toggleSleep, isTogglingSleep } = useSleepToggle();
  const saveFurniture = api.home.saveFurnitureLayout.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (!result.success) {
        setFurnitureError(result.message);
        await userHomeRefetch();
        return;
      }
      // Keep the editor disabled until its saved layout, revision and storage are refreshed.
      await Promise.all([userHomeRefetch(), userItemsRefetch()]);
    },
  });
  /** Keep unsaved edits available on rejection and refresh the server revision for recovery. */
  const saveLayout = async (draft: HomeDraft) => {
    setFurnitureError(null);
    try {
      const result = await saveFurniture.mutateAsync(draft);
      return result.success;
    } catch (error) {
      setFurnitureError(
        error instanceof Error
          ? error.message
          : "Unable to save your layout. Try again.",
      );
      return false;
    }
  };

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Residence" />;
  if (userData.isBanned) return <BanInfo />;

  const boost = 1 + getStrucBoost("sleepRegenPerLvl", sectorVillage?.structures);

  const homeType = ownVillage ? (homeData?.homeType ?? userData.homeType) : "NONE";
  const homeName = HomeTypeDetails[homeType].name;
  const homeRegen = homeData ? homeData.regen : 0;
  const homeStorage = homeData ? homeData.storage : 0;
  const filteredItems = userItems?.filter(
    (useritem) =>
      !useritem.craftingFinishedAt || useritem.craftingFinishedAt < new Date(),
  );
  // Filter normal items (non-materials, non-cooking)
  const storedItems =
    filteredItems
      ?.filter(
        (useritem) =>
          useritem.storedAtHome && getHomeStorageBucket(useritem.item) === "normal",
      )
      .sort(byItemName) ?? [];
  const nonStoredItems =
    filteredItems
      ?.filter((useritem) => !useritem.storedAtHome)
      .filter((useritem) => useritem.equipped === "NONE")
      .filter((useritem) =>
        ["normal", "furniture"].includes(getHomeStorageBucket(useritem.item)),
      )
      .sort(byItemName) ?? [];

  // Filter materials separately
  const storedMaterials =
    filteredItems
      ?.filter(
        (useritem) =>
          useritem.storedAtHome && getHomeStorageBucket(useritem.item) === "materials",
      )
      .sort(byItemName) ?? [];
  const nonStoredMaterials =
    filteredItems
      ?.filter((useritem) => !useritem.storedAtHome)
      .filter((useritem) => useritem.equipped === "NONE")
      .filter((useritem) => getHomeStorageBucket(useritem.item) === "materials")
      .sort(byItemName) ?? [];

  // Filter cooking separately
  const storedCooking =
    filteredItems
      ?.filter(
        (useritem) =>
          useritem.storedAtHome && getHomeStorageBucket(useritem.item) === "cooking",
      )
      .sort(byItemName) ?? [];
  const nonStoredCooking =
    filteredItems
      ?.filter((useritem) => !useritem.storedAtHome)
      .filter((useritem) => useritem.equipped === "NONE")
      .filter((useritem) => getHomeStorageBucket(useritem.item) === "cooking")
      .sort(byItemName) ?? [];

  const storedFurniture =
    filteredItems
      ?.filter((owned) => owned.storedAtHome && owned.item.itemType === "FURNITURE")
      .sort(byItemName) ?? [];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesFilters = (userItem: UserItemWithItem) =>
    userItem.item.name.toLowerCase().includes(normalizedSearch) &&
    (itemTypeFilter === "ALL" || userItem.item.itemType === itemTypeFilter) &&
    (rarityFilter === "ALL" || userItem.item.rarity === rarityFilter);
  const visibleStoredFurniture = storedFurniture.filter(matchesFilters);
  const storedFurnitureBadges = userItemActionBadges(storedFurniture);
  const visibleStoredItems = storedItems.filter(matchesFilters);
  const visibleStoredMaterials = storedMaterials.filter(matchesFilters);
  const visibleStoredCooking = storedCooking.filter(matchesFilters);
  const visibleInventoryItems = nonStoredItems.filter(matchesFilters);
  const visibleInventoryMaterials = nonStoredMaterials.filter(matchesFilters);
  const visibleInventoryCooking = nonStoredCooking.filter(matchesFilters);
  const hasActiveFilters =
    searchQuery !== "" || itemTypeFilter !== "ALL" || rarityFilter !== "ALL";

  const maxHouseMaterials =
    userData && homeData ? calcMaxHouseMaterials(userData, homeData.storage) : 0;
  const maxHouseCooking =
    userData && homeData ? calcMaxHouseCookingItems(userData, homeData.storage) : 0;
  const canStoreMoreItems = storedItems.length < homeStorage;
  const canStoreMoreMaterials = storedMaterials.length < maxHouseMaterials;
  const canStoreMoreCooking = storedCooking.length < maxHouseCooking;

  const storedItemBadges = userItemActionBadges(storedItems);
  const storedMaterialBadges = userItemActionBadges(storedMaterials);
  const storedCookingBadges = userItemActionBadges(storedCooking);
  const inventoryItemBadges = userItemActionBadges(nonStoredItems);
  const inventoryMaterialBadges = userItemActionBadges(nonStoredMaterials);
  const inventoryCookingBadges = userItemActionBadges(nonStoredCooking);

  // Filter upgrades and downgrades
  const upgrades = availableUpgrades?.filter((upgrade) => upgrade.isUpgrade) || [];
  const downgrades = availableUpgrades?.filter((upgrade) => !upgrade.isUpgrade) || [];
  const canDecorate =
    ownVillage &&
    userData.sector === userData.village?.sector &&
    !!homeData &&
    !isHomeError;

  const kitchenImage =
    homeData?.furniture.find((piece) => piece.action === "kitchen")?.image ??
    IMG_HOME_KITCHEN;

  return (
    <>
      <ContentBox
        padding={false}
        title={ownVillage ? "Your Home" : "Guest Residence"}
        subtitle={
          ownVillage
            ? `${homeName} · +${boost}% regen sleeping.`
            : "Rest during your visit. Your home storage is in your own village."
        }
        defaultBackHref="/village"
        topRightContent={
          ownVillage && (
            <div className="flex gap-1 pb-1 pl-2">
              {canDecorate && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Decorate"
                  hoverText="Decorate"
                  aria-pressed={isDecorating}
                  disabled={isHomeFetching || isDecorating}
                  onClick={() => setIsDecorating(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11"
                aria-label="Manage home"
                hoverText="Manage home"
                ref={managementTriggerRef}
                disabled={isDecorating}
                onClick={() => setIsManagementOpen(true)}
              >
                <House className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )
        }
      >
        {isHomeLoading ? (
          <Loader explanation="Loading your home" />
        ) : (
          <HomeScene
            homeType={homeType}
            biome={homeData?.biome}
            styles={homeData?.styles}
            isGuest={!ownVillage}
            isAsleep={userData.status === "ASLEEP"}
            isTogglingSleep={isTogglingSleep}
            onSleep={() => toggleSleep()}
            layout={homeData?.layout}
            furniture={homeData?.furniture}
            revision={homeData?.furnitureRevision}
            canDecorate={canDecorate}
            isDecorating={isDecorating}
            onDecoratingChange={setIsDecorating}
            isSaving={saveFurniture.isPending}
            isRefreshingFurniture={isHomeFetching}
            furnitureError={furnitureError}
            onSave={saveLayout}
            onFarm={(trigger) => {
              farmTriggerRef.current = trigger;
              setIsFarmOpen(true);
            }}
            onStorage={(trigger) => {
              storageTriggerRef.current = trigger;
              setIsStorageOpen(true);
            }}
            onKitchen={(trigger) => {
              kitchenTriggerRef.current = trigger;
              setIsKitchenOpen(true);
            }}
          />
        )}
        {isHomeError && (
          <div role="alert" className="p-3 text-center">
            Unable to load your home details.
            <Button variant="outline" onClick={() => void userHomeRefetch()}>
              Retry
            </Button>
          </div>
        )}
      </ContentBox>
      {ownVillage && homeData && !isDecorating && (
        <div className="mb-4">
          <HomeSharing
            isPublic={homeData.isPublic}
            revision={homeData.furnitureRevision}
            userId={userData.userId}
            onChanged={userHomeRefetch}
          />
        </div>
      )}
      {ownVillage && (
        <ContentBox
          title="Your companions"
          subtitle="Your pet collection at home"
          initialBreak
        >
          {pets.isPending ? (
            <Loader explanation="Loading your companions..." />
          ) : pets.error ? (
            <div role="alert" className="space-y-2">
              <p>{pets.error.message}</p>
              <Button variant="outline" onClick={() => void pets.refetch()}>
                Try again
              </Button>
            </div>
          ) : pets.data?.pets.length ? (
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              aria-label="Pet collection"
            >
              {pets.data.pets.map((pet) => (
                <li key={pet.id} className="min-w-0">
                  <Link
                    href={`/profile?tab=pet&petId=${encodeURIComponent(pet.id)}`}
                    className="flex h-full flex-col items-center gap-2 rounded-lg border p-3 text-center hover:bg-muted/40"
                  >
                    {pet.avatar ? (
                      <Image
                        src={pet.avatar}
                        alt={pet.name}
                        width={112}
                        height={112}
                        className="h-28 w-28 object-contain"
                      />
                    ) : (
                      <PawPrint
                        className="h-28 w-28 p-6 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="w-full break-words font-semibold">{pet.name}</span>
                    {pet.id === pets.data.activePetId && (
                      <span className="text-muted-foreground text-sm">
                        Active companion
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <p>
                Meet your first companion at the {PET_SANCTUARY_NAME} on Wake Island.
              </p>
              {userData.sector === MAP_WAKE_ISLAND_SECTOR ? (
                <Button variant="outline" asChild>
                  <Link href="/pets">Open sanctuary</Link>
                </Button>
              ) : userData.status === "AWAKE" && !userData.battleId ? (
                <Button variant="outline" asChild>
                  <Link href={`/travel?sector=${MAP_WAKE_ISLAND_SECTOR}`}>
                    Travel to Wake Island
                  </Link>
                </Button>
              ) : (
                <>
                  <Button variant="outline" disabled>
                    Travel to Wake Island
                  </Button>
                  <p className="text-muted-foreground text-sm">
                    You must be awake and out of battle to travel.
                  </p>
                </>
              )}
            </div>
          )}
        </ContentBox>
      )}
      <Modal
        title="Kitchen"
        isOpen={isKitchenOpen}
        setIsOpen={setIsKitchenOpen}
        returnFocusRef={kitchenTriggerRef}
        className="sm:max-w-4xl md:max-w-4xl"
      >
        {isKitchenOpen && <HomeKitchen image={kitchenImage} />}
      </Modal>
      <Modal
        title="Your Farm"
        isOpen={isFarmOpen}
        setIsOpen={setIsFarmOpen}
        returnFocusRef={farmTriggerRef}
        className="sm:max-w-[min(1240px,calc(100vw-2rem))] md:max-w-[min(1240px,calc(100vw-2rem))]"
        closeButton={false}
      >
        {isFarmOpen && <HomeFarm embedded />}
      </Modal>
      {ownVillage && (
        <>
          <Modal
            title="Home Management"
            isOpen={isManagementOpen}
            setIsOpen={setIsManagementOpen}
            returnFocusRef={managementTriggerRef}
            className="sm:max-w-3xl"
          >
            {isHomeLoading || isUpgradesLoading ? (
              <Loader explanation="Loading home data" />
            ) : isHomeError || isUpgradesError || !homeData ? (
              <div role="alert">
                Unable to load home management.
                <Button
                  variant="outline"
                  onClick={() => {
                    void userHomeRefetch();
                    void upgradesRefetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Home className="mr-2" />{" "}
                      <div className="flex flex-col gap-1">
                        <span>Current Home: {homeName}</span>
                        <div className="font-normal text-muted-foreground italic">
                          {homeRegen > 0 && <span>+{homeRegen} Regeneration</span>}
                          {homeStorage > 0 && (
                            <span className="ml-2">+{homeStorage} Item Storage</span>
                          )}
                          {userData &&
                            homeData &&
                            calcMaxHouseMaterials(userData, homeData.storage) > 0 && (
                              <span className="ml-2">
                                +{calcMaxHouseMaterials(userData, homeData.storage)}{" "}
                                Material Storage
                              </span>
                            )}
                          {userData &&
                            homeData &&
                            calcMaxHouseCookingItems(userData, homeData.storage) >
                              0 && (
                              <span className="ml-2">
                                +{calcMaxHouseCookingItems(userData, homeData.storage)}{" "}
                                Cooking Storage
                              </span>
                            )}
                        </div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Tabs defaultValue="upgrades" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upgrades">
                      <BadgePlus className="mr-2 h-5 w-5" /> Buy New Home
                    </TabsTrigger>
                    <TabsTrigger value="downgrades">
                      <BadgeMinus className="mr-2 h-5 w-5" /> Downgrades
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="upgrades">
                    {upgrades.length === 0 ? (
                      <div className="p-4 text-center">
                        You already have the best home available!
                      </div>
                    ) : (
                      <div className="h-64 overflow-y-auto pr-1">
                        <div className="space-y-2 p-1">
                          {upgrades.map((upgrade, i) => (
                            <Card key={`${upgrade.type}-${i}`} className="mb-2">
                              <CardHeader className="pb-2">
                                <CardTitle>
                                  <div className="flex justify-between">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-lg">
                                        {upgrade.name}
                                      </span>
                                      <div className="flex flex-col font-normal text-muted-foreground italic sm:flex-row sm:gap-3">
                                        <span>
                                          {
                                            getHomeRooms(upgrade.type).filter(
                                              (room) => !room.isYard,
                                            ).length
                                          }{" "}
                                          room(s) + yard
                                        </span>
                                        {upgrade.regen > 0 && (
                                          <span>+{upgrade.regen} Regen</span>
                                        )}
                                        {upgrade.storage > 0 && (
                                          <span>+{upgrade.storage} Item Storage</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                      <span className="font-semibold text-lg">
                                        {upgrade.upgradeCost > 0
                                          ? `${upgrade.upgradeCost.toLocaleString()} Ryo`
                                          : "Free"}
                                      </span>
                                      <Button
                                        onClick={() =>
                                          upgradeHome({
                                            homeType: upgrade.type,
                                          })
                                        }
                                        disabled={
                                          isUpgrading ||
                                          (userData?.money ?? 0) < upgrade.upgradeCost
                                        }
                                        size="sm"
                                      >
                                        <PlusCircle className="mr-2 h-4 w-4" /> Buy
                                      </Button>
                                    </div>
                                  </div>
                                </CardTitle>
                              </CardHeader>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="downgrades">
                    <p className="mb-3 text-sm">
                      Furniture in removed rooms returns to furniture storage. Room
                      bonuses are cosmetic; sleep, storage, kitchen and farm remain
                      global.
                    </p>
                    {downgrades.length === 0 ? (
                      <div className="p-4 text-center">
                        You already have the lowest tier home!
                      </div>
                    ) : (
                      <div className="h-64 overflow-y-auto pr-1">
                        <div className="space-y-2 p-1">
                          {downgrades.map((downgrade) => (
                            <Card key={downgrade.type} className="mb-2">
                              <CardHeader className="pb-2">
                                <CardTitle>
                                  <div className="flex justify-between">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-lg">
                                        {downgrade.name}
                                      </span>
                                      <div className="flex flex-col font-normal text-muted-foreground italic sm:flex-row sm:gap-3">
                                        {downgrade.regen > 0 && (
                                          <span>+{downgrade.regen} Regen</span>
                                        )}
                                        {downgrade.storage > 0 && (
                                          <span>+{downgrade.storage} Item Storage</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                      <span className="font-semibold text-lg text-muted-foreground">
                                        {downgrade.downgradeRefund > 0
                                          ? `${downgrade.downgradeRefund.toLocaleString()} Ryo back (75%)`
                                          : "No cost"}
                                      </span>
                                      <Button
                                        onClick={() =>
                                          upgradeHome({
                                            homeType: downgrade.type,
                                          })
                                        }
                                        disabled={isUpgrading}
                                        size="sm"
                                      >
                                        <MinusCircle className="mr-2 h-4 w-4" />{" "}
                                        Downgrade
                                      </Button>
                                    </div>
                                  </div>
                                </CardTitle>
                              </CardHeader>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </Modal>

          <Modal
            title="Armory · Home Storage"
            isOpen={isStorageOpen}
            setIsOpen={setIsStorageOpen}
            returnFocusRef={storageTriggerRef}
            className="sm:max-w-4xl"
            footerExtra={
              homeData &&
              !isHomeLoading &&
              !isItemsLoading &&
              !isHomeError &&
              !isItemsError &&
              !missingFurnitureIds && (
                <MergeAllStacksButton
                  storedAtHome={true}
                  onMerged={() => {
                    setSelectedItem(undefined);
                    setIsModalOpen(false);
                  }}
                />
              )
            }
          >
            {isHomeLoading ||
            isItemsLoading ||
            (missingFurnitureIds && isItemsFetching) ? (
              <Loader explanation="Loading item storage data" />
            ) : isHomeError || isItemsError || !homeData || missingFurnitureIds ? (
              <div role="alert">
                Unable to load home storage.
                <Button
                  variant="outline"
                  onClick={() => {
                    void userHomeRefetch();
                    void userItemsRefetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <Tabs defaultValue="stored" className="w-full">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    aria-label="Search home storage by name"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="flex-1"
                  />
                  <Select value={itemTypeFilter} onValueChange={setItemTypeFilter}>
                    <SelectTrigger
                      aria-label="Filter by item type"
                      className="w-full sm:w-40"
                    >
                      <SelectValue placeholder="Item type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Types</SelectItem>
                      {ItemTypes.map((itemType) => (
                        <SelectItem key={itemType} value={itemType}>
                          {itemType.charAt(0) + itemType.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={rarityFilter} onValueChange={setRarityFilter}>
                    <SelectTrigger
                      aria-label="Filter by rarity"
                      className="w-full sm:w-40"
                    >
                      <SelectValue placeholder="Rarity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Rarities</SelectItem>
                      {ItemRarities.map((rarity) => (
                        <SelectItem key={rarity} value={rarity}>
                          {rarity.charAt(0) + rarity.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!hasActiveFilters}
                    onClick={() => {
                      setSearchQuery("");
                      setItemTypeFilter("ALL");
                      setRarityFilter("ALL");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
                <TabsList className="grid w-full grid-cols-2 items-stretch sm:grid-cols-5">
                  <TabsTrigger
                    value="stored"
                    className="min-w-0 flex-wrap gap-x-1 px-2"
                    aria-label={`Stored Items (${storedItems.length} / ${homeStorage} slots used)`}
                  >
                    <span className="inline-flex items-center">
                      <Package className="mr-1 h-4 w-4 shrink-0" /> Stored Items
                    </span>
                    <span className="font-normal text-xs tabular-nums">
                      ({storedItems.length} / {homeStorage})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="materials"
                    className="min-w-0 flex-wrap gap-x-1 px-2"
                    aria-label={`Materials (${storedMaterials.length} / ${maxHouseMaterials} slots used)`}
                  >
                    <span className="inline-flex items-center">
                      <Hammer className="mr-1 h-4 w-4 shrink-0" /> Materials
                    </span>
                    <span className="font-normal text-xs tabular-nums">
                      ({storedMaterials.length} / {maxHouseMaterials})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="cooking"
                    className="min-w-0 flex-wrap gap-x-1 px-2"
                    aria-label={`Cooking (${storedCooking.length} / ${maxHouseCooking} slots used)`}
                  >
                    <span className="inline-flex items-center">
                      <ChefHat className="mr-1 h-4 w-4 shrink-0" /> Cooking
                    </span>
                    <span className="font-normal text-xs tabular-nums">
                      ({storedCooking.length} / {maxHouseCooking})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="furniture" className="min-w-0 px-2">
                    Furniture ({storedFurniture.length})
                  </TabsTrigger>
                  <TabsTrigger value="inventory" className="min-w-0 px-2">
                    <ShoppingBag className="mr-1 h-4 w-4 shrink-0" /> Inventory
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="stored">
                  {visibleStoredItems.length === 0 ? (
                    <div className="p-4 text-center">
                      {storedItems.length === 0
                        ? "You don't have any items stored in your home."
                        : "No items match your filters."}
                    </div>
                  ) : (
                    <div className="p-3">
                      <ActionSelector
                        items={visibleStoredItems?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        counts={storedItemBadges.counts}
                        levels={storedItemBadges.levels}
                        selectedId={selectedItem?.id}
                        showBgColor={false}
                        showLabels={false}
                        onClick={(id) => {
                          if (id === selectedItem?.id) {
                            setSelectedItem(undefined);
                            setIsModalOpen(false);
                          } else {
                            const item = visibleStoredItems?.find(
                              (item) => item.id === id,
                            );
                            if (item) {
                              setSelectedItem(item);
                              setIsModalOpen(true);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="furniture">
                  {visibleStoredFurniture.length === 0 ? (
                    <div className="p-4 text-center">
                      {storedFurniture.length === 0
                        ? "Unplaced furniture remains here. Use Decorate to place it in a room."
                        : "No items match your filters."}
                    </div>
                  ) : (
                    <div className="p-3">
                      <ActionSelector
                        items={visibleStoredFurniture?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        counts={storedFurnitureBadges.counts}
                        levels={storedFurnitureBadges.levels}
                        selectedId={selectedItem?.id}
                        showBgColor={false}
                        showLabels={false}
                        onClick={(id) => {
                          if (id === selectedItem?.id) {
                            setSelectedItem(undefined);
                            setIsModalOpen(false);
                          } else {
                            const item = visibleStoredFurniture?.find(
                              (item) => item.id === id,
                            );
                            if (item) {
                              setSelectedItem(item);
                              setIsModalOpen(true);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="materials">
                  <div className="space-y-4">
                    <div>
                      <h4 className="mb-2 font-semibold">Stored Materials</h4>
                      {visibleStoredMaterials.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground">
                          {storedMaterials.length === 0
                            ? "No materials stored in your home."
                            : "No materials match your filters."}
                        </div>
                      ) : (
                        <div className="p-3">
                          <ActionSelector
                            items={visibleStoredMaterials?.map((useritem) => ({
                              ...useritem.item,
                              ...useritem,
                            }))}
                            counts={storedMaterialBadges.counts}
                            levels={storedMaterialBadges.levels}
                            selectedId={selectedItem?.id}
                            showBgColor={false}
                            showLabels={false}
                            onClick={(id) => {
                              if (id === selectedItem?.id) {
                                setSelectedItem(undefined);
                                setIsModalOpen(false);
                              } else {
                                const item = visibleStoredMaterials?.find(
                                  (item) => item.id === id,
                                );
                                if (item) {
                                  setSelectedItem(item);
                                  setIsModalOpen(true);
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="cooking">
                  <div className="space-y-4">
                    <div>
                      <h4 className="mb-2 font-semibold">Stored Cooking</h4>
                      {visibleStoredCooking.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground">
                          {storedCooking.length === 0
                            ? "No cooking items stored in your home."
                            : "No cooking items match your filters."}
                        </div>
                      ) : (
                        <div className="p-3">
                          <ActionSelector
                            items={visibleStoredCooking?.map((useritem) => ({
                              ...useritem.item,
                              ...useritem,
                            }))}
                            counts={storedCookingBadges.counts}
                            levels={storedCookingBadges.levels}
                            selectedId={selectedItem?.id}
                            showBgColor={false}
                            showLabels={false}
                            onClick={(id) => {
                              if (id === selectedItem?.id) {
                                setSelectedItem(undefined);
                                setIsModalOpen(false);
                              } else {
                                const item = visibleStoredCooking?.find(
                                  (item) => item.id === id,
                                );
                                if (item) {
                                  setSelectedItem(item);
                                  setIsModalOpen(true);
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="inventory">
                  {visibleInventoryItems.length === 0 &&
                  visibleInventoryMaterials.length === 0 &&
                  visibleInventoryCooking.length === 0 ? (
                    <div className="p-4 text-center">
                      {nonStoredItems.length === 0 &&
                      nonStoredMaterials.length === 0 &&
                      nonStoredCooking.length === 0
                        ? "You don't have any items in your inventory."
                        : "No inventory items match your filters."}
                    </div>
                  ) : (
                    <div className="p-3">
                      {visibleInventoryItems.length > 0 && (
                        <div className="mb-4">
                          <h4 className="mb-2 font-semibold">Items</h4>
                          <ActionSelector
                            items={visibleInventoryItems?.map((useritem) => ({
                              ...useritem.item,
                              ...useritem,
                            }))}
                            counts={inventoryItemBadges.counts}
                            levels={inventoryItemBadges.levels}
                            selectedId={selectedItem?.id}
                            showBgColor={false}
                            showLabels={false}
                            greyedIds={visibleInventoryItems
                              ?.filter(
                                (owned) =>
                                  getHomeStorageBucket(owned.item) === "normal" &&
                                  !canStoreMoreItems,
                              )
                              .map((owned) => owned.id)}
                            onClick={(id) => {
                              if (id === selectedItem?.id) {
                                setSelectedItem(undefined);
                                setIsModalOpen(false);
                              } else {
                                const item = userItems?.find((item) => item.id === id);
                                if (item) {
                                  setSelectedItem(item);
                                  setIsModalOpen(true);
                                }
                              }
                            }}
                          />
                        </div>
                      )}

                      {visibleInventoryMaterials.length > 0 && (
                        <div className="mb-4">
                          <h4 className="mb-2 font-semibold">Materials</h4>
                          <ActionSelector
                            items={visibleInventoryMaterials?.map((useritem) => ({
                              ...useritem.item,
                              ...useritem,
                            }))}
                            counts={inventoryMaterialBadges.counts}
                            levels={inventoryMaterialBadges.levels}
                            selectedId={selectedItem?.id}
                            showBgColor={false}
                            showLabels={false}
                            greyedIds={
                              !canStoreMoreMaterials
                                ? visibleInventoryMaterials?.map(
                                    (useritem) => useritem.id,
                                  )
                                : undefined
                            }
                            onClick={(id) => {
                              if (id === selectedItem?.id) {
                                setSelectedItem(undefined);
                                setIsModalOpen(false);
                              } else {
                                const item = userItems?.find((item) => item.id === id);
                                if (item) {
                                  setSelectedItem(item);
                                  setIsModalOpen(true);
                                }
                              }
                            }}
                          />
                        </div>
                      )}

                      {visibleInventoryCooking.length > 0 && (
                        <div>
                          <h4 className="mb-2 font-semibold">Cooking</h4>
                          <ActionSelector
                            items={visibleInventoryCooking?.map((useritem) => ({
                              ...useritem.item,
                              ...useritem,
                            }))}
                            counts={inventoryCookingBadges.counts}
                            levels={inventoryCookingBadges.levels}
                            selectedId={selectedItem?.id}
                            showBgColor={false}
                            showLabels={false}
                            greyedIds={
                              !canStoreMoreCooking
                                ? visibleInventoryCooking?.map(
                                    (useritem) => useritem.id,
                                  )
                                : undefined
                            }
                            onClick={(id) => {
                              if (id === selectedItem?.id) {
                                setSelectedItem(undefined);
                                setIsModalOpen(false);
                              } else {
                                const item = userItems?.find((item) => item.id === id);
                                if (item) {
                                  setSelectedItem(item);
                                  setIsModalOpen(true);
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {/* Stored Items Modal */}
            {isModalOpen && selectedItem && (
              <Modal
                title="Item Details"
                isOpen={isModalOpen}
                setIsOpen={setIsModalOpen}
                isLoading={isTogglingStoreItem}
                keepOpenOnAccept
                proceed_label={
                  selectedItem.storedAtHome ? "Take from Storage" : "Store Item"
                }
                onAccept={() => {
                  toggleStoreItem({ userItemId: selectedItem.id });
                }}
              >
                {showsItemLevelBadge(selectedItem.item) &&
                  selectedItem.level < ITEM_LEVEL_CAP && (
                    <p>
                      - Need{" "}
                      {remainingXpToLevel(
                        selectedItem.item.xpToLevel,
                        selectedItem.experience,
                      )}{" "}
                      XP more to level
                    </p>
                  )}
                <ItemWithEffects
                  item={{
                    ...selectedItem.item,
                    imbuements: finishedImbuementItems(selectedItem),
                    curDurability: selectedItem.durability,
                    level: selectedItem.level,
                    experience: selectedItem.experience,
                  }}
                  key={selectedItem.id}
                  showStatistic="item"
                />
                {isTogglingStoreItem && (
                  <Loader explanation={`Moving ${selectedItem.item.name}`} />
                )}
              </Modal>
            )}
          </Modal>
        </>
      )}
    </>
  );
}
