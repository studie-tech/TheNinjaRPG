import type { LucideIcon } from "lucide-react";
import {
  Check,
  ChefHat,
  ChevronDown,
  CircleAlert,
  Coins,
  Diamond,
  FlaskConical,
  Gem,
  Gift,
  Layers,
  LayoutGrid,
  Package,
  Search,
  Shield,
  ShoppingBag,
  Sofa,
  Sparkles,
  Sword,
  Tag,
  TriangleAlert,
} from "lucide-react";
import dynamic from "next/dynamic";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPurchasedAllowances } from "@/deltas/item";
import {
  ItemTypes,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_COPY_LIMITS,
  KESSEN_PACK_NORMAL_SLOTS,
  TUTORIAL_ITEM_ID,
} from "@/drizzle/constants";
import type { Item, ItemType } from "@/drizzle/schema";
import { useKessenHubCache } from "@/hooks/kessen/useKessenHubCache";
import { useTutorialStep } from "@/hooks/tutorial";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import Image from "@/layout/Image";
import {
  getShopFilter,
  ItemShopFiltering,
  useShopFiltering,
} from "@/layout/ItemShopFiltering";
import ItemWithEffects, { KessenPackRules } from "@/layout/ItemWithEffects";
import { itemCardDisplay } from "@/layout/items/cardDisplay";
import { WaxSealGlyph } from "@/layout/kessen/glyphs";
import { kessenPackArt, kessenRenditionWidth } from "@/layout/kessen/kessenArt";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { isKessenGood } from "@/libs/kessen/cardSale";
import { KESSEN_FACTION_NAMES, kessenVillagePackFaction } from "@/libs/kessen/packs";
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
import { parseHtml } from "@/utils/parse";
import { useAwake, usePublicPathname } from "@/utils/routing";
import { useUserInfo } from "@/utils/UserContext";
import type { KessenFaction } from "@/validators/itemCard";

// The Kessen card face and its stylesheet load only when the Card Master shows a card.
const CardFace = dynamic(
  () => import("@/layout/kessen/CardFace").then((mod) => mod.CardFace),
  { ssr: false },
);

