import type { LucideIcon } from "lucide-react";
import {
  Check,
  CircleAlert,
  Diamond,
  FlaskConical,
  Gem,
  LayoutGrid,
  Package,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Sword,
  Tag,
  Ticket,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  ItemTypes,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
} from "@/drizzle/constants";
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
import Modal2 from "@/layout/Modal2";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useAwake } from "@/utils/routing";
import { getStrucBoost } from "@/utils/village";

/** Optional overrides for the catalog UI (e.g. black market uses several at once). */
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
  KEYSTONE: Gem,
  CRYSTAL: Diamond,
};

const SHOP_ITEM_TYPE_TAB_HINT: Record<ItemType, string> = {
  WEAPON: "Weapons — damage tags, stat scaling, and battle usage vary by piece.",
  CONSUMABLE: "Consumables — scrolls, pills, and one-off tools for combat and travel.",
  ARMOR: "Armor — defensive layers and resistances for your build.",
  ACCESSORY: "Accessories — rings, charms, and extras that tweak your kit.",
  MATERIAL: "Materials — crafting and upgrade components.",
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
  KEYSTONE: "Keystone",
  CRYSTAL: "Crystal",
  OTHER: "Other",
};

const MIN_ITEM_SHOP_DISCOUNT_FACTOR = 0.05;

function categoryTabIcon(type: ItemType) {
  const cls = "h-4 w-4 shrink-0 opacity-90";
  const Icon = SHOP_ITEM_TYPE_TAB_ICON[type] ?? LayoutGrid;
  return <Icon className={cls} />;
}

function shopItemDiscountFactor(
  item: Item,
  structureDiscountPerc: number,
  anbuDiscountPerc: number,
) {
  const healDiscount = item.effects.some((e) => e.type === "heal")
    ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
    : 0;
  return Math.max(
    MIN_ITEM_SHOP_DISCOUNT_FACTOR,
    (100 - structureDiscountPerc - anbuDiscountPerc - healDiscount) / 100,
  );
}

