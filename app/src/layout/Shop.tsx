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
import { getStrucBoost } from "@/utils/village";
import { useTutorialStep } from "@/hooks/tutorial";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
} from "@/drizzle/constants";
import type { ItemType, Item } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";

interface ShopProps {
  userData: NonNullable<UserWithRelations>;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
  eventItems?: boolean;
  title?: string;
  image?: string;
  subtitle?: string;
  defaultBackHref?: string;
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
      onlyInShop: true,
      hidden: false,
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

  // Tutorial hook
  const { currentStep, handleNextStep } = useTutorialStep();

  // Mutations
  const { mutate: purchase, isPending: isPurchasing } = api.item.buy.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.item.getUserItemCounts.invalidate();
        void utils.profile.getUser.invalidate();
        void utils.item.getUserItems.invalidate();
        if (currentStep?.title === "Item shop") {
          handleNextStep();
        }
      }
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsOpen(false);
      setItem(undefined);
    },
  });

  // Discount factors
  const sDiscount = getStrucBoost("itemDiscountPerLvl", userData.village?.structures);
  const aDiscount = userData.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
  const hDiscount = item?.effects?.find((e) => e.type === "heal")
    ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
    : 0;
  const factor = (100 - sDiscount - aDiscount - hDiscount) / 100;

  // Collect discount information for UI
  const discounts = [
    ...(sDiscount > 0 ? [{ label: "village structures", value: sDiscount }] : []),
    ...(aDiscount > 0 ? [{ label: "ANBU membership", value: aDiscount }] : []),
    ...(hDiscount > 0 ? [{ label: "medic-nin item", value: hDiscount }] : []),
  ];
  const totalDiscount = discounts.reduce((acc, d) => acc + d.value, 0);

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
  // Simple cost string for the purchase button
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
          defaultBackHref={props.defaultBackHref}
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
                  id="tutorial-itemshop-confirmPurchase"
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
                  <div className="pb-3 space-y-2">
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                      <h4 className="font-semibold text-sm mb-2">Your Currency</h4>
                      <div className="grid grid-cols-1 gap-1 text-sm">
                        <div className="flex justify-between">
                          <span>Ryo:</span>
                          <span className="font-mono">
                            {userData.money.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Reputation Points:</span>
                          <span className="font-mono">
                            {userData.reputationPoints.toLocaleString()}
                          </span>
                        </div>
                        {userData.seichiSilver > 0 && (
                          <div className="flex justify-between">
                            <span>Seichi Silver:</span>
                            <span className="font-mono">
                              {userData.seichiSilver.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {discounts.length > 0 && (
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                        <h4 className="font-semibold text-sm mb-2 text-green-800 dark:text-green-200">
                          Active Discounts ({totalDiscount}% total)
                        </h4>
                        <div className="space-y-1 text-sm">
                          {discounts.map((discount, index) => (
                            <div
                              key={index}
                              className="flex justify-between text-green-700 dark:text-green-300"
                            >
                              <span className="capitalize">{discount.label}:</span>
                              <span className="font-mono">{discount.value}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
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
