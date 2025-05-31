"use client";

import { useState } from "react";
import { Merge, CircleDollarSign, Cookie, ArrowDownToLine } from "lucide-react";
import Image from "next/image";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal from "@/layout/Modal";
import Confirm from "@/layout/Confirm";
import ContentImage from "@/layout/ContentImage";
import { nonCombatConsume } from "@/libs/item";
import { Button } from "@/components/ui/button";
import { calcItemSellingPrice } from "@/libs/item";
import { ActionSelector } from "@/layout/CombatActions";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { calcMaxItems, calcMaxEventItems } from "@/libs/item";
import { CircleFadingArrowUp, Shirt } from "lucide-react";
import { COST_EXTRA_ITEM_SLOT, IMG_EQUIP_SILHOUETTE } from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { Item, UserItem, ItemSlot } from "@/drizzle/schema";

type UserItemWithItem = UserItem & { item: Item };

export default function MyItems() {
  // State
  const availableTabs = ["normal", "event"];
  const { data: userData } = useRequiredUserData();
  const [activeTab, setActiveTab] = useState<(typeof availableTabs)[number]>("normal");

  // tRPC utils
  const utils = api.useUtils();

  // Data from DB
  useRequiredUserData();
  const { data: userItems, isFetching } = api.item.getUserItems.useQuery(undefined, {
    enabled: !!userData,
  });

  // Mutations
  const { mutate: buyItemSlot, isPending } = api.blackmarket.buyItemSlot.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  // Subtitle
  const availableItems = userItems?.filter((ui) => !ui.storedAtHome);
  const normalItems = availableItems?.filter((ui) => !ui.item.isEventItem);
  const eventItems = availableItems?.filter((ui) => ui.item.isEventItem);

  // Calculate inventory limits
  const maxNormalItems = userData ? calcMaxItems(userData) : 0;
  const maxEventItems = userData ? calcMaxEventItems(userData) : 0;

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isFetching) return <Loader explanation="Loading items" />;

  // Can afford removing
  const canAfford =
    userData.reputationPoints && userData.reputationPoints >= COST_EXTRA_ITEM_SLOT;

  return (
    <ContentBox
      title="Item Management"
      subtitle={
        activeTab === "normal"
          ? `Normal Inventory ${normalItems?.length}/${maxNormalItems}`
          : `Event Inventory ${eventItems?.length}/${maxEventItems}`
      }
      padding={false}
      topRightContent={
        <div className="flex flex-row gap-2">
          <NavTabs
            id="backpackSelection"
            current={activeTab}
            options={availableTabs}
            setValue={setActiveTab}
          />
          <Confirm
            title="Extra Item Slot"
            proceed_label={
              canAfford
                ? `Purchase for ${COST_EXTRA_ITEM_SLOT} reps`
                : `Need ${userData.reputationPoints - COST_EXTRA_ITEM_SLOT} more reps`
            }
            isValid={!isPending}
            button={
              <Button animation="pulse">
                <CircleFadingArrowUp className="h-6 w-6" />
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              if (canAfford) buyItemSlot();
            }}
          >
            <p>
              You are about to purchase an extra item slot for {COST_EXTRA_ITEM_SLOT}{" "}
              reputation points. You currently have {userData.reputationPoints} points.
              Are you sure?
            </p>
          </Confirm>
        </div>
      }
    >
      <div className="flex flex-col">
        <div className="flex flex-col sm:flex-row">
          <div className="w-full basis-1/2 p-3">
            <h2 className="text-2xl font-bold text-foreground">Equipped</h2>
            <div className="relative">
              <Character useritems={userItems} />
            </div>
          </div>
          <div className="basis-1/2 p-3 bg-poppopover overflow-y-scroll max-h-full sm:max-h-[600px] border-t-2 sm:border-t-0 border-dashed sm:border-l-2">
            <h2 className="text-2xl font-bold text-foreground">Backpack</h2>
            <Backpack
              userData={userData}
              useritems={
                activeTab === "normal"
                  ? normalItems?.filter((ui) => ui.equipped === "NONE")
                  : eventItems?.filter((ui) => ui.equipped === "NONE")
              }
            />
          </div>
        </div>
      </div>
    </ContentBox>
  );
}

/**
 * Backpack Screen
 */
interface BackpackProps {
  useritems: UserItemWithItem[] | undefined;
  userData: NonNullable<UserWithRelations>;
}

