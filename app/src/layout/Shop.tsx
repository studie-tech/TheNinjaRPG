"use client";

import { Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import type { Item, ItemType } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import {
  getShopFilter,
  ItemShopFiltering,
  useShopFiltering,
} from "@/layout/ItemShopFiltering";
import Loader from "@/layout/Loader";
import { ShopInspector } from "@/layout/shop/ShopInspector";
import { ShopItemCard } from "@/layout/shop/ShopItemCard";
import { cn } from "@/libs/shadui";
import type { ShopCurrency, ShopSort } from "@/libs/shop";
import {
  getShopDiscounts,
  isItemAvailableInStore,
  missingForPrices,
  SHOP_SORTS,
  shopItemDiscountFactor,
  shopItemPrices,
  shopTypeChips,
  sortShopItems,
} from "@/libs/shop";
import { isTutorialItemBuyStep, isTutorialPageMatch } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
import { useAwake, usePublicPathname } from "@/utils/routing";

/** Catalog rows per request; the whole catalog loads so the type chips can count it. */
const SHOP_CATALOG_PAGE_SIZE = 100;

/** Optional overrides for the catalog UI (e.g. black-market reputation vs silver). */
export interface ShopCatalogOverrides {
  /** `false` omits the catalog list id; string overrides. Default: tutorial-itemshop when not `eventItems`. */
  listId?: string | false;
  filterTriggerId?: string;
  /** User-facing Seichi silver wording (`silver` on black market; default village: seichi). */
  silverLabel?: "silver" | "seichi";
  /** Extra controls next to the filter button (e.g. black-market currency tabs). */
  headerExtra?: ReactNode;
}

/**
 * A shop catalog laid out like the Items page: search and sort, type chips with counts and an
 * Affordable chip, item cards with their price, and the picked item's inspector beside the list
 * (a bottom sheet on narrow screens). The village Item Shop, Souvenirs and Black Market share it.
 */
const Shop: React.FC<ShopProps> = (props) => {
  const { userData, defaultType, minCost, minRepsCost, minSeichiSilverCost, catalog } =
    props;
  const silverCopy = SILVER_COPY[catalog?.silverLabel ?? "seichi"];
  const rootRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chip, setChip] = useState<ItemType | "ALL" | "AFFORDABLE">(defaultType);
  const [sort, setSort] = useLocalStorage<ShopSort>(
    `shop:sort:${userData.userId}`,
    "rarity",
  );
  const filteringState = useShopFiltering();
  const isAwake = useAwake(userData);
  const pathname = usePublicPathname();
  const { currentStep, completeTutorialAction } = useTutorialStep();
  // Shop also renders the souvenir and black-market catalogs; the tutorial pin
  // belongs only on the page its step points at.
  const isItemBuyStep =
    isTutorialItemBuyStep(currentStep) &&
    isTutorialPageMatch(currentStep?.page, pathname);

  const { data: tutorialItem } = api.item.get.useQuery(
    { id: TUTORIAL_ITEM_ID },
    { enabled: isItemBuyStep },
  );
  const {
    data: pages,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
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

  // Load the rest of the catalog so chips, counts and sorting cover every item. A failed
  // page stops here; the player retries from the message under the toolbar.
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  // Wide containers show the inspector beside the list; narrow ones use a bottom sheet.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setIsNarrow(entry.contentRect.width < 600);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  if (!isAwake) return <Loader explanation="Redirecting because not awake" />;

  const discountsFor = (item: Pick<Item, "effects"> | null | undefined) =>
    getShopDiscounts(userData, userData.village?.structures, item);
  const wallet: Record<ShopCurrency, number> = {
    ryo: userData.money,
    rep: userData.reputationPoints,
    silver: userData.seichiSilver,
  };

  const loaded = (pages?.pages.flatMap((page) => page.data) ?? []).filter(
    (row) =>
      isItemAvailableInStore(row.expireFromStoreAt) &&
      (!props.restrictTypes?.length || props.restrictTypes.includes(row.itemType)),
  );
  const rows = loaded.map((row) => {
    const prices = shopItemPrices(row, shopItemDiscountFactor(discountsFor(row)));
    return {
      item: row,
      prices,
      canAfford: missingForPrices(prices, wallet).length === 0,
    };
  });
  const chips = shopTypeChips(loaded);
  const affordableCount = rows.filter((row) => row.canAfford).length;
  const activeChip =
    chip === "AFFORDABLE" || chips.some((entry) => entry.value === chip) ? chip : "ALL";
  const shown = sortShopItems(
    rows
      .filter((row) =>
        activeChip === "ALL"
          ? true
          : activeChip === "AFFORDABLE"
            ? row.canAfford
            : row.item.itemType === activeChip,
      )
      .map((row) => ({
        ...row,
        name: row.item.name,
        rarity: row.item.rarity,
        itemType: row.item.itemType,
      })),
    SHOP_SORTS.some((option) => option.value === sort) ? sort : "rarity",
    (row) => row.prices[0]?.amount ?? 0,
  );
  // The tutorial's item leads the list while its step is open.
  if (isItemBuyStep && tutorialItem) {
    const index = shown.findIndex((row) => row.item.id === TUTORIAL_ITEM_ID);
    const pinned =
      index >= 0
        ? shown.splice(index, 1)[0]
        : (() => {
            const prices = shopItemPrices(
              tutorialItem,
              shopItemDiscountFactor(discountsFor(tutorialItem)),
            );
            return {
              item: tutorialItem,
              prices,
              canAfford: missingForPrices(prices, wallet).length === 0,
              name: tutorialItem.name,
              rarity: tutorialItem.rarity,
              itemType: tutorialItem.itemType,
            };
          })();
    if (pinned) shown.unshift(pinned);
  }

  const selected =
    shown.find((row) => row.item.id === selectedId)?.item ??
    loaded.find((row) => row.id === selectedId) ??
    (tutorialItem?.id === selectedId ? tutorialItem : undefined);
  const discounts = discountsFor(selected);
  const listId =
    catalog?.listId === false
      ? undefined
      : (catalog?.listId ?? (props.eventItems ? undefined : "tutorial-itemshop"));

  const inspector = selected && (
    <ShopInspector
      key={selected.id}
      item={selected}
      userData={userData}
      ryoFactor={shopItemDiscountFactor(discounts)}
      discounts={discounts}
      silverCopy={silverCopy}
      onClose={() => setSelectedId(undefined)}
      onPurchased={(itemId) => {
        setSelectedId(undefined);
        if (isItemBuyStep && itemId === TUTORIAL_ITEM_ID) {
          void completeTutorialAction("buyItem");
        }
      }}
    />
  );

  return (
    <ContentBox
      title={props.title ?? "Item Shop"}
      subtitle={props.subtitle ?? "Gear and supplies"}
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
      <div ref={rootRef} className="@container">
        <div className="flex flex-col gap-2 border-b p-2 @min-[600px]:p-3">
          <div className="flex gap-2">
            <label className="bg-background text-muted-foreground flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Search items</span>
              <input
                type="search"
                value={filteringState.name}
                onChange={(event) => filteringState.setName(event.target.value)}
                placeholder="Search"
                className="text-foreground h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as ShopSort)}
                className="bg-background text-foreground h-9 rounded-md border px-1.5 text-sm"
              >
                {SHOP_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((entry) => (
              <ShopChip
                key={entry.value}
                label={entry.label}
                count={entry.count}
                isActive={entry.value === activeChip}
                onClick={() => setChip(entry.value)}
              />
            ))}
            <ShopChip
              label="Affordable"
              count={affordableCount}
              isActive={activeChip === "AFFORDABLE"}
              onClick={() => setChip("AFFORDABLE")}
              accent
            />
          </div>
        </div>
        {isFetchNextPageError && (
          <p role="alert" className="text-destructive border-b px-3 py-2 text-sm">
            Some items could not load.{" "}
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => void fetchNextPage()}
            >
              Try again
            </Button>
          </p>
        )}
        <div className="grid @min-[600px]:grid-cols-[minmax(0,1fr)_24rem]">
          <ul
            id={listId}
            aria-label="Shop items"
            className="grid min-w-0 list-none grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] content-start gap-2 p-2 @min-[600px]:max-h-[600px] @min-[600px]:overflow-y-auto @min-[600px]:p-3"
          >
            {shown.map((row) => (
              <li
                key={row.item.id}
                id={
                  row.item.id === TUTORIAL_ITEM_ID && selectedId !== TUTORIAL_ITEM_ID
                    ? "tutorial-itemshop-item"
                    : undefined
                }
              >
                <ShopItemCard
                  item={row.item}
                  prices={row.prices}
                  wallet={wallet}
                  silverLabel={silverCopy.catalog}
                  isSelected={row.item.id === selectedId}
                  onSelect={() =>
                    setSelectedId(row.item.id === selectedId ? undefined : row.item.id)
                  }
                />
              </li>
            ))}
            {shown.length === 0 && (
              <li className="text-muted-foreground col-span-full py-10 text-center text-sm">
                {isFetching ? (
                  <Loader explanation="Loading catalog" />
                ) : loaded.length === 0 ? (
                  "Nothing for sale here right now."
                ) : (
                  "No items match. Try another chip or clear the search."
                )}
              </li>
            )}
          </ul>
          {!isNarrow && (
            <aside
              aria-label="Item"
              className="bg-poppopover max-h-[600px] min-w-0 overflow-y-auto border-l-2 border-dashed p-3 @max-[600px]:hidden"
            >
              {inspector ?? (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  Pick an item to see its effects and buy it.
                </p>
              )}
            </aside>
          )}
        </div>
      </div>
      {isNarrow && (
        <Sheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelectedId(undefined)}
        >
          <SheetContent
            side="bottom"
            // The inspector draws its own close button in its header.
            showCloseButton={false}
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            // The sheet's strict containment would ignore the inspector's height; keep it
            // content-sized up to the maximum.
            style={{ contain: "layout paint" }}
          >
            <SheetTitle className="sr-only">{selected?.name ?? "Item"}</SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </ContentBox>
  );
};

/** One filter chip, styled like the backpack's. */
function ShopChip({
  label,
  count,
  isActive,
  onClick,
  accent,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-2.5 text-xs",
        isActive
          ? "border-primary bg-primary text-primary-foreground font-semibold"
          : "bg-background hover:bg-muted",
        accent && !isActive && "border-amber-400 text-amber-900 dark:text-amber-200",
      )}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

const SILVER_COPY = {
  seichi: { catalog: "seichi", purchase: "seichi silver" },
  silver: { catalog: "silver", purchase: "silver" },
} as const;

interface ShopProps {
  userData: NonNullable<UserWithRelations>;
  /** The chip the shop opens on, when it has items of that type. */
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

export default Shop;