const Shop: React.FC<ShopProps> = (props) => {
  const { userData, defaultType, minCost, minRepsCost, minSeichiSilverCost, catalog } =
    props;

  const { prepareUserUpdate, updateUser } = useUserInfo();
  // The Card Master stall sits under its own heading: one line of copy, card wording and
  // text no smaller than the stall's 12 px body size.
  const cardStall = !!props.cardStall;
  // Owned copies tell a single that fills the deck limit from one that would be surplus.
  const kessenHub = api.kessen.getHub.useQuery(undefined, {
    enabled: cardStall,
    staleTime: 60_000,
  });
  const hubCache = useKessenHubCache();
  const [stallFaction, setStallFaction] = useState<KessenFaction | "ALL">("ALL");
  const [hideMaxed, setHideMaxed] = useState(false);
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
    () => (props.restrictTypes?.length ? props.restrictTypes : GENERAL_SHOP_ITEM_TYPES),
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
      kessenGoods: props.cardStall ? "only" : "exclude",
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

  // The stall's limited listings read their allowances in one batch per loaded catalog.
  const stallAllowanceKey = {
    ids: cardStall ? catalogItems.filter(hasPurchaseLimit).map((row) => row.id) : [],
  };
  const stallAllowances = api.item.getPurchaseAllowances.useQuery(stallAllowanceKey, {
    enabled: stallAllowanceKey.ids.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const { mutate: purchase, isPending: isPurchasing } = api.item.buy.useMutation({
    onMutate: () => ({
      revision: prepareUserUpdate(),
      hub: hubCache.prepareHubUpdate(),
      allowanceKey: stallAllowanceKey,
    }),
    onSuccess: (data, variables, snapshots) => {
      showMutationToast(data);
      const revision = snapshots?.revision;
      if (data.success) {
        setItemConfirmOpen(false);
        void updateUser(data.userPatch, { revision, delta: data.userDelta });
        if (cardStall && snapshots) {
          void hubCache.creditHubGrants(
            [{ itemId: variables.itemId, quantity: variables.stack }],
            snapshots.hub,
          );
        }
        void utils.item.getUserItems.invalidate();
        void utils.item.getPurchaseAllowance.invalidate();
        if (snapshots?.allowanceKey.ids.length) {
          utils.item.getPurchaseAllowances.setData(snapshots.allowanceKey, (current) =>
            current
              ? getPurchasedAllowances(current, variables.itemId, variables.stack)
              : current,
          );
        }
        if (item?.itemType === "FURNITURE") {
          void utils.home.getUserHome.invalidate();
        }
        if (isItemBuyStep && variables.itemId === TUTORIAL_ITEM_ID) {
          void completeTutorialAction("buyItem");
        }
      } else {
        setPurchaseError(data.message);
        void allowance.refetch();
        if (snapshots?.allowanceKey.ids.length)
          void utils.item.getPurchaseAllowances.invalidate(snapshots.allowanceKey);
      }
    },
    onError: (error) => setPurchaseError(error.message),
  });

  // Kessen goods keep their listed prices: discounts would undercut the packs' ryo sink.
  const discountsFor = (row: Item | undefined) =>
    props.cardStall || (row && isKessenGood(row))
      ? []
      : getShopDiscounts(userData, userData.village?.structures, row);
  const discounts = discountsFor(item);
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

  /** Owned and deck-limit copies of a single card; null for packs or before the hub loads. */
  const copiesOf = (row: Item) =>
    cardStall && row.itemType === "CARD" && kessenHub.data
      ? {
          owned: kessenHub.data.owned[row.id] ?? 0,
          max: KESSEN_COPY_LIMITS[row.rarity],
        }
      : null;
  const selectedCopies = item ? copiesOf(item) : null;
  // Copies of this purchase beyond what a deck can hold.
  const selectedSurplus = selectedCopies
    ? Math.min(
        stacksize,
        Math.max(0, selectedCopies.owned + stacksize - selectedCopies.max),
      )
    : 0;

  const selectedItemType = filteringState.itemType as ItemType;
  const tabLabels = cardStall ? CARD_STALL_TAB_LABEL : SHOP_ITEM_TYPE_TAB_LABEL;
  // The Card Master's singles can be narrowed to one faction.
  const isStallCards = cardStall && selectedItemType === "CARD";
  const stallFactions = isStallCards
    ? [
        ...new Set(
          catalogItems.flatMap((row) => (row.cardData ? [row.cardData.faction] : [])),
        ),
      ].sort((x, y) => KESSEN_FACTION_NAMES[x].localeCompare(KESSEN_FACTION_NAMES[y]))
    : [];
  const shownItems = isStallCards
    ? catalogItems.filter((row) => {
        if (stallFaction !== "ALL" && row.cardData?.faction !== stallFaction)
          return false;
        const copies = hideMaxed ? copiesOf(row) : null;
        return !copies || copies.owned < copies.max;
      })
    : catalogItems;
  const tabHint = (cardStall ? CARD_STALL_TAB_HINT : SHOP_ITEM_TYPE_TAB_HINT)[
    selectedItemType
  ];

  if (!isAwake) return <Loader explanation="Redirecting because not awake" />;

  const quantitySlider =
    item?.canStack && item.stackSize > 1 && maxPurchaseQuantity > 0 ? (
      <UncontrolledSliderField
        id="stackSize"
        label={`How many to buy: ${stacksize}`}
        value={stacksize}
        min={1}
        max={maxPurchaseQuantity}
        setValue={setStacksize}
      />
    ) : undefined;

  const purchaseModal = isOpen && item && (
    <Modal
      id="tutorial-itemshop-confirmPurchase"
      title={cardStall ? `Buy ${item.name}` : "Confirm Purchase"}
      proceed_label={
        isPurchasing
          ? undefined
          : allowance.data?.remaining === 0
            ? `Limit reached ${STALL_PERIOD_LABEL[allowance.data.period] ?? ""}`.trim()
            : !canAfford
              ? missingString
              : cardStall && selectedSurplus > 0
                ? `Buy ${selectedSurplus === 1 ? "surplus copy" : "with surplus"} · ${ryoCost.toLocaleString()} ryo`
                : costString
      }
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
        cardStall
          ? canAfford
            ? STALL.buy
            : STALL.cannotBuy
          : canAfford
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-red-600 text-white hover:bg-red-700"
      }
      className={cardStall ? STALL.dialog : undefined}
      bodyClassName={cardStall ? "text-base" : undefined}
      footerClassName={cardStall ? STALL.dialogFooter : undefined}
      closeButton={!cardStall}
      footerExtra={
        cardStall ? (
          <>
            {/* Price, balance and the limit stay above the buttons while the body scrolls. */}
            {!isPurchasing && (
              <StallPurchaseSummary
                itemId={item.id}
                totalPrice={ryoCost}
                eachPrice={getShopStackPrice(item, 1, 1).ryoCost}
                money={userData.money}
                allowance={allowance.data ?? null}
                quantity={stacksize}
                maxQuantity={
                  item.canStack && item.stackSize > 1
                    ? Math.max(0, maxPurchaseQuantity)
                    : 1
                }
                setQuantity={setStacksize}
              />
            )}
            <Button
              type="button"
              variant="outline"
              disabled={isPurchasing}
              onClick={() => setItemConfirmOpen(false)}
              className={cn("order-1", STALL.close)}
            >
              Close
            </Button>
          </>
        ) : undefined
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
      {cardStall && !isPurchasing && (
        <StallPurchaseDetails
          item={item}
          copies={copiesOf(item)}
          surplus={selectedSurplus}
          quantity={stacksize}
        />
      )}
      {!cardStall && allowance.data?.limit != null && (
        <p className="pb-3 text-sm">
          {`Limit: ${allowance.data.limit} units ${allowance.data.period.toLowerCase()} (UTC${allowance.data.period === "WEEKLY" ? ", resets Monday" : ""}). Purchased: ${allowance.data.purchased}. Remaining: ${allowance.data.remaining}.`}
        </p>
      )}
      {!cardStall && (
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
      )}
      {!isPurchasing && !cardStall && (
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
          {quantitySlider}
        </>
      )}
      {isPurchasing && <Loader explanation={`Purchasing ${item.name}`} />}
    </Modal>
  );

  const selectRow = (row: Item) => {
    if (item?.id === row.id) {
      setItemConfirmOpen(false);
    } else {
      setItem(row);
      setStacksize(1);
      setIsOpen(true);
    }
  };

  const headerControls = (
    <div className="flex flex-row flex-wrap items-center justify-end gap-2">
      {catalog?.headerExtra}
      {/* The stall's few goods need only its tabs and name search. */}
      {!props.cardStall && (
        <ItemShopFiltering
          state={filteringState}
          filterTriggerId={catalog?.filterTriggerId}
        />
      )}
    </div>
  );

  const catalogBody = (
    <>
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
      {!cardStall && (
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
      )}

      <Tabs
        value={selectedItemType}
        onValueChange={(value) => {
          filteringState.setItemType(value as ItemType);
          setItemConfirmOpen(false);
        }}
        className="contents"
      >
        <div
          className={cn(
            "border-b px-2 py-3 md:px-6 md:py-4",
            cardStall ? STALL.rule : "bg-linear-to-b from-amber-950/10 to-muted/30",
          )}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-1.5 sm:gap-2">
            <TabsList
              className={
                cardStall
                  ? STALL.tabList
                  : "flex flex-nowrap justify-start gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg bg-muted/90 p-0.5 shadow-inner ring-1 ring-border/50 sm:grid sm:grid-cols-4 sm:gap-1 sm:overflow-visible sm:rounded-xl sm:p-1 lg:grid-cols-8 dark:bg-muted/40"
              }
              aria-label="Item category"
            >
              {itemTypeTabOptions.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className={
                    cardStall
                      ? cn(
                          STALL.tab,
                          selectedItemType === t ? STALL.tabActive : STALL.tabIdle,
                        )
                      : cn(
                          "flex min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 whitespace-normal rounded-md px-1 py-1.5 font-semibold text-[10px] transition-all sm:min-w-0 sm:flex-row sm:gap-2 sm:rounded-lg sm:px-1 sm:py-3 sm:text-xs",
                          selectedItemType === t
                            ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                            : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                        )
                  }
                >
                  {categoryTabIcon(t, cardStall)}
                  <span className="text-center leading-tight">{tabLabels[t]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <p
              className={cn(
                "hidden text-balance text-center text-muted-foreground text-xs leading-relaxed sm:block",
                cardStall && cn("block text-base", STALL.muted),
              )}
            >
              {tabHint}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "border-b px-2 py-3 md:px-5 md:py-4",
            cardStall ? STALL.rule : "bg-muted/25",
          )}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <Label
                htmlFor={catalogSearchId}
                className={cn(
                  "text-muted-foreground text-xs uppercase",
                  cardStall && cn("text-base normal-case", STALL.muted),
                )}
              >
                {cardStall ? "Search the stall" : "Search catalog"}
              </Label>
              <div className="relative mt-1">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={catalogSearchId}
                  placeholder={
                    cardStall ? "Search by card or pack name…" : "Search by item name…"
                  }
                  value={filteringState.name}
                  onChange={(e) => filteringState.setName(e.target.value)}
                  className={cn(
                    "h-11 rounded-xl border-border/80 bg-background pl-10 shadow-sm",
                    cardStall && STALL.search,
                  )}
                />
              </div>
            </div>
            {isStallCards && stallFactions.length > 1 && (
              <label className={cn("flex flex-col gap-1 lg:w-48", STALL.muted)}>
                Faction
                <select
                  value={stallFaction}
                  onChange={(event) =>
                    setStallFaction(event.target.value as KessenFaction | "ALL")
                  }
                  className={cn("px-2", STALL.search)}
                >
                  <option value="ALL">All factions</option>
                  {stallFactions.map((faction) => (
                    <option key={faction} value={faction}>
                      {KESSEN_FACTION_NAMES[faction]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isStallCards && kessenHub.data && (
              <button
                type="button"
                aria-pressed={hideMaxed}
                onClick={() => setHideMaxed(!hideMaxed)}
                className={cn(
                  "h-[40px] shrink-0 rounded-lg border px-3 font-semibold text-base pointer-coarse:h-[44px]",
                  hideMaxed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                )}
              >
                Hide maxed
              </button>
            )}
            {!cardStall && (
              <p className="hidden text-muted-foreground text-xs sm:block lg:max-w-xs lg:text-right">
                More filters (rarity, slot, effects, …) stay in the filter button above.
              </p>
            )}
          </div>
        </div>

        <TabsContent value={selectedItemType} className="mt-0">
          <div className="px-1.5 py-2 sm:px-3 sm:py-3 md:p-5" id={catalogListDomId}>
            {!shownItems.length && (isFetching || hasNextPage) ? (
              <div className="flex min-h-[40vh] flex-col items-center justify-center">
                <Loader explanation="Loading catalog…" />
                {hasNextPage ? (
                  <div ref={setLastElement} className="h-px w-full" aria-hidden />
                ) : null}
              </div>
            ) : !shownItems.length ? (
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
                <ul
                  className={cn(
                    "mx-auto grid max-w-7xl list-none",
                    // The stall sits in a narrow column, so its tiles size from the column.
                    isStallCards
                      ? "grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
                      : cardStall
                        ? "grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2 sm:gap-3"
                        : "grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4 md:gap-3 lg:grid-cols-6",
                  )}
                >
                  {shownItems.map((row) => {
                    const rowFactor = shopItemDiscountFactor(discountsFor(row));
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
                        {cardStall ? (
                          <StallCatalogCard
                            item={row}
                            selected={item?.id === row.id}
                            ryoPrice={rowPrice.ryoCost}
                            canAfford={canAffordShopPrice(userData, rowPrice)}
                            copies={copiesOf(row)}
                            allowance={
                              stallAllowances.data?.find(
                                (entry) => entry.itemId === row.id,
                              ) ?? null
                            }
                            onSelect={() => selectRow(row)}
                          />
                        ) : (
                          <ShopCatalogCard
                            item={row}
                            selected={item?.id === row.id}
                            ryoPrice={rowPrice.ryoCost}
                            canAfford={canAffordShopPrice(userData, rowPrice)}
                            seichiCatalogWord={silverCopy.catalog}
                            onSelect={() => selectRow(row)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {hasNextPage ? (
                  <div ref={setLastElement} className="h-px w-full" aria-hidden />
                ) : null}
                {isFetching && shownItems.length > 0 && (
                  <div className="flex justify-center py-8">
                    <Loader explanation="Updating catalog…" />
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {purchaseModal}
    </>
  );

  if (cardStall) {
    return (
      <section
        aria-label={props.title ?? "Card Master"}
        // The stall wears the Card Hall's lacquer and gold.
        className={STALL.surface}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          {props.subtitle && (
            <p className={cn("min-w-0 flex-1", STALL.muted)}>{props.subtitle}</p>
          )}
          {headerControls}
        </div>
        {catalogBody}
      </section>
    );
  }

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
      topRightContent={headerControls}
    >
      {catalogBody}
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

/**
 * One Card Master listing: pack art on a lantern glow (card art for singles), the name
 * wrapped at word breaks, the price lit in gold when the player can pay it, and a wax-seal
 * chip with what is left of the purchase limit.
 */
function StallCatalogCard({
  item,
  selected,
  onSelect,
  ryoPrice,
  canAfford,
  copies,
  allowance,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
  ryoPrice: number;
  canAfford: boolean;
  /** Owned copies against the deck limit, for single cards. */
  copies: { owned: number; max: number } | null;
  /** The listing's purchase allowance; null until the stall's batch loads. */
  allowance: StallAllowance | null;
}) {
  const isPack = item.itemType !== "CARD";
  const isMaxed = !!copies && copies.owned >= copies.max;
  const isSoldOut = allowance?.remaining === 0;
  const limit = hasPurchaseLimit(item)
    ? allowance
      ? stallAllowanceLabel(allowance, item.id)
      : purchaseLimitLabel(item)
    : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex h-full w-full flex-col items-center gap-1.5 rounded-lg border bg-card p-2 text-center text-card-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary",
        selected && "border-primary ring-2 ring-primary/40",
      )}
    >
      {isPack ? (
        <span
          className={cn(
            "relative aspect-square w-full max-w-[140px] overflow-hidden rounded-md shadow-md",
            isSoldOut && "opacity-50 grayscale-[60%]",
          )}
        >
          <Image
            src={kessenPackArt(item.id)}
            alt=""
            width={kessenRenditionWidth(140)}
            height={kessenRenditionWidth(140)}
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <span className="relative aspect-square w-full max-w-[5.5rem] overflow-hidden rounded border">
          <ContentImage
            image={item.image}
            alt=""
            rarity={item.rarity ?? undefined}
            hideBorder
            className="h-full w-full object-contain"
          />
        </span>
      )}
      <span
        className="hyphens-auto break-normal font-semibold text-base leading-tight"
        style={{ fontFamily: "var(--kessen-font-display)" }}
      >
        {item.name}
      </span>
      {copies && (
        <span
          className={cn(
            "rounded-sm px-1.5 font-semibold text-[11px] leading-snug",
            isMaxed ? "bg-muted text-muted-foreground" : "text-muted-foreground",
          )}
        >
          {isMaxed
            ? `Maxed · own ${copies.owned}`
            : `Owned ${copies.owned}/${copies.max}`}
        </span>
      )}
      <span
        className={cn(
          "mt-auto inline-flex items-center gap-1 font-semibold text-lg tabular-nums",
          isSoldOut ? STALL.muted : canAfford ? "text-primary" : "text-destructive",
        )}
        style={{ fontFamily: "var(--kessen-font-display)" }}
      >
        <Coins className="h-[15px] w-[15px] shrink-0" aria-hidden />
        {ryoPrice.toLocaleString()}
        <span className="sr-only"> ryo</span>
        {!canAfford && <span className="sr-only"> (you cannot afford it)</span>}
      </span>
      {limit && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px] leading-tight",
            isSoldOut
              ? "bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          <WaxSealGlyph className="h-[14px] w-[14px] shrink-0" />
          {limit}
        </span>
      )}
    </button>
  );
}

/**
 * The scrolling body of the Card Master confirmation: the card face or pack art, the pack's
 * description, how many copies the player owns and whether this purchase would be surplus,
 * and the pack rules folded under "How bundles work".
 */
function StallPurchaseDetails({
  item,
  copies,
  surplus,
  quantity,
}: {
  item: Item;
  copies: { owned: number; max: number } | null;
  /** Copies of this purchase beyond the deck limit. */
  surplus: number;
  quantity: number;
}) {
  const card = item.itemType === "CARD" ? itemCardDisplay(item) : null;
  const sellBack = KESSEN_CARD_SELL_VALUES[item.rarity];
  return (
    <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start [@media(max-height:500px)]:grid-cols-[auto_minmax(0,1fr)]">
      <div className="flex justify-center">
        {card ? (
          <span className="block aspect-[5/7] w-[min(220px,70vw)] [@media(max-height:500px)]:w-[110px]">
            <CardFace card={card} renderSize={220} priority className="w-full" />
          </span>
        ) : (
          <span className="block size-[160px] overflow-hidden rounded-lg shadow-md [@media(max-height:500px)]:size-[104px]">
            <Image
              src={kessenPackArt(item.id)}
              alt=""
              width={kessenRenditionWidth(160)}
              height={kessenRenditionWidth(160)}
              className="h-full w-full object-cover"
            />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 text-base leading-snug">
        {!card && item.description && (
          <div data-reading-text>{parseHtml(item.description)}</div>
        )}
        {copies &&
          (surplus > 0 ? (
            <div
              role="note"
              className="flex gap-2 rounded-md border border-amber-500/70 bg-amber-500/15 p-2"
            >
              <TriangleAlert
                className="mt-0.5 h-[16px] w-[16px] shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              <p>
                <b>
                  {surplus === quantity
                    ? quantity === 1
                      ? "This copy would be surplus."
                      : `All ${quantity} copies would be surplus.`
                    : `${surplus} of these ${quantity} copies would be surplus.`}
                </b>{" "}
                You own {copies.owned} and a deck holds at most {copies.max}. Decks
                cannot use surplus copies; each sells back for{" "}
                {sellBack.toLocaleString()} ryo from the Cards bag on your Items page.
              </p>
            </div>
          ) : (
            <p>
              You own {copies.owned} of the {copies.max}{" "}
              {copies.max === 1 ? "copy" : "copies"} a deck can hold.
            </p>
          ))}
        {!card && (
          <details className="group rounded-md border bg-muted/40">
            <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 px-2 font-semibold text-primary pointer-coarse:min-h-[44px] [&::-webkit-details-marker]:hidden">
              How bundles work
              <ChevronDown
                className="h-[16px] w-[16px] shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                aria-hidden
              />
            </summary>
            <KessenPackRules
              packItemId={item.id}
              inStall
              className="px-2 pb-2 text-base"
            />
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * The pinned foot of the Card Master confirmation, above its buttons: the total in the
 * hall's numerals, the player's ryo, a wax-seal chip with the purchase limit left and a
 * quantity stepper for packs.
 */
function StallPurchaseSummary({
  itemId,
  totalPrice,
  eachPrice,
  money,
  allowance,
  quantity,
  maxQuantity,
  setQuantity,
}: {
  itemId: string;
  totalPrice: number;
  eachPrice: number;
  money: number;
  allowance: StallAllowance | null;
  quantity: number;
  maxQuantity: number;
  setQuantity: (quantity: number) => void;
}) {
  const limit =
    allowance?.limit != null ? stallAllowanceLabel(allowance, itemId) : null;
  return (
    <div className="order-0 flex w-full basis-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t pt-2 text-left">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span
            className="inline-flex items-center gap-1 font-semibold text-primary text-xl tabular-nums"
            style={{ fontFamily: "var(--kessen-font-display)" }}
          >
            <Coins className="h-[16px] w-[16px] shrink-0 self-center" aria-hidden />
            {totalPrice.toLocaleString()}
            <span className="sr-only"> ryo</span>
          </span>
          <span className={STALL.muted}>
            {quantity > 1 && `${eachPrice.toLocaleString()} each · `}you have{" "}
            {money.toLocaleString()} ryo
          </span>
        </p>
        {limit && (
          <span
            className={cn(
              "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px] leading-tight",
              allowance?.remaining === 0
                ? "bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            <WaxSealGlyph className="h-[14px] w-[14px] shrink-0" />
            {limit}
          </span>
        )}
      </div>
      {maxQuantity > 1 && (
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">How many to buy</legend>
          <button
            type="button"
            aria-label="Buy one fewer"
            disabled={quantity <= 1}
            onClick={() => setQuantity(quantity - 1)}
            className={STALL.step}
          >
            −
          </button>
          <output
            aria-live="polite"
            className="min-w-[3ch] text-center font-semibold text-lg tabular-nums"
          >
            {quantity}
          </output>
          <button
            type="button"
            aria-label="Buy one more"
            disabled={quantity >= maxQuantity}
            onClick={() => setQuantity(quantity + 1)}
            className={STALL.step}
          >
            +
          </button>
        </fieldset>
      )}
    </div>
  );
}

/** Card Hall classes of the Card Master stall; tokens come from the Kessen stylesheet. */
const STALL = {
  surface: "bg-card text-base text-card-foreground",
  rule: "border-border",
  muted: "text-muted-foreground",
  tabList: "grid h-auto grid-cols-2 gap-1 rounded-lg bg-muted p-1",
  tab: "flex min-h-[40px] flex-row items-center justify-center gap-2 rounded-md px-2 font-semibold text-base pointer-coarse:min-h-[44px]",
  tabActive:
    "bg-background text-foreground shadow-sm data-[state=active]:bg-background",
  tabIdle: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
  dialog: "md:max-w-xl",
  dialogFooter:
    "sm:flex-wrap [&>:is(button,a)]:min-h-[44px] [&>:is(button,a)]:text-base sm:[&>:is(button,a)]:min-h-[44px] sm:[&>:is(button,a)]:px-5 sm:[&>:is(button,a)]:text-base",
  buy: "",
  cannotBuy: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  close: "",
  step: "flex size-[44px] shrink-0 items-center justify-center rounded-lg border bg-background font-semibold text-[18px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40",
  search:
    "h-[40px] rounded-lg text-base pointer-coarse:h-[44px] pointer-coarse:text-[16px]",
};

/** Whether a listing has a purchase limit that resets each period. */
const hasPurchaseLimit = (item: Pick<Item, "purchaseLimit" | "purchaseLimitPeriod">) =>
  !!item.purchaseLimit && item.purchaseLimitPeriod !== "NONE";

/**
 * "Limit 3 per day" for listings with a purchase limit; null otherwise. Village Bundles
 * share one limit, which the label names.
 */
const purchaseLimitLabel = (
  item: Pick<Item, "id" | "purchaseLimit" | "purchaseLimitPeriod">,
) =>
  item.purchaseLimit && item.purchaseLimitPeriod !== "NONE"
    ? `Limit ${item.purchaseLimit} per ${PURCHASE_LIMIT_PERIOD_WORD[item.purchaseLimitPeriod]}${kessenVillagePackFaction(item.id) ? ", any village" : ""}`
    : null;

/** "today", "this week" for the stall's remaining purchase allowance. */
const STALL_PERIOD_LABEL: Record<string, string> = {
  DAILY: "today",
  WEEKLY: "this week",
  MONTHLY: "this month",
};

/**
 * When a used-up purchase limit refills. Limits run on UTC periods, which the stall's
 * subtitle states, so the weekly and monthly chips name only the day.
 */
const STALL_PERIOD_RESET: Record<string, string> = {
  DAILY: "resets 00:00 UTC",
  WEEKLY: "resets Monday",
  MONTHLY: "resets on the 1st",
};

/**
 * "2 of 3 left today", or "Sold out · resets 00:00 UTC" once the limit is used up. The
 * Village Bundles share one limit: their label names every village while it is open and
 * reads as a used limit, not sold-out stock, once any of them was bought.
 */
const stallAllowanceLabel = (allowance: StallAllowance, itemId: string) => {
  if (allowance.limit == null || allowance.remaining == null) return null;
  const shared = !!kessenVillagePackFaction(itemId);
  const reset = STALL_PERIOD_RESET[allowance.period] ?? "resets soon";
  if (allowance.remaining === 0)
    return shared ? `Limit used · ${reset}` : `Sold out · ${reset}`;
  const left =
    `${allowance.remaining} of ${allowance.limit} left ${STALL_PERIOD_LABEL[allowance.period] ?? ""}`.trim();
  return shared ? `${left} · any village` : left;
};

const PURCHASE_LIMIT_PERIOD_WORD = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
} as const;

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

/** Tabs of shops that do not restrict their types; cards sell only at the Card Master stall. */
const GENERAL_SHOP_ITEM_TYPES = ItemTypes.filter((type) => type !== "CARD");

const SHOP_ITEM_TYPE_TAB_ICON: Partial<Record<ItemType, LucideIcon>> = {
  WEAPON: Sword,
  CONSUMABLE: FlaskConical,
  ARMOR: Shield,
  ACCESSORY: Sparkles,
  MATERIAL: Package,
  COOKING: ChefHat,
  MEAL: ChefHat,
  FURNITURE: Sofa,
  COSMETIC: Sparkles,
  CARD: Layers,
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
  COSMETIC: "Cosmetics — consume to unlock an appearance for the Cosmetic tab.",
  CARD: "Cards — Kessen cards for your collection and decks.",
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
  COSMETIC: "Cosmetic",
  CARD: "Cards",
  KEYSTONE: "Keystone",
  CRYSTAL: "Crystal",
  OTHER: "Other",
};

/** Card Master stall tab names: its consumables are card packs. */
const CARD_STALL_TAB_LABEL: Record<ItemType, string> = {
  ...SHOP_ITEM_TYPE_TAB_LABEL,
  CONSUMABLE: "Packs",
  CARD: "Cards",
};

const CARD_STALL_TAB_HINT: Record<ItemType, string> = {
  ...SHOP_ITEM_TYPE_TAB_HINT,
  CONSUMABLE: `${KESSEN_PACK_NORMAL_SLOTS + 1} cards per pack; the last is Rare or better. The six Village Bundles share one weekly limit.`,
  CARD: "Common and Rare singles. Epics and better come from packs and the Circuit.",
};

function categoryTabIcon(type: ItemType, cardStall: boolean) {
  const cls = "h-4 w-4 shrink-0 opacity-90";
  // The Card Master's consumables are tied card bundles.
  const Icon =
    cardStall && type === "CONSUMABLE"
      ? Gift
      : (SHOP_ITEM_TYPE_TAB_ICON[type] ?? LayoutGrid);
  return <Icon className={cls} aria-hidden />;
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

/** What `item.getPurchaseAllowance` reports for one listing. */
interface StallAllowance {
  period: string;
  limit: number | null;
  remaining: number | null;
}

interface ShopProps {
  userData: NonNullable<UserWithRelations>;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
  /** The Card Master stall lists only Kessen goods; every other shop leaves them out. */
  cardStall?: boolean;
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