const Backpack: React.FC<BackpackProps> = (props) => {
  // Destructure
  const { useritems, userData } = props;

  // State
  const [useritem, setUserItem] = useState<UserItemWithItem | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // tRPC utility
  const utils = api.useUtils();

  // Handler for when mutations are settled
  const onSettled = () => {
    document.body.style.cursor = "default";
    setIsOpen(false);
    setUserItem(undefined);
  };

  // Mutations
  const { mutate: merge, isPending: isMerging } = api.item.mergeStacks.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.item.getUserItems.invalidate();
        await utils.bloodline.getItemRolls.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: sell, isPending: isSelling } = api.item.sellUserItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getUserItems.invalidate();
      }
    },
    onSettled,
  });

  // Derived
  const structures = userData?.village?.structures;
  const isLoading = isMerging || isConsuming || isSelling || isEquipping;
  const items = useritems?.map((useritem) => ({ ...useritem.item, ...useritem }));
  const sellPrice = calcItemSellingPrice(userData, useritem, structures);

  return (
    <>
      <ActionSelector
        className="grid-cols-6 sm:grid-cols-4 md:grid-cols-4 pt-3"
        items={items}
        counts={items}
        selectedId={useritem?.id}
        showBgColor={false}
        showLabels={false}
        onClick={(id) => {
          if (id == useritem?.id) {
            setUserItem(undefined);
            setIsOpen(false);
          } else {
            setUserItem(items?.find((item) => item.id === id));
            setIsOpen(true);
          }
        }}
      />
      {isOpen && useritem && (
        <Modal title="Item Details" setIsOpen={setIsOpen} isValid={false}>
          <ItemWithEffects
            item={useritem.item}
            key={useritem.id}
            showStatistic="item"
          />
          {!isLoading && (
            <div className="flex flex-row gap-1">
              {useritem.equipped === "NONE" && (
                <Button
                  variant="info"
                  onClick={() => equip({ userItemId: useritem.id })}
                >
                  <Shirt className="mr-2 h-5 w-5" />
                  Equip
                </Button>
              )}
              {useritem.item.canStack && (
                <Button
                  variant="info"
                  onClick={() => merge({ itemId: useritem.itemId })}
                >
                  <Merge className="mr-2 h-5 w-5" />
                  Merge Stacks
                </Button>
              )}
              {nonCombatConsume(useritem.item, userData) && (
                <Button
                  variant="info"
                  onClick={() => consume({ userItemId: useritem.id })}
                >
                  <Cookie className="mr-2 h-5 w-5" />
                  Consume
                </Button>
              )}
              <div className="grow"></div>
              <Confirm
                title="Security Confirmation"
                proceed_label="Submit"
                button={
                  useritem.item.isEventItem ? (
                    <Button id="sell" variant="destructive">
                      <ArrowDownToLine className="mr-2 h-5 w-5" />
                      Drop Item
                    </Button>
                  ) : (
                    <Button id="sell" variant="destructive">
                      <CircleDollarSign className="mr-2 h-5 w-5" />
                      Sell Item [{Math.floor(sellPrice)} ryo]
                    </Button>
                  )
                }
                onAccept={() => sell({ userItemId: useritem.id })}
              >
                Are you absolutely sure you wish to remove this item from your
                inventory?
              </Confirm>
            </div>
          )}
          {isMerging && <Loader explanation={`Merging ${useritem.item.name} stacks`} />}
          {isConsuming && <Loader explanation={`Using ${useritem.item.name}`} />}
          {isSelling && <Loader explanation={`Selling ${useritem.item.name}`} />}
          {isEquipping && <Loader explanation={`Equipping ${useritem.item.name}`} />}
        </Modal>
      )}
    </>
  );
};

/**
 * Character Equip Screen
 */
interface CharacterProps {
  useritems: UserItemWithItem[] | undefined;
}

