import type { LucideIcon } from "lucide-react";
import {
  Check,
  ChefHat,
  CircleAlert,
  Diamond,
  FlaskConical,
  Gem,
  LayoutGrid,
  Package,
  Search,
  Shield,
  ShoppingBag,
  Sofa,
  Sparkles,
  Sword,
  Tag,
} from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItemTypes, TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import type { Item, ItemType } from "@/drizzle/schema";
import { useTutorialStep } from "@/hooks/tutorial";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import Image from "@/layout/Image";
import {
  getShopFilter,
  ItemShopFiltering,
  useShopFiltering,
} from "@/layout/ItemShopFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import {
  canAffordShopPrice,
  getMaxItemShopPurchaseQuantity,
  getShopDiscounts,
  getShopStackPrice,
  isItemAvailableInStore,
  shopItemDiscountFactor,
} from "@/libs/shop";
import { showMutationToast } from "@/libs/toast";
import { isTutorialItemBuyStep, isTutorialPageMatch } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
import { useAwake, usePublicPathname } from "@/utils/routing";
import { useUserInfo } from "@/utils/UserContext";

const Shop: React.FC<ShopProps> = (props) => {
  const { userData, defaultType, minCost, minRepsCost, minSeichiSilverCost, catalog } =
    props;

  const { prepareUserUpdate, updateUser } = useUserInfo();
  const silverCopy = SILVER_COPY[catalog?.silverLabel ?? "seichi"];

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [item, setItem] = useState<Item | undefined>(undefined);
  const [requestedStacksize, setStacksize] = useState<number>(1);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const allowance = api.item.getPurchaseAllowance.useQuery(
    { id: item?.id ?? "" },
    { enabled: isOpen && !!item, staleTime: 0, refetchInterval: 30_000 },
  );
  const maxPurchaseQuantity = Math.min(
    item?.canStack ? getMaxItemShopPurchaseQuantity(item.stackSize) : 1,
    allowance.data?.remaining ?? Number.POSITIVE_INFINITY,
  );
  const stacksize = Math.min(requestedStacksize, Math.max(1, maxPurchaseQuantity));
  const canPurchaseQuantity =
    !!allowance.data &&
    !allowance.isError &&
    stacksize >= 1 &&
    stacksize <= maxPurchaseQuantity;
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const filteringState = useShopFiltering(defaultType);
  const isAwake = useAwake(userData);
  const itemTypeTabOptions = useMemo(
    () => (props.restrictTypes?.length ? props.restrictTypes : ItemTypes) as ItemType[],
    [props.restrictTypes],
  );

  const utils = api.useUtils();

  const hasBloodlineRoll = item?.effects.some(
    (effect) => effect.type === "rollbloodline",
  );
  const rollOdds = api.item.getBloodlineRollOdds.useQuery(
    { id: item?.id ?? "" },
    { enabled: isOpen && !!hasBloodlineRoll, staleTime: 0 },
  );
  const canReviewRollOdds =
    !hasBloodlineRoll ||
    (!rollOdds.isFetching &&
      !rollOdds.isError &&
      !!rollOdds.data?.length &&
      rollOdds.data.every((roll) => roll.outcomes.length > 0));

  const {
    data: items,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.item.getAll.useInfiniteQuery(
    {
      minCost,
      minRepsCost,
      minSeichiSilverCost,
      eventItems: props.eventItems,
      ...getShopFilter(filteringState),
      onlyInShop: true,
      excludeExpiredFromStore: true,
      limit: SHOP_CATALOG_PAGE_SIZE,
      hidden: false,
      maxLevel: userData.level,
    },
    {
      staleTime: Infinity,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });
  const allItems = items?.pages
    .flatMap((page) => page.data)
    .filter((row) => isItemAvailableInStore(row.expireFromStoreAt));

  const pathname = usePublicPathname();
  const { currentStep, completeTutorialAction } = useTutorialStep();
  // Shop also renders the souvenir and black-market catalogs; the tutorial pin
  // belongs only on the page its step points at.
  const isItemBuyStep =
    isTutorialItemBuyStep(currentStep) &&
    isTutorialPageMatch(currentStep?.page, pathname);

  const setItemConfirmOpen: Dispatch<SetStateAction<boolean>> = (open) => {
    const next = typeof open === "function" ? open(isOpen) : open;
    setIsOpen(next);
    if (!next) {
      setPurchaseError(null);
      setItem(undefined);
      setStacksize(1);
    }
  };

  const { data: tutorialItem } = api.item.get.useQuery(
    { id: TUTORIAL_ITEM_ID },
    { enabled: isItemBuyStep },
  );

  const catalogItems = [...(allItems ?? [])];
  if (isItemBuyStep && tutorialItem) {
    const pinnedIdx = catalogItems.findIndex((row) => row.id === TUTORIAL_ITEM_ID);
    if (pinnedIdx === -1) {
      catalogItems.unshift(tutorialItem);
    } else if (pinnedIdx > 0) {
      const [pinned] = catalogItems.splice(pinnedIdx, 1);
      if (pinned) catalogItems.unshift(pinned);
    }
  }

  const { mutate: purchase, isPending: isPurchasing } = api.item.buy.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: (data, variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        setItemConfirmOpen(false);
        void updateUser(data.userPatch, { revision, delta: data.userDelta });
        void utils.item.getUserItems.invalidate();
        void utils.item.getPurchaseAllowance.invalidate();
        if (item?.itemType === "FURNITURE") {
          void utils.home.getUserHome.invalidate();
        }
        if (isItemBuyStep && variables.itemId === TUTORIAL_ITEM_ID) {
          void completeTutorialAction("buyItem");
        }
      } else {
        setPurchaseError(data.message);
        void allowance.refetch();
      }
    },
    onError: (error) => setPurchaseError(error.message),
  });

  const discounts = getShopDiscounts(userData, userData.village?.structures, item);
  const selectedItemFactor = item ? shopItemDiscountFactor(discounts) : 1;
  const totalDiscount = discounts.reduce((acc, d) => acc + d.value, 0);

  const selectedPrice = getShopStackPrice(item, stacksize, selectedItemFactor);
  const { ryoCost, repsCost, seichiSilverCost } = selectedPrice;
  const canAfford = canAffordShopPrice(userData, selectedPrice);
  const costs = [
    ...(ryoCost > 0 ? [`${ryoCost.toLocaleString()} ryo`] : []),
    ...(repsCost > 0 ? [`${repsCost.toLocaleString()} reputation points`] : []),
    ...(seichiSilverCost > 0
      ? [`${seichiSilverCost.toLocaleString()} ${silverCopy.purchase}`]
      : []),
  ];
  const missing = [
    ...(ryoCost > userData.money
      ? [`${(ryoCost - userData.money).toLocaleString()} more ryo`]
      : []),
    ...(repsCost > userData.reputationPoints
      ? [
          `${(repsCost - userData.reputationPoints).toLocaleString()} more reputation points`,
        ]
      : []),
    ...(seichiSilverCost > userData.seichiSilver
      ? [
          `${(seichiSilverCost - userData.seichiSilver).toLocaleString()} more ${silverCopy.purchase}`,
        ]
      : []),
  ];
  const costString = `Buy for ${costs.join(", ")}`;
  const missingString = `Need ${missing.join(", ")}`;

  const catalogSearchId = catalog?.searchId ?? "shop-catalog-search";
  const catalogListDomId =
    catalog?.listId === false
      ? undefined
      : (catalog?.listId ?? (props.eventItems ? undefined : "tutorial-itemshop"));

  const catalogHeroTitle =
    catalog?.heroTitle ??
    (props.eventItems ? "Souvenir counter" : "Village storefront");
  const catalogHeroDescription =
    catalog?.heroDescription ??
    (props.eventItems
      ? "Limited-run goods for ryo. Use filters to narrow rarity and effects, then open a card to review and purchase."
      : "Open categories to browse village stock. Filters stack with search — your discounts apply at checkout.");
  const catalogHeroBadge =
    catalog?.heroBadge ?? (props.eventItems ? "Event catalog" : "Village pricing");

  const selectedItemType = filteringState.itemType as ItemType;
  const tabHint = SHOP_ITEM_TYPE_TAB_HINT[selectedItemType];

  if (!isAwake) return <Loader explanation="Redirecting because not awake" />;

  const purchaseModal = isOpen && item && (
    <Modal
      id="tutorial-itemshop-confirmPurchase"
      title="Confirm Purchase"
      proceed_label={isPurchasing ? undefined : canAfford ? costString : missingString}
      isOpen={isOpen}
      setIsOpen={setItemConfirmOpen}
      isLoading={isPurchasing}
      keepOpenOnAccept
      proceedDisabled={!canReviewRollOdds || !canPurchaseQuantity || isPurchasing}
      onAccept={() => {
        if (!canReviewRollOdds || !canPurchaseQuantity || isPurchasing) return;
        setPurchaseError(null);
        if (canAfford) {
          purchase({
            itemId: item.id,
            stack: stacksize,
            villageId: userData.villageId,
          });
        } else {
          setItemConfirmOpen(false);
        }
      }}
      confirmClassName={
        canAfford
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "bg-red-600 text-white hover:bg-red-700"
      }
    >
      {purchaseError && (
        <p role="alert" className="text-destructive">
          {purchaseError}
        </p>
      )}
      {item.itemType === "FURNITURE" && (
        <p className="pb-3 text-sm">Furniture is delivered to your home storage.</p>
      )}
      {allowance.isPending && <p>Loading purchase allowance…</p>}
      {allowance.isError && (
        <p role="alert">
          Could not load purchase allowance.{" "}
          <Button onClick={() => void allowance.refetch()}>Retry</Button>
        </p>
      )}
      {allowance.data?.limit != null && (
        <p className="pb-3 text-sm">
          Limit: {allowance.data.limit} units {allowance.data.period.toLowerCase()} (UTC
          {allowance.data.period === "WEEKLY" ? ", resets Monday" : ""}). Purchased:{" "}
          {allowance.data.purchased}. Remaining: {allowance.data.remaining}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 pb-3">
        <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
          <h4 className="mb-2 font-semibold text-sm">Your Currency</h4>
          <div className="grid grid-cols-1 gap-1 text-sm">
            <div className="flex justify-between">
              <span>Ryo:</span>
              <span className="font-mono">{userData.money.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Reputation Points:</span>
              <span className="font-mono">
                {userData.reputationPoints.toLocaleString()}
              </span>
            </div>
            {userData.seichiSilver > 0 && (
              <div className="flex justify-between">
                <span>{silverCopy.wallet}</span>
                <span className="font-mono">
                  {userData.seichiSilver.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
        {discounts.length > 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
            <h4 className="mb-2 font-semibold text-green-800 text-sm dark:text-green-200">
              Active Discounts ({totalDiscount}% total)
            </h4>
            <div className="space-y-1 text-sm">
              {discounts.map((discount) => (
                <div
                  key={discount.label}
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
          {hasBloodlineRoll && (
            <div
              className="rounded-lg border bg-background p-3 text-sm"
              aria-live="polite"
            >
              <h4 className="font-semibold">Bloodline odds</h4>
              {rollOdds.isFetching ? (
                <Loader explanation="Loading your possible bloodlines" />
              ) : rollOdds.isError || !rollOdds.data?.length ? (
                <div className="space-y-2">
                  <p>Could not load the odds. Please retry before buying.</p>
                  <Button variant="outline" onClick={() => void rollOdds.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Odds per use with your current village and roll history. Each use
                    rolls again; changing villages or rolling bloodlines can change the
                    pool. A successful roll replaces your equipped bloodline.
                  </p>
                  {rollOdds.data.length > 1 && (
                    <p>
                      Rolls run in order; the last successful roll determines your
                      bloodline.
                    </p>
                  )}
                  {rollOdds.data.map((roll, index) => (
                    <div key={`${roll.rank}-${index}`}>
                      <p className="font-medium">
                        {roll.rank}-rank roll
                        {roll.outcomes.length > 0 && `: ${roll.successChance}% success`}
                      </p>
                      {roll.outcomes.length === 0 ? (
                        <p role="alert">
                          No bloodlines are currently available for this roll.
                        </p>
                      ) : (
                        <ul>
                          {roll.outcomes.map((outcome) => (
                            <li key={outcome.id} className="flex justify-between gap-3">
                              <span className="min-w-0 break-words">
                                {outcome.name}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {outcome.chance.toLocaleString(undefined, {
                                  maximumFractionDigits: 4,
                                })}
                                %
                              </span>
                            </li>
                          ))}
                          {roll.successChance < 100 && (
                            <li>No new bloodline: {100 - roll.successChance}%</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <ItemWithEffects
            item={item}
            key={item.id}
            showEdit="item"
            showStatistic="item"
          />
          {item.canStack && item.stackSize > 1 && maxPurchaseQuantity > 0 ? (
            <UncontrolledSliderField
              id="stackSize"
              label={`How many to buy: ${stacksize}`}
              value={stacksize}
              min={1}
              max={maxPurchaseQuantity}
              setValue={setStacksize}
            />
          ) : undefined}
        </>
      )}
      {isPurchasing && <Loader explanation={`Purchasing ${item.name}`} />}
    </Modal>
  );

  return (
    <ContentBox
      title={props.title ?? "Item Shop"}
      subtitle={
        props.subtitle ??
        "Browse categories, search the catalog, then open a card to buy."
      }
      defaultBackHref={props.defaultBackHref}
      initialBreak={props.initialBreak}
      padding={false}
      topRightContent={
        <div className="flex flex-row flex-wrap items-center justify-end gap-2">
          {catalog?.headerExtra}
          <ItemShopFiltering
            state={filteringState}
            filterTriggerId={catalog?.filterTriggerId}
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

      {/* Phones go straight to the categories and items */}
      <div className="relative hidden overflow-hidden border-b bg-linear-to-br from-amber-950/25 via-card to-card px-3 py-4 sm:block md:px-6 md:py-8">
        <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/15 p-3 ring-1 ring-amber-500/35">
              <ShoppingBag className="h-7 w-7 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-lg tracking-tight md:text-xl">
                {catalogHeroTitle}
              </p>
              <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
                {catalogHeroDescription}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="gap-1 border-amber-500/25 bg-background/60 font-normal"
                >
                  <Tag className="h-3 w-3" />
                  {catalogHeroBadge}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b bg-linear-to-b from-amber-950/10 to-muted/30 px-2 py-3 md:px-6 md:py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-1.5 sm:gap-2">
          <div
            className="flex gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg bg-muted/90 p-0.5 shadow-inner ring-1 ring-border/50 sm:grid sm:grid-cols-4 sm:gap-1 sm:overflow-visible sm:rounded-xl sm:p-1 lg:grid-cols-8 dark:bg-muted/40"
            role="tablist"
            aria-label="Item category"
            onKeyDown={(event) => {
              // Arrow keys, Home and End move between categories like other tab lists.
              const tabs = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const index = tabs.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              const moves: Partial<Record<string, number>> = {
                ArrowRight: (index + 1) % tabs.length,
                ArrowLeft: (index - 1 + tabs.length) % tabs.length,
                Home: 0,
                End: tabs.length - 1,
              };
              const next = moves[event.key];
              if (next === undefined) return;
              event.preventDefault();
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
          >
            {itemTypeTabOptions.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={selectedItemType === t}
                tabIndex={selectedItemType === t ? 0 : -1}
                className={cn(
                  "flex min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 font-semibold text-[10px] transition-all sm:min-w-0 sm:flex-row sm:gap-2 sm:rounded-lg sm:px-1 sm:py-3 sm:text-xs",
                  selectedItemType === t
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                onClick={() => {
                  if (selectedItemType === t) return;
                  filteringState.setItemType(t);
                  setItemConfirmOpen(false);
                }}
              >
                {categoryTabIcon(t)}
                <span className="text-center leading-tight">
                  {SHOP_ITEM_TYPE_TAB_LABEL[t]}
                </span>
              </button>
            ))}
          </div>
          <p className="hidden text-balance text-center text-muted-foreground text-xs leading-relaxed sm:block">
            {tabHint}
          </p>
        </div>
      </div>

      <div className="border-b bg-muted/25 px-2 py-3 md:px-5 md:py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <Label
              htmlFor={catalogSearchId}
              className="text-muted-foreground text-xs uppercase"
            >
              Search catalog
            </Label>
            <div className="relative mt-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={catalogSearchId}
                placeholder="Search by item name…"
                value={filteringState.name}
                onChange={(e) => filteringState.setName(e.target.value)}
                className="h-11 rounded-xl border-border/80 bg-background pl-10 shadow-sm"
              />
            </div>
          </div>
          <p className="hidden text-muted-foreground text-xs sm:block lg:max-w-xs lg:text-right">
            More filters (rarity, slot, effects, …) stay in the filter button above.
          </p>
        </div>
      </div>

      <div className="px-1.5 py-2 sm:px-3 sm:py-3 md:p-5" id={catalogListDomId}>
        {!catalogItems.length && (isFetching || hasNextPage) ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center">
            <Loader explanation="Loading catalog…" />
            {hasNextPage ? (
              <div ref={setLastElement} className="h-px w-full" aria-hidden />
            ) : null}
          </div>
        ) : !catalogItems.length ? (
          <div className="flex min-h-[36vh] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center">
            <ShoppingBag className="mb-3 h-12 w-12 text-muted-foreground opacity-60" />
            <p className="font-medium text-lg">No items match your filters</p>
            <p className="mt-1 max-w-sm text-muted-foreground text-sm">
              {filteringState.name.trim()
                ? "Try clearing the name search or opening the filter panel to reset rarity, slot, or effects."
                : "Try another category tab or widen filters in the panel above."}
            </p>
          </div>
        ) : (
          <>
            <ul className="mx-auto grid max-w-7xl list-none grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4 md:gap-3 lg:grid-cols-6">
              {catalogItems.map((row) => {
                const rowFactor = shopItemDiscountFactor(
                  getShopDiscounts(userData, userData.village?.structures, row),
                );
                const rowPrice = getShopStackPrice(row, 1, rowFactor);
                return (
                  <li
                    key={row.id}
                    id={
                      row.id === TUTORIAL_ITEM_ID && !isOpen
                        ? "tutorial-itemshop-item"
                        : undefined
                    }
                    className="h-full min-h-0 min-w-0"
                  >
                    <ShopCatalogCard
                      item={row}
                      selected={item?.id === row.id}
                      ryoPrice={rowPrice.ryoCost}
                      canAfford={canAffordShopPrice(userData, rowPrice)}
                      seichiCatalogWord={silverCopy.catalog}
                      onSelect={() => {
                        if (item?.id === row.id) {
                          setItemConfirmOpen(false);
                        } else {
                          setItem(row);
                          setStacksize(1);
                          setIsOpen(true);
                        }
                      }}
                    />
                  </li>
                );
              })}
            </ul>
            {hasNextPage ? (
              <div ref={setLastElement} className="h-px w-full" aria-hidden />
            ) : null}
            {isFetching && catalogItems.length > 0 && (
              <div className="flex justify-center py-8">
                <Loader explanation="Updating catalog…" />
              </div>
            )}
          </>
        )}
      </div>

      {purchaseModal}
    </ContentBox>
  );
};

export default Shop;

function ShopCatalogCard({
  item,
  selected,
  onSelect,
  ryoPrice,
  canAfford,
  seichiCatalogWord,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
  ryoPrice: number;
  canAfford: boolean;
  seichiCatalogWord: string;
}) {
  const lineParts = [
    item.cost > 0 ? `${ryoPrice.toLocaleString()} ryo` : null,
    item.repsCost > 0 ? `${item.repsCost.toLocaleString()} rep` : null,
    item.seichiSilverCost > 0
      ? `${item.seichiSilverCost.toLocaleString()} ${seichiCatalogWord}`
      : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-card text-center shadow-sm transition-colors sm:rounded-xl",
        selected ? "border-primary bg-muted/40" : "border-border hover:bg-muted/30",
      )}
    >
      <div className="flex shrink-0 items-center justify-center px-1.5 pt-1.5 pb-1 sm:px-3 sm:pt-3 sm:pb-2">
        <div className="relative aspect-square size-16 shrink-0 overflow-hidden rounded border border-border/70 bg-muted/20 sm:size-28 sm:rounded-md lg:size-32">
          <ContentImage
            image={item.image}
            alt={item.name}
            rarity={item.rarity ?? undefined}
            hideBorder
            className="h-full max-h-full w-full max-w-full object-contain"
          />
        </div>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-1 border-border border-t px-1.5 pt-1.5 pb-2 sm:px-2.5 sm:pt-2.5 sm:pb-3">
        <div className="min-h-0 min-w-0 flex-1 text-balance">
          <p className="break-words font-semibold text-[11px] leading-tight sm:text-sm">
            {item.name}
          </p>
          {lineParts.length > 0 ? (
            <p className="mt-0.5 text-[9px] text-muted-foreground sm:text-xs">
              {lineParts.join(" · ")}
            </p>
          ) : (
            <p className="mt-0.5 text-[9px] text-muted-foreground sm:text-xs">
              Tap for details
            </p>
          )}
        </div>
        <div
          className={cn(
            "-mx-1.5 flex shrink-0 items-center justify-center gap-0.5 rounded px-1.5 py-0.5 font-medium text-[9px] sm:-mx-2.5 sm:gap-1 sm:rounded-md sm:px-2.5 sm:py-1 sm:text-[11px]",
            canAfford
              ? "bg-emerald-500/15 text-emerald-900 ring-1 ring-emerald-600/30 ring-inset dark:bg-emerald-500/20 dark:text-emerald-50 dark:ring-emerald-400/35"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {canAfford ? (
            <>
              <Check
                className="h-2.5 w-2.5 shrink-0 opacity-90 sm:h-3 sm:w-3"
                aria-hidden
              />
              <span>Afford</span>
            </>
          ) : (
            <>
              <CircleAlert
                className="h-2.5 w-2.5 shrink-0 opacity-90 sm:h-3 sm:w-3"
                aria-hidden
              />
              <span>Can't afford</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

/** First-page catalog size; further rows load through the existing infinite-query cursor. */
const SHOP_CATALOG_PAGE_SIZE = 30;

const SILVER_COPY = {
  seichi: {
    catalog: "seichi",
    purchase: "seichi silver",
    wallet: "Seichi Silver:",
  },
  silver: {
    catalog: "silver",
    purchase: "silver",
    wallet: "Silver:",
  },
} as const;

const SHOP_ITEM_TYPE_TAB_ICON: Partial<Record<ItemType, LucideIcon>> = {
  WEAPON: Sword,
  CONSUMABLE: FlaskConical,
  ARMOR: Shield,
  ACCESSORY: Sparkles,
  MATERIAL: Package,
  COOKING: ChefHat,
  MEAL: ChefHat,
  FURNITURE: Sofa,
  KEYSTONE: Gem,
  CRYSTAL: Diamond,
};

const SHOP_ITEM_TYPE_TAB_HINT: Record<ItemType, string> = {
  WEAPON: "Weapons — damage tags, stat scaling, and battle usage vary by piece.",
  CONSUMABLE: "Consumables — scrolls, pills, and one-off tools for combat and travel.",
  ARMOR: "Armor — defensive layers and resistances for your build.",
  ACCESSORY: "Accessories — rings, charms, and extras that tweak your kit.",
  MATERIAL: "Materials — crafting and upgrade components.",
  COOKING: "Cooking — ingredients and prepared foods for storage.",
  MEAL: "Meals — cooked food with a timed effect.",
  FURNITURE: "Furniture — painted props to place and arrange in your residence.",
  KEYSTONE: "Keystones — slot upgrades and build-defining modifiers.",
  CRYSTAL: "Crystals — special slot items and enhancements.",
  OTHER: "Other — miscellaneous goods in stock.",
};

const SHOP_ITEM_TYPE_TAB_LABEL: Record<ItemType, string> = {
  WEAPON: "Weapon",
  CONSUMABLE: "Consumable",
  ARMOR: "Armor",
  ACCESSORY: "Accessory",
  MATERIAL: "Material",
  COOKING: "Cooking",
  MEAL: "Meals",
  FURNITURE: "Furniture",
  KEYSTONE: "Keystone",
  CRYSTAL: "Crystal",
  OTHER: "Other",
};

function categoryTabIcon(type: ItemType) {
  const cls = "h-4 w-4 shrink-0 opacity-90";
  const Icon = SHOP_ITEM_TYPE_TAB_ICON[type] ?? LayoutGrid;
  return <Icon className={cls} />;
}

/** Optional overrides for the catalog UI (e.g. black-market reputation vs silver). */
export interface ShopCatalogOverrides {
  heroTitle?: string;
  heroDescription?: string;
  heroBadge?: string;
  searchId?: string;
  /** `false` omits the catalog list wrapper id; string overrides. Default: tutorial-itemshop when not `eventItems`. */
  listId?: string | false;
  filterTriggerId?: string;
  /** User-facing Seichi silver wording (`silver` on black market; default village: seichi). */
  silverLabel?: "silver" | "seichi";
  /** Extra controls next to the filter button (e.g. black-market currency tabs). */
  headerExtra?: ReactNode;
}

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
  catalog?: ShopCatalogOverrides;
}
