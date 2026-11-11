"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dices, ReceiptJapaneseYen, ShoppingCart, Waypoints, X } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  PITY_BLOODLINE_ROLLS,
  REP_TRADE_MIN_LEVEL,
  RYO_FOR_REP_DAYS_FROZEN,
  RYO_FOR_REP_RESERVE,
  repTradeLevelMessage,
} from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import AvatarImage from "@/layout/Avatar";
import { CurrentBloodline, PurchaseBloodline } from "@/layout/Bloodline";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import GraphBlackmarketLedger from "@/layout/GraphBlackmarketLedger";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Shop from "@/layout/Shop";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getRyoOfferUnfreezeDate } from "@/libs/blackmarket";
import { filterRollableBloodlines, getPityRolls } from "@/libs/bloodline";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { round } from "@/utils/math";
import { isSiteOwnerAccount } from "@/utils/permissions";
import { useUserPicker } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type BlackMarketOfferSchema,
  type BlackMarketOfferSchemaInput,
  blackMarketOfferSchema,
} from "@/validators/blackmarket";
import type { UserDeltaResponse } from "@/validators/userCache";

export default function BlackMarket() {
  // Tab selection
  const tabs = ["Bloodline", "Item", "Ryo"] as const;
  const [tab, setTab] = useLocalStorage<(typeof tabs)[number] | null>(
    "blackmarketTab",
    null,
    true,
  );

  // Settings
  const { data: userData } = useRequiredUserData();

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Render
  return (
    <>
      <ContentBox
        title="Black Market"
        subtitle="Special Abilities and Items"
        defaultBackHref="/village"
        topRightContent={
          <NavTabs
            id="blackmarket-page"
            current={tab}
            options={tabs}
            setValue={setTab}
          />
        }
      >
        <div>
          Welcome to the Black Market. Here you can purchase special abilities, items,
          and currency. You can:
          <ol className="pt-3">
            <li>
              <i> - Have a bloodline genetically infused.</i>
            </li>
            <li>
              <i> - Buy special items with silver or reputation points.</i>
            </li>
            <li>
              <i> - Exchange ryo for reputation points.</i>
            </li>
          </ol>
        </div>
      </ContentBox>
      {tab === "Bloodline" && <Bloodline userData={userData} />}
      {tab === "Ryo" && <RyoShop userData={userData} />}
      {tab === "Item" && <BlackMarketItemCatalog userData={userData} />}
    </>
  );
}

const itemCurrencyTabs = ["Reputation", "Silver"] as const;

/**
 * Reputation and silver catalogs share Shop, but only one is mounted so we do
 * not fire two item.getAll infinite queries or render two card grids at once.
 */
const BlackMarketItemCatalog: React.FC<{
  userData: NonNullable<UserWithRelations>;
}> = ({ userData }) => {
  const [itemCurrency, setItemCurrency] = useLocalStorage<
    (typeof itemCurrencyTabs)[number]
  >("blackmarketItemCurrency", "Reputation");
  const isSilver = itemCurrency === "Silver";
  const currencyNav = (
    <NavTabs
      id="blackmarket-item-currency"
      current={itemCurrency}
      options={itemCurrencyTabs}
      setValue={setItemCurrency}
    />
  );

  return (
    <>
      <Shop
        key={itemCurrency}
        userData={userData}
        defaultType="CONSUMABLE"
        initialBreak={true}
        minRepsCost={isSilver ? undefined : 1}
        minSeichiSilverCost={isSilver ? 1 : undefined}
        title={isSilver ? "Silver Shop" : "Reputation Shop"}
        subtitle="Browse categories, search the catalog, then open a card to buy."
        catalog={{
          silverLabel: "silver",
          heroTitle: isSilver ? "Silver catalog" : "Reputation catalog",
          heroDescription: isSilver
            ? "Spend silver on exclusive goods. Use tabs and search, then tap a card to review and purchase."
            : "Spend reputation on rare stock. Category tabs and search match the village shop; filters refine rarity, slot, and effects.",
          heroBadge: isSilver ? "Silver pricing" : "Reputation pricing",
          searchId: isSilver
            ? "blackmarket-seichi-catalog-search"
            : "blackmarket-rep-catalog-search",
          listId: false,
          filterTriggerId: isSilver
            ? "blackmarket-seichi-filter"
            : "blackmarket-rep-filter",
          headerExtra: currencyNav,
        }}
      />
      <PityBloodlineRoll userData={userData} />
    </>
  );
};

