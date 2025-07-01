import { useState } from "react";
import Image from "next/image";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import ItemWithEffects from "@/layout/ItemWithEffects";
import {
  ItemShopFiltering,
  useShopFiltering,
  getShopFilter,
} from "@/layout/ItemShopFiltering";
import { ActionSelector } from "@/layout/CombatActions";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { useAwake } from "@/utils/routing";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { structureBoost } from "@/utils/village";
import { ANBU_ITEMSHOP_DISCOUNT_PERC } from "@/drizzle/constants";
import type { ItemType, Item } from "@/drizzle/schema";
import type { UserWithRelations } from "@/server/api/routers/profile";

interface ShopProps {
  userData: NonNullable<UserWithRelations>;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
  eventItems?: boolean;
  title?: string;
  image?: string;
  subtitle?: string;
  back_href?: string;
  initialBreak?: boolean;
  minCost?: number;
  minRepsCost?: number;
  minSeichiSilverCost?: number;
}

const Shop: React.FC<ShopProps> = (props) => {
  // Destructure
  const { userData, defaultType, minCost, minRepsCost, minSeichiSilverCost } = props;

  // Settings
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [item, setItem] = useState<Item | undefined>(undefined);
  const [stacksize, setStacksize] = useState<number>(1);
  const filteringState = useShopFiltering(defaultType);
  const isAwake = useAwake(userData);

  // tRPC Utility
  const utils = api.useUtils();

  // Data
  const { data: items, isFetching } = api.item.getAll.useInfiniteQuery(
    {
      minCost,
      minRepsCost,
      minSeichiSilverCost,
      eventItems: props.eventItems,
      limit: 500,
      ...getShopFilter(filteringState),
    },
    {
      enabled: userData !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allItems = items?.pages
    .map((page) => page.data)
    .flat()
    .filter(
      (item) =>
        !item.expireFromStoreAt || new Date(item.expireFromStoreAt) > new Date(),
    );

  // Mutations
  const { mutate: purchase, isPending: isPurchasing } = api.item.buy.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.item.getUserItemCounts.invalidate();
        void utils.profile.getUser.invalidate();
        void utils.item.getUserItems.invalidate();
      }
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsOpen(false);
      setItem(undefined);
    },
  });

  // Discount factors
  const sDiscount = structureBoost("itemDiscountPerLvl", userData.village?.structures);
  const aDiscount = userData.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
  const factor = (100 - sDiscount - aDiscount) / 100;

  // Can user afford selected item
  const ryoCost = Math.ceil((item?.cost ?? 0) * stacksize * factor);
  const repsCost = Math.ceil((item?.repsCost ?? 0) * stacksize);
  const seichiSilverCost = Math.ceil((item?.seichiSilverCost ?? 0) * stacksize);
  const canAfford =
    userData.money >= ryoCost &&
    userData.reputationPoints >= repsCost &&
    userData.seichiSilver >= seichiSilverCost;
  const costs = [
    ...(ryoCost > 0 ? [`${ryoCost} ryo`] : []),
    ...(repsCost > 0 ? [`${repsCost} reputation points`] : []),
    ...(seichiSilverCost > 0 ? [`${seichiSilverCost} seichi silver`] : []),
  ];
  const missing = [
    ...(ryoCost > userData.money ? [`${ryoCost - userData.money} more ryo`] : []),
    ...(repsCost > userData.reputationPoints
      ? [`${repsCost - userData.reputationPoints} more reputation points`]
      : []),
    ...(seichiSilverCost > userData.seichiSilver
      ? [`${seichiSilverCost - userData.seichiSilver} more seichi silver`]
      : []),
  ];
  const costString = "Buy for " + costs.join(", ");
  const missingString = "Need " + missing.join(", ");

  // Show loaders
  if (!isAwake) return <Loader explanation="Redirecting because not awake" />;

  return (
    <>
      {isAwake && (
        <ContentBox
          title={props.title ?? "Item Shop"}
          subtitle={props.subtitle ?? "Buy items"}
          back_href={props.back_href}
          initialBreak={props.initialBreak}
          padding={false}
          topRightContent={
            <div className="flex flex-row gap-2">
              <ItemShopFiltering
                state={filteringState}
                defaultType={defaultType}
                restrictTypes={props.restrictTypes}
              />
            </div>
          }
        >
          {props.image && (
            <Image
              alt="page-image"
              src={props.image}
              width={512}
              height={195}
              className="w-full"
              priority={true}
            />
          )}
          {isFetching && <Loader explanation="Loading data" />}
          {!isFetching && userData && (
            <div className="p-2">
              <ActionSelector
                items={allItems}
                selectedId={item?.id}
                labelSingles={true}
                onClick={(id) => {
                  if (id == item?.id) {
                    setItem(undefined);
                    setIsOpen(false);
                  } else {
                    setItem(allItems?.find((item) => item.id === id));
                    setIsOpen(true);
                  }
                }}
                showBgColor={false}
                showLabels={true}
              />
              {isOpen && item && (
                <Modal2
                  title="Confirm Purchase"
                  proceed_label={
                    isPurchasing ? undefined : canAfford ? costString : missingString
                  }
                  isOpen={isOpen}
                  setIsOpen={setIsOpen}
                  isValid={false}
                  onAccept={() => {
                    if (canAfford) {
                      purchase({
                        itemId: item.id,
                        stack: stacksize,
                        villageId: userData.villageId,
                      });
                    } else {
                      setIsOpen(false);
                    }
                  }}
                  confirmClassName={
                    canAfford
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }
                >
                  <p className="pb-3">
                    You have {userData.money} ryo in your pocket and{" "}
                    {userData.reputationPoints} reputation points.
                  </p>
                  {!isPurchasing && (
                    <>
                      <ItemWithEffects
                        item={item}
                        key={item.id}
                        showEdit="item"
                        showStatistic="item"
                      />
                      {item.canStack && item.stackSize > 1 ? (
                        <UncontrolledSliderField
                          id="stackSize"
                          label={`How many to buy: ${stacksize}`}
                          value={stacksize}
                          min={1}
                          max={item.stackSize}
                          setValue={setStacksize}
                        />
                      ) : undefined}
                    </>
                  )}
                  {isPurchasing && <Loader explanation={`Purchasing ${item.name}`} />}
                </Modal2>
              )}
            </div>
          )}
        </ContentBox>
      )}
    </>
  );
};

export default Shop;