const Character: React.FC<CharacterProps> = (props) => {
  // Set state
  const { useritems } = props;
  const [slot, setSlot] = useState<ItemSlot | undefined>(undefined);
  const [item, setItem] = useState<(UserItem & Item) | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // The item on the current slot

  // Collapse UserItem and Item
  const items = useritems?.map((useritem) => ({ ...useritem.item, ...useritem }));
  const equipped = items?.find((item) => item.equipped === slot);

  // tRPC utility
  const utils = api.useUtils();

  // Open modal for equipping
  const act = (slot: ItemSlot) => {
    setSlot(slot);
    setIsOpen(true);
  };

  // Mutations
  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onSuccess: async () => {
      await utils.item.getUserItems.invalidate();
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsOpen(false);
      setItem(undefined);
    },
  });

  // Placement of equip boxes
  const l = "left-[10%] ";
  const r = "right-[10%] ";
  const t1 = "top-2";
  const t2 = "top-[20%]";
  const t3 = "top-[40%]";
  const t4 = "top-[60%]";
  const t5 = "top-[80%]";

  return (
    <div className="flex flex-row items-center justify-center text-center">
      <Image
        className="w-full opacity-50"
        src={IMG_EQUIP_SILHOUETTE}
        alt="background"
        width={290}
        height={461}
      />
      <Equip slot={"HEAD"} act={act} txt="Head" pos={t1} items={items} />
      <Equip slot={"CHEST"} act={act} txt="Chest" pos={t2} items={items} />
      <Equip slot={"WAIST"} act={act} txt="Waist" pos={t3} items={items} />
      <Equip slot={"LEGS"} act={act} txt="Legs" pos={t4} items={items} />
      <Equip slot={"FEET"} act={act} txt="Feet" pos={t5} items={items} />
      <Equip slot={"ITEM_1"} act={act} txt="Item" pos={l + t2} items={items} />
      <Equip slot={"ITEM_2"} act={act} txt="Item" pos={r + t2} items={items} />
      <Equip slot={"HAND_1"} act={act} txt="Hand" pos={l + t3} items={items} />
      <Equip slot={"HAND_2"} act={act} txt="Hand" pos={r + t3} items={items} />
      <Equip slot={"ITEM_3"} act={act} txt="Item" pos={l + t4} items={items} />
      <Equip slot={"ITEM_4"} act={act} txt="Item" pos={r + t4} items={items} />
      <Equip slot={"ITEM_5"} act={act} txt="Item" pos={l + t5} items={items} />
      <Equip slot={"ITEM_6"} act={act} txt="Item" pos={r + t5} items={items} />
      <Equip slot={"ITEM_7"} act={act} txt="Item" pos={r + t1} items={items} />
      <Equip slot={"KEYSTONE"} act={act} txt="Keystone" pos={l + t1} items={items} />
      {isOpen && slot && (
        <Modal
          title="Item Details"
          setIsOpen={setIsOpen}
          isValid={false}
        >
          <div className="flex flex-col">
            {equipped ? (
              <>
                <ItemWithEffects
                  item={equipped.item}
                  key={equipped.id}
                  showStatistic="item"
                />
                {!isEquipping && (
                  <div className="flex flex-row gap-1 mt-2">
                    <Button
                      variant="info"
                      onClick={() => {
                        setItem(equipped);
                        equip({ userItemId: equipped.id, slot: slot });
                      }}
                    >
                      <Shirt className="mr-2 h-5 w-5" />
                      Unequip
                    </Button>
                  </div>
                )}
                {isEquipping && <Loader explanation={`Unequipping ${equipped.name}`} />}
              </>
            ) : !isEquipping ? (
              <ActionSelector
                items={items?.filter((item) => slot?.includes(item.slot))}
                counts={items}
                showBgColor={false}
                showLabels={false}
                greyedIds={items
                  ?.filter((item) => item.equipped !== "NONE")
                  .map((item) => item.id)}
                onClick={(id) => {
                  setItem(items?.find((item) => item.id === id));
                  equip({ userItemId: id, slot: slot });
                }}
              />
            ) : (
              <Loader explanation={`Swapping ${item?.name}`} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

/**
 * Equip on the Character Equip Screen
 */
interface EquipProps {
  txt: string;
  pos: string;
  slot: ItemSlot;
  items: (UserItem & Item)[] | undefined;
  act: (slot: ItemSlot) => void;
}

const Equip: React.FC<EquipProps> = (props) => {
  const item = props.items?.find((item) => item.equipped == props.slot);
  return (
    <div
      className={`absolute ${
        props.pos
      } flex w-1/5 md:w-1/4 lg:w-1/5 aspect-square shrink-0 grow-0 cursor-pointer flex-row items-center justify-center border-2 border-dashed border-slate-500 bg-slate-200 text-xl font-bold text-slate-950 ${
        item ? "" : "opacity-50"
      } hover:border-black hover:bg-slate-400 rounded-xl`}
      onClick={() => props.act(props.slot)}
    >
      {item ? (
        <ContentImage
          image={item.image}
          hideBorder={true}
          alt={item.name}
          rarity={item.rarity}
          className=""
        />
      ) : (
        <p className="opacity-100">{props.txt}</p>
      )}
    </div>
  );
};