/** Every PITY_BLOODLINE_ROLLS item rolls for a rank grant one guaranteed roll of that rank. */
const PityBloodlineRoll: React.FC<{
  userData: NonNullable<UserWithRelations>;
}> = ({ userData }) => {
  // tRPC utils
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  // Get data from DB
  const { data: prevRolls, isPending: isPendingRolls } =
    api.bloodline.getItemRolls.useQuery(undefined);
  const { data: bloodlines, isPending: isPendingBloodlines } =
    api.bloodline.getAll.useQuery({ limit: 500 });

  // Pity roll mutation
  const { mutate: pityRoll, isPending } = api.bloodline.pityRoll.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _input, revision) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser(data, { revision }),
          utils.bloodline.getItemRolls.invalidate(),
        ]);
      }
    },
  });

  // Loaders
  if (isPendingRolls) return <Loader explanation="Loading previous rolls" />;
  if (isPendingBloodlines) return <Loader explanation="Loading bloodlines" />;
  if (!prevRolls || !bloodlines) return null;

  // Process data for table
  const itemRolls = prevRolls?.map((entry) => {
    const pityRolls = getPityRolls(entry);
    const bloodlinePool = filterRollableBloodlines({
      bloodlines: bloodlines.data,
      user: userData,
      previousRolls: prevRolls,
      rank: entry.goal,
    });
    return {
      ...entry,
      currentPool: (
        <div>
          {bloodlinePool.map((b) => (
            <div key={`${entry.goal}-${b.id}-pool`}>{b.name}</div>
          ))}
        </div>
      ),
      pityButton: (
        <div className="text-center">
          {pityRolls > 0 && !userData.bloodlineId ? (
            <Button
              hoverText={`Roll for a random ${entry.goal} bloodline`}
              onClick={() => pityRoll({ rank: entry.goal })}
              disabled={isPending}
            >
              <Dices className="h-6 w-6" />
            </Button>
          ) : (
            "N/A"
          )}
          {entry.pityRolls > 0 && <div className="italic">{entry.pityRolls} used</div>}
        </div>
      ),
    };
  });

  // Table
  type PrevRoll = ArrayElement<typeof itemRolls>;
  const columns: ColumnDefinitionType<PrevRoll, keyof PrevRoll>[] = [
    { key: "goal", header: "Rank", type: "string" },
    { key: "updatedAt", header: "Last Roll", type: "date" },
    { key: "used", header: "#Rolls", type: "string" },
    { key: "currentPool", header: "Current Pool", type: "jsx" },
    { key: "pityButton", header: "Pity Rolls", type: "jsx" },
  ];

  return (
    <ContentBox
      title="Bloodline Rolls"
      subtitle="Overview of previous rolls"
      initialBreak={true}
      padding={false}
    >
      <Table data={itemRolls} columns={columns} />
      <p className="p-3 text-xs italic">
        Once you have rolled {PITY_BLOODLINE_ROLLS} times for a given rank bloodline
        using items, you get 1 free roll, which is guaranteed to give you a random
        bloodline of the given rank.
      </p>
    </ContentBox>
  );
};

/**
 * Purchase & Remove Bloodlines
 */
const Bloodline: React.FC<{ userData: NonNullable<UserWithRelations> }> = ({
  userData,
}) => {
  // Derived
  const bloodlineId = userData.bloodlineId;

  return (
    <>
      <PurchaseBloodline initialBreak={true} />
      {bloodlineId && (
        <CurrentBloodline bloodlineId={bloodlineId} initialBreak={true} />
      )}
    </>
  );
};

