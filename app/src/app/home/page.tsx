"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import BanInfo from "@/layout/BanInfo";
import Modal2 from "@/layout/Modal2";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { ActionSelector } from "@/layout/CombatActions";
import {
  IMG_HOME_TRAIN,
  IMG_HOME_EAT,
  IMG_HOME_SLEEP,
  IMG_HOME_AWAKE,
  HomeTypeDetails,
} from "@/drizzle/constants";
import { api } from "@/app/_trpc/client";
import { getStrucBoost } from "@/utils/village";
import { showMutationToast } from "@/libs/toast";
import { useRequireInVillage } from "@/utils/UserContext";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BadgePlus,
  BadgeMinus,
  Home,
  Package,
  PlusCircle,
  MinusCircle,
  ShoppingBag,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UserItemWithItem } from "@/drizzle/schema";

export default function HomePage() {
  const { userData, sectorVillage, access, ownVillage, updateUser } =
    useRequireInVillage("/home");

  // State
  const [selectedItem, setSelectedItem] = useState<UserItemWithItem | undefined>(
    undefined,
  );
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Queries
  const {
    data: homeData,
    isLoading: isHomeLoading,
    refetch: userHomeRefetch,
  } = api.home.getUserHome.useQuery();
  const {
    data: availableUpgrades,
    isLoading: isUpgradesLoading,
    refetch: upgradesRefetch,
  } = api.home.getAvailableUpgrades.useQuery();
  const {
    data: userItems,
    isLoading: isItemsLoading,
    refetch: userItemsRefetch,
  } = api.item.getUserItems.useQuery();

  // Mutations
  const { mutate: upgradeHome, isPending: isUpgrading } =
    api.home.upgradeHome.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void userHomeRefetch();
          void upgradesRefetch();
        }
      },
    });

  const { mutate: toggleStoreItem, isPending: isTogglingStoreItem } =
    api.home.toggleStoreItem.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void userHomeRefetch();
          void userItemsRefetch();
        }
      },
    });

  const { mutate: toggleSleep, isPending: isTogglingSleep } =
    api.home.toggleSleep.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.newStatus) {
          await updateUser({ status: data.newStatus });
        }
      },
    });

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Residence" />;
  if (userData.isBanned) return <BanInfo />;

  const boost = 1 + getStrucBoost("sleepRegenPerLvl", sectorVillage?.structures);

  const homeName = homeData ? HomeTypeDetails[homeData.homeType].name : "No Home";
  const homeRegen = homeData ? homeData.regen : 0;
  const homeStorage = homeData ? homeData.storage : 0;
  const filteredItems = userItems?.filter(
    (useritem) =>
      !useritem.craftingFinishedAt || useritem.craftingFinishedAt < new Date(),
  );
  const storedItems = filteredItems?.filter((useritem) => useritem.storedAtHome) ?? [];
  const nonStoredItems =
    filteredItems
      ?.filter((useritem) => !useritem.storedAtHome)
      .filter((useritem) => useritem.equipped === "NONE") ?? [];
  const canStoreMoreItems = storedItems.length < homeStorage;

  // Filter upgrades and downgrades
  const upgrades = availableUpgrades?.filter((upgrade) => upgrade.isUpgrade) || [];
  const downgrades = availableUpgrades?.filter((upgrade) => !upgrade.isUpgrade) || [];

  return (
    <>
      <ContentBox
        title={ownVillage ? "Your Home" : "Guest Residence"}
        subtitle={`Train, eat, sleep. +${boost}% regen sleeping.`}
        back_href="/village"
      >
        <div className="grid grid-cols-3 text-center font-bold italic">
          <Link href="/traininggrounds">
            <Image
              className="hover:opacity-30"
              alt="train"
              src={IMG_HOME_TRAIN}
              width={256}
              height={256}
            />
            Go train
          </Link>
          <Link href="/ramenshop">
            <Image
              className="hover:opacity-30"
              alt="eat"
              src={IMG_HOME_EAT}
              width={256}
              height={256}
            />
            Get Food
          </Link>
          {isTogglingSleep && <Loader explanation="Toggling sleep status" />}
          {!isTogglingSleep && (
            <div className="cursor-pointer" onClick={() => toggleSleep()}>
              {userData.status === "ASLEEP" ? (
                <>
                  <Image
                    className="hover:opacity-30 animate-pulse"
                    alt="sleeping"
                    src={IMG_HOME_SLEEP}
                    width={256}
                    height={256}
                  />
                  Wake up
                </>
              ) : (
                <>
                  <Image
                    className="hover:opacity-30"
                    alt="sleeping"
                    src={IMG_HOME_AWAKE}
                    width={256}
                    height={256}
                  />
                  Go to Sleep
                </>
              )}
            </div>
          )}
        </div>
      </ContentBox>
      {ownVillage && (
        <>
          <ContentBox
            title="Overview"
            subtitle="Storage space and regeneration"
            initialBreak={true}
          >
            {isHomeLoading || isUpgradesLoading ? (
              <Loader explanation="Loading home data" />
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
                      <div className="text-center p-4">
                        You already have the best home available!
                      </div>
                    ) : (
                      <div className="h-64 overflow-y-auto pr-1">
                        <div className="space-y-2 p-1">
                          {upgrades.map((upgrade) => (
                            <Card key={upgrade.type} className="mb-2">
                              <CardHeader className="pb-2">
                                <CardTitle>
                                  <div className="flex justify-between">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-lg">
                                        {upgrade.name}
                                      </span>
                                      <div className="flex flex-col sm:flex-row sm:gap-3 font-normal text-muted-foreground italic">
                                        {upgrade.regen > 0 && (
                                          <span>+{upgrade.regen} Regen</span>
                                        )}
                                        {upgrade.storage > 0 && (
                                          <span>+{upgrade.storage} Item Storage</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center ">
                                      <span className="font-semibold text-lg">
                                        {upgrade.cost.toLocaleString()} Ryo
                                      </span>
                                      <Button
                                        onClick={() =>
                                          upgradeHome({ homeType: upgrade.type })
                                        }
                                        disabled={
                                          isUpgrading ||
                                          (userData?.money ?? 0) < upgrade.cost
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
                    {downgrades.length === 0 ? (
                      <div className="text-center p-4">
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
                                      <div className="flex flex-col sm:flex-row sm:gap-3 font-normal text-muted-foreground italic">
                                        {downgrade.regen > 0 && (
                                          <span>+{downgrade.regen} Regen</span>
                                        )}
                                        {downgrade.storage > 0 && (
                                          <span>+{downgrade.storage} Item Storage</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center ">
                                      <span className="font-semibold text-lg">
                                        {downgrade.cost.toLocaleString()} Ryo
                                      </span>
                                      <Button
                                        onClick={() =>
                                          upgradeHome({ homeType: downgrade.type })
                                        }
                                        disabled={
                                          isUpgrading ||
                                          (userData?.money ?? 0) < downgrade.cost
                                        }
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
          </ContentBox>

          <ContentBox
            title="Item Storage"
            subtitle={`Items in home (${storedItems.length}/${homeStorage} slots used)`}
            initialBreak={true}
          >
            {isHomeLoading || isItemsLoading ? (
              <Loader explanation="Loading item storage data" />
            ) : homeData?.homeType === "NONE" ? (
              <div className="text-center p-4">
                You need to upgrade your home to store items.
              </div>
            ) : (
              <Tabs defaultValue="stored" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="stored">
                    <Package className="mr-2 h-5 w-5" /> Stored Items
                  </TabsTrigger>
                  <TabsTrigger value="inventory">
                    <ShoppingBag className="mr-2 h-5 w-5" /> Inventory
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="stored">
                  {storedItems.length === 0 ? (
                    <div className="text-center p-4">
                      You don&apos;t have any items stored in your home.
                    </div>
                  ) : (
                    <div className="p-3">
                      <ActionSelector
                        items={storedItems?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        counts={storedItems?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        selectedId={selectedItem?.id}
                        showBgColor={false}
                        showLabels={false}
                        onClick={(id) => {
                          if (id === selectedItem?.id) {
                            setSelectedItem(undefined);
                            setIsModalOpen(false);
                          } else {
                            const item = storedItems?.find((item) => item.id === id);
                            if (item) {
                              setSelectedItem(item as UserItemWithItem);
                              setIsModalOpen(true);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="inventory">
                  {nonStoredItems.length === 0 ? (
                    <div className="text-center p-4">
                      You don&apos;t have any items in your inventory.
                    </div>
                  ) : (
                    <div className="p-3">
                      <ActionSelector
                        items={nonStoredItems?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        counts={nonStoredItems?.map((useritem) => ({
                          ...useritem.item,
                          ...useritem,
                        }))}
                        selectedId={selectedItem?.id}
                        showBgColor={false}
                        showLabels={false}
                        greyedIds={
                          !canStoreMoreItems
                            ? nonStoredItems?.map((useritem) => useritem.id)
                            : undefined
                        }
                        onClick={(id) => {
                          if (id === selectedItem?.id) {
                            setSelectedItem(undefined);
                            setIsModalOpen(false);
                          } else {
                            const item = userItems?.find((item) => item.id === id);
                            if (item) {
                              setSelectedItem(item as UserItemWithItem);
                              setIsModalOpen(true);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {/* Stored Items Modal */}
            {isModalOpen && selectedItem && (
              <Modal2
                title="Item Details"
                isOpen={isModalOpen}
                setIsOpen={setIsModalOpen}
                isValid={false}
                proceed_label={
                  selectedItem.storedAtHome ? "Take from Storage" : "Store Item"
                }
                onAccept={() => {
                  toggleStoreItem({ userItemId: selectedItem.id });
                  setIsModalOpen(false);
                  setSelectedItem(undefined);
                }}
              >
                <ItemWithEffects
                  item={selectedItem.item}
                  key={selectedItem.id}
                  showStatistic="item"
                />
                {isTogglingStoreItem && (
                  <Loader explanation={`Moving ${selectedItem.item.name}`} />
                )}
              </Modal2>
            )}
          </ContentBox>
        </>
      )}
    </>
  );
}