function ShopCatalogCard({
  item,
  selected,
  onSelect,
  previewFactor,
  canAfford,
  seichiCatalogWord,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
  previewFactor: number;
  canAfford: boolean;
  seichiCatalogWord: string;
}) {
  const ryo = item.cost > 0 ? Math.ceil(item.cost * previewFactor) : null;
  const lineParts = [
    ryo !== null ? `${ryo.toLocaleString()} ryo` : null,
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
            className="h-full w-full max-h-full max-w-full object-contain"
          />
        </div>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-1 border-border border-t px-1.5 pt-1.5 pb-2 sm:px-2.5 sm:pt-2.5 sm:pb-3">
        <div className="min-h-0 min-w-0 flex-1 text-balance">
          <p className="text-[11px] font-semibold leading-tight break-words sm:text-sm">
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
              ? "bg-emerald-500/15 text-emerald-900 ring-1 ring-inset ring-emerald-600/30 dark:bg-emerald-500/20 dark:text-emerald-50 dark:ring-emerald-400/35"
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

const Shop: React.FC<ShopProps> = (props) => {
  const { userData, defaultType, minCost, minRepsCost, minSeichiSilverCost, catalog } =
    props;
  const silverCopy = SILVER_COPY[catalog?.silverLabel ?? "seichi"];

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [item, setItem] = useState<Item | undefined>(undefined);
  const [stacksize, setStacksize] = useState<number>(1);
  const filteringState = useShopFiltering(defaultType);
  const isAwake = useAwake(userData);
  const itemTypeTabOptions = useMemo(
    () => (props.restrictTypes?.length ? props.restrictTypes : ItemTypes) as ItemType[],
    [props.restrictTypes],
  );

  const utils = api.useUtils();

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
      maxLevel: userData.level,
    },
    {
      enabled: userData !== undefined,
      staleTime: Infinity,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allItems = items?.pages
    .flatMap((page) => page.data)
    .filter(
      (row) => !row.expireFromStoreAt || new Date(row.expireFromStoreAt) > new Date(),
    );

  const { currentStep, handleNextStep } = useTutorialStep();

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
      setStacksize(1);
    },
  });

  const sDiscount = getStrucBoost("itemDiscountPerLvl", userData.village?.structures);
  const aDiscount = userData.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
  const hDiscount = item?.effects?.find((e) => e.type === "heal")
    ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
    : 0;
  const selectedItemFactor = item
    ? shopItemDiscountFactor(item, sDiscount, aDiscount)
    : 1;

  const discounts = [
    ...(sDiscount > 0 ? [{ label: "village structures", value: sDiscount }] : []),
    ...(aDiscount > 0 ? [{ label: "ANBU membership", value: aDiscount }] : []),
    ...(hDiscount > 0 ? [{ label: "medic-nin item", value: hDiscount }] : []),
  ];
  const totalDiscount = discounts.reduce((acc, d) => acc + d.value, 0);

  const ryoCost = Math.ceil((item?.cost ?? 0) * stacksize * selectedItemFactor);
  const repsCost = Math.ceil((item?.repsCost ?? 0) * stacksize);
  const seichiSilverCost = Math.ceil((item?.seichiSilverCost ?? 0) * stacksize);
  const canAfford =
    userData.money >= ryoCost &&
    userData.reputationPoints >= repsCost &&
    userData.seichiSilver >= seichiSilverCost;
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

  const purchaseModal = userData && isOpen && item && (
    <Modal2
      id="tutorial-itemshop-confirmPurchase"
      title="Confirm Purchase"
      proceed_label={isPurchasing ? undefined : canAfford ? costString : missingString}
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
  );

  return (
    <>
      {isAwake && (
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
              <ItemShopFiltering
                state={filteringState}
                defaultType={defaultType}
                restrictTypes={props.restrictTypes}
                hideItemTypeField
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

          {userData && (
            <>
              <div className="relative overflow-hidden border-b bg-linear-to-br from-amber-950/25 via-card to-card px-3 py-4 md:px-6 md:py-8">
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
                        <Badge
                          variant="secondary"
                          className="gap-1 border-amber-500/25 bg-background/60 font-normal"
                        >
                          <Ticket className="h-3 w-3" />
                          Tap a card to buy
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b bg-linear-to-b from-amber-950/10 to-muted/30 px-2 py-3 md:px-6 md:py-4">
                <div className="mx-auto flex max-w-5xl flex-col gap-1.5 sm:gap-2">
                  <div
                    className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted/90 p-0.5 shadow-inner ring-1 ring-border/50 sm:grid-cols-4 sm:gap-1 sm:rounded-xl sm:p-1 lg:grid-cols-8 dark:bg-muted/40"
                    role="tablist"
                    aria-label="Item category"
                  >
                    {itemTypeTabOptions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={selectedItemType === t}
                        className={cn(
                          "flex flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 font-semibold text-[10px] transition-all sm:flex-row sm:gap-2 sm:rounded-lg sm:px-1 sm:py-3 sm:text-xs",
                          selectedItemType === t
                            ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                            : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                        )}
                        onClick={() => {
                          if (selectedItemType === t) return;
                          filteringState.setItemType(t);
                          setItem(undefined);
                          setStacksize(1);
                          setIsOpen(false);
                        }}
                      >
                        {categoryTabIcon(t)}
                        <span className="text-center leading-tight">
                          {SHOP_ITEM_TYPE_TAB_LABEL[t]}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-balance text-center text-[11px] text-muted-foreground leading-relaxed sm:text-xs">
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
                  <p className="text-muted-foreground text-xs lg:max-w-xs lg:text-right">
                    More filters (rarity, slot, effects, …) stay in the filter button
                    above.
                  </p>
                </div>
              </div>

              <div className="px-1.5 py-2 sm:px-3 sm:py-3 md:p-5" id={catalogListDomId}>
                {isFetching && !allItems?.length ? (
                  <div className="flex min-h-[40vh] items-center justify-center">
                    <Loader explanation="Loading catalog…" />
                  </div>
                ) : !allItems?.length ? (
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
                      {allItems.map((row) => {
                        const rowFactor = shopItemDiscountFactor(
                          row,
                          sDiscount,
                          aDiscount,
                        );
                        const ryoDue =
                          row.cost > 0 ? Math.ceil(row.cost * rowFactor) : 0;
                        const repsDue = Math.ceil(row.repsCost ?? 0);
                        const seichiDue = Math.ceil(row.seichiSilverCost ?? 0);
                        const canAffordRow =
                          userData.money >= ryoDue &&
                          userData.reputationPoints >= repsDue &&
                          userData.seichiSilver >= seichiDue;
                        return (
                          <li key={row.id} className="h-full min-h-0 min-w-0">
                            <ShopCatalogCard
                              item={row}
                              selected={item?.id === row.id}
                              previewFactor={rowFactor}
                              canAfford={canAffordRow}
                              seichiCatalogWord={silverCopy.catalog}
                              onSelect={() => {
                                if (item?.id === row.id) {
                                  setItem(undefined);
                                  setStacksize(1);
                                  setIsOpen(false);
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
                    {isFetching && allItems.length > 0 && (
                      <div className="flex justify-center py-8">
                        <Loader explanation="Updating catalog…" />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {purchaseModal}
        </ContentBox>
      )}
    </>
  );
};

export default Shop;