/**
 * Exchange Reputation points for Ryo
 */
const RyoShop: React.FC<{ userData: NonNullable<UserWithRelations> }> = ({
  userData,
}) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<"Active" | "Ledger">("Active");
  const showActive = tab === "Active";

  // Utility
  const utils = api.useUtils();

  // Mutations: every offer change returns the viewer's balance delta
  const offerMutationOptions = {
    onMutate: prepareUserUpdate,
    onSuccess: async (
      data: UserDeltaResponse,
      _variables: unknown,
      revision: number | undefined,
    ) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser(undefined, { revision, delta: data.userDelta }),
          utils.blackmarket.getRyoOffers.invalidate(),
        ]);
      }
    },
  };
  const { mutate: create, isPending: isCreating } =
    api.blackmarket.createOffer.useMutation(offerMutationOptions);

  const { mutate: delist, isPending: isDelisting } =
    api.blackmarket.delistOffer.useMutation(offerMutationOptions);

  const { mutate: accept, isPending: isAccepting } =
    api.blackmarket.takeOffer.useMutation(offerMutationOptions);

  const isLoading = isCreating || isDelisting || isAccepting;
  const belowRepTradeMinLevel = userData.level < REP_TRADE_MIN_LEVEL;

  // Creator search
  const maxUsers = 1;
  const { methods: creatorSearchMethods, user: creatorUser } = useUserPicker(maxUsers);

  // Buyer search
  const { methods: buyerSearchMethods, user: buyerUser } = useUserPicker(maxUsers);

  // Allowed buyer schema
  const { methods: allowedSearchMethods, user: allowedUser } = useUserPicker(maxUsers);

  // Query
  const { data, fetchNextPage, hasNextPage } =
    api.blackmarket.getRyoOffers.useInfiniteQuery(
      {
        activeToggle: tab === "Active",
        creator: creatorUser?.username,
        buyer: buyerUser?.username,
        limit: 30,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 30, // every 30min
      },
    );
  const allOffers = data?.pages
    .flatMap((page) => page.data)
    .map((offer) => {
      const hasRyo = userData.money >= offer.requestedRyo;
      const owner = offer.creatorUserId === userData.userId;
      const isOwner = isSiteOwnerAccount(userData);
      const canDelist = new Date() >= getRyoOfferUnfreezeDate(offer.createdAt);
      return {
        ...offer,
        item: (
          <div className="flex flex-col whitespace-nowrap">
            <b>Reps for sale: {offer.repsForSale.toLocaleString()}</b>
            <b>Ryo price: {offer.requestedRyo.toLocaleString()}</b>
            <b>Ryo/Rep price: {offer.ryoPerRep.toLocaleString()}</b>
          </div>
        ),
        creator: (
          <div className="w-20 text-center">
            <AvatarImage
              href={offer.creatorAvatar}
              alt={offer.creatorUsername}
              size={100}
            />
            <p>{offer.creatorUsername}</p>
          </div>
        ),
        buyer: (
          <div className="w-20 text-center">
            <AvatarImage
              href={offer.purchaserAvatar}
              alt={offer.purchaserUsername || "Unknown"}
              size={100}
            />
            <p>{offer.purchaserUsername}</p>
          </div>
        ),
        allowed: (
          <div className="w-20 text-center">
            <AvatarImage
              href={offer.allowedAvatar}
              alt={offer.allowedUsername || "Unknown"}
              size={100}
            />
            <p>{offer.allowedUsername}</p>
          </div>
        ),
        actions: (
          <div className="flex flex-row gap-1">
            {showActive && hasRyo && !owner && !belowRepTradeMinLevel && (
              <Confirm
                title="Buy reputation points"
                proceed_label={`Pay ${offer.requestedRyo.toLocaleString()} ryo`}
                proceed_loading_label="Buying..."
                isLoading={isAccepting}
                keepOpenOnAccept={true}
                button={
                  <Button>
                    <ShoppingCart className="mr-2 h-5 w-5" />
                    Buy
                  </Button>
                }
                onAccept={(_e, { close }) =>
                  accept(
                    { offerId: offer.id },
                    { onSuccess: (result) => result.success && close() },
                  )
                }
              >
                <p>
                  Buy <b>{offer.repsForSale.toLocaleString()} reputation points</b> from{" "}
                  {offer.creatorUsername} for{" "}
                  <b>{offer.requestedRyo.toLocaleString()} ryo</b> (
                  {offer.ryoPerRep.toLocaleString()} ryo per point)? The ryo leaves your
                  pocket at once and the trade cannot be undone.
                </p>
              </Confirm>
            )}
            {showActive && (isOwner || (owner && canDelist)) && (
              <Confirm
                title="Delist offer"
                proceed_label="Delist"
                proceed_loading_label="Delisting..."
                confirmClassName="bg-red-600 text-white hover:bg-red-700"
                isLoading={isDelisting}
                keepOpenOnAccept={true}
                button={
                  <Button aria-label="Delist offer">
                    <X className="h-6 w-6" />
                  </Button>
                }
                onAccept={(_e, { close }) =>
                  delist(
                    { offerId: offer.id },
                    { onSuccess: (result) => result.success && close() },
                  )
                }
              >
                <p>
                  Remove this offer of {offer.repsForSale.toLocaleString()} reputation
                  points from the market? The points return to {offer.creatorUsername}.
                </p>
              </Confirm>
            )}
          </div>
        ),
      };
    });
  type Offer = ArrayElement<typeof allOffers>;

  // Infinite scrolling
  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Columns
  const columns: ColumnDefinitionType<Offer, keyof Offer>[] = [
    { key: "creator", header: "Creator", type: "jsx" },
    { key: "allowed", header: "Restricted", type: "jsx" },
    { key: "item", header: "Item", type: "jsx" },
    { key: "createdAt", header: "Created", type: "date" },
  ];

  // Dynamic columns
  if (showActive) {
    columns.push({ key: "actions", header: "Actions", type: "jsx" });
  } else {
    columns.push({ key: "buyer", header: "Buyer", type: "jsx" });
  }

  // New offer form
  const form = useForm<BlackMarketOfferSchemaInput, unknown, BlackMarketOfferSchema>({
    resolver: zodResolver(blackMarketOfferSchema),
    defaultValues: { reps: undefined, ryo: undefined },
  });
  const offerReps = Number(useWatch({ control: form.control, name: "reps" }));
  const offerRyo = Number(useWatch({ control: form.control, name: "ryo" }));
  const hasOfferValues = offerReps > 0 && offerRyo > 0;
  const onSubmit = form.handleSubmit((data) =>
    create({ ...data, allowedUser: allowedUser?.userId }),
  );

  // Derived
  const tradeableReps = Math.max(userData.reputationPoints - RYO_FOR_REP_RESERVE, 0);

  return (
    <ContentBox
      id="tutorial-ryo-shop"
      title="Ryo Shop"
      subtitle="Trade for reputation points"
      initialBreak={true}
      padding={false}
      topRightContent={
        <div className="flex flex-row items-center">
          <NavTabs
            id="blackmarket-ryo-shop"
            current={tab}
            options={["Active", "Ledger"]}
            setValue={setTab}
          />
          <Dialog>
            <DialogTrigger asChild>
              <Button type="submit">
                <Waypoints className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="min-h-[99%] min-w-[99%]">
              <DialogHeader>
                <DialogTitle>Black Market Ledger</DialogTitle>
                <DialogDescription asChild>
                  <GraphBlackmarketLedger />
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {/* CREATE OFFERS */}
      {belowRepTradeMinLevel && (
        <p className="border-b px-3 py-3 text-center text-muted-foreground text-sm">
          {repTradeLevelMessage}
        </p>
      )}
      {tradeableReps > 0 && !belowRepTradeMinLevel && (
        <div className="pb-5">
          <p className="p-3">
            You have <b>{tradeableReps.toLocaleString()} reputation points</b> and{" "}
            <b>{userData.money.toLocaleString()} ryo</b> in your pocket. You may list
            reputation points here for sale, so that other users may buy them for a
            pre-determined amount of ryo. Once listed, your sale cannot be delisted for{" "}
            {RYO_FOR_REP_DAYS_FROZEN} days. You must keep at least {RYO_FOR_REP_RESERVE}{" "}
            reputation points on your account.
          </p>
          {!showActive && (
            <div className="flex flex-row gap-2 px-3">
              <div className="w-full">
                <Label>Creator</Label>
                <UserSearchSelect
                  useFormMethods={creatorSearchMethods}
                  showYourself={true}
                  inline={true}
                  showAi={false}
                  maxUsers={maxUsers}
                />
              </div>
              <div className="w-full">
                <Label>Buyer</Label>
                <UserSearchSelect
                  useFormMethods={buyerSearchMethods}
                  showYourself={true}
                  inline={true}
                  showAi={false}
                  maxUsers={maxUsers}
                />
              </div>
            </div>
          )}
          {showActive && !isLoading && (
            <Form {...form}>
              <form>
                <div className="grid grid-cols-2 gap-3 px-3">
                  <FormField
                    control={form.control}
                    name="reps"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel>Reps to Sell</FormLabel>
                        <FormControl>
                          <NumberInput
                            optional
                            min={1}
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value as number | undefined}
                            onOptionalValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ryo"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel>Ryo Request</FormLabel>
                        <FormControl>
                          <NumberInput
                            optional
                            min={1}
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value as number | undefined}
                            onOptionalValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="col-span-2">
                    <Label>Restrict Purchase [optional]</Label>
                    <UserSearchSelect
                      useFormMethods={allowedSearchMethods}
                      showYourself={true}
                      showAi={false}
                      inline={true}
                      maxUsers={maxUsers}
                    />
                  </div>
                  <div className="col-span-2 px-1 py-2">
                    <Confirm
                      title="Create Offer"
                      proceed_label={hasOfferValues ? "Confirm" : "Fill in values"}
                      isValid={!isLoading && offerReps > 0}
                      confirmClassName={
                        hasOfferValues
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-red-600 text-white hover:bg-red-700"
                      }
                      button={
                        <Button type="submit" className="w-full" decoration="gold">
                          <ReceiptJapaneseYen className="mr-2 h-5 w-5" />
                          Create offer
                        </Button>
                      }
                      onAccept={async (e) => {
                        e.preventDefault();
                        await onSubmit();
                      }}
                    >
                      {hasOfferValues && (
                        <p>
                          Confirm that you wish to put{" "}
                          {Number(offerReps).toLocaleString()} reputation points up for
                          sale for a total price of {Number(offerRyo).toLocaleString()}{" "}
                          ryo, i.e. at a{" "}
                          <b>
                            ryo/rep price of{" "}
                            {round(
                              Number(offerRyo) / Number(offerReps),
                            ).toLocaleString()}
                          </b>
                          . This offer will be listed for at least{" "}
                          {RYO_FOR_REP_DAYS_FROZEN} days, after which you can delist
                          them.
                        </p>
                      )}
                      {!hasOfferValues && (
                        <p>Must enter reputation & ryo values above 0.</p>
                      )}
                    </Confirm>
                  </div>
                </div>
              </form>
            </Form>
          )}
        </div>
      )}
      {/* TABLE OF CURRENT OFFERS */}
      {/* Stays mounted while an offer is bought or delisted so its dialog shows progress */}
      {!isCreating && allOffers && allOffers.length > 0 && (
        <div className="border-t-2 border-dashed">
          <Table data={allOffers} columns={columns} setLastElement={setLastElement} />
        </div>
      )}
      {!allOffers?.length && (
        <p className="mt-3 border-t-2 border-dashed bg-popover p-3">
          No offers currently listed.
        </p>
      )}
      {/* LOADERS */}
      {isCreating && <Loader explanation="Loading" />}
    </ContentBox>
  );
};
