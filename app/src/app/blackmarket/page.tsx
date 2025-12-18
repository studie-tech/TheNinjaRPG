"use client";

import { z } from "zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { round } from "@/utils/math";
import ContentBox from "@/layout/ContentBox";
import Shop from "@/layout/Shop";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Confirm2 from "@/layout/Confirm2";
import AvatarImage from "@/layout/Avatar";
import UserSearchSelect from "@/layout/UserSearchSelect";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { Label } from "src/components/ui/label";
import { getSearchValidator } from "@/validators/register";
import { ReceiptJapaneseYen, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrentBloodline, PurchaseBloodline } from "@/layout/Bloodline";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { secondsFromDate } from "@/utils/time";
import { showMutationToast } from "@/libs/toast";
import { useInfinitePagination } from "@/libs/pagination";
import { filterRollableBloodlines } from "@/libs/bloodline";
import { RYO_FOR_REP_DAYS_FROZEN } from "@/drizzle/constants";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import GraphBlackmarketLedger from "@/layout/GraphBlackmarketLedger";
import { Waypoints, Dices } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocalStorage } from "@/hooks/localstorage";
import { PITY_BLOODLINE_ROLLS, PITY_SYSTEM_ENABLED } from "@/drizzle/constants";
import type { ArrayElement } from "@/utils/typeutils";
import type { UserWithRelations } from "@/routers/profile";

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
              <i> - Special items with Seichi silver or Reputation points.</i>
            </li>
            <li>
              <i> - Exchange ryo for reputation points.</i>
            </li>
          </ol>
        </div>
      </ContentBox>
      {tab === "Bloodline" && <Bloodline userData={userData} />}
      {tab === "Ryo" && <RyoShop userData={userData} />}
      {tab === "Item" && (
        <>
          <Shop
            userData={userData}
            defaultType="CONSUMABLE"
            initialBreak={true}
            minRepsCost={1}
            title="Reputation Shop"
            subtitle="Buy rare items"
          />
          <Shop
            userData={userData}
            defaultType="CONSUMABLE"
            initialBreak={true}
            minSeichiSilverCost={1}
            title="Seichi Silver Shop"
            subtitle="Buy rare items"
          />
          {PITY_SYSTEM_ENABLED && <PityBloodlineRoll userData={userData} />}
        </>
      )}
    </>
  );
}

/**
 * For every 150 failed rolls, let the user get a free bloodline of the given rank
 * @param param0
 * @returns
 */
const PityBloodlineRoll: React.FC<{ userData: NonNullable<UserWithRelations> }> = ({
  userData,
}) => {
  // tRPC utils
  const utils = api.useUtils();

  // Get data from DB
  const { data: prevRolls, isPending: isPendingRolls } =
    api.bloodline.getItemRolls.useQuery(undefined);
  const { data: bloodlines, isPending: isPendingBloodlines } =
    api.bloodline.getAll.useQuery({ limit: 500 });

  // Pity roll mutation
  const { mutate: pityRoll } = api.bloodline.pityRoll.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.bloodline.getItemRolls.invalidate();
      }
    },
  });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isPendingRolls) return <Loader explanation="Loading previous rolls" />;
  if (isPendingBloodlines) return <Loader explanation="Loading bloodlines" />;
  if (!prevRolls || !bloodlines) return null;

  // Process data for table
  const itemRolls = prevRolls?.map((entry) => {
    const unusedRolls = entry.used - PITY_BLOODLINE_ROLLS * entry.pityRolls;
    const pityRolls = Math.floor(unusedRolls / PITY_BLOODLINE_ROLLS);
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
          {pityRolls > 0 ? (
            <Button
              hoverText={`Roll for a random ${entry.goal} bloodline`}
              onClick={() => pityRoll({ rank: entry.goal })}
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
      <p className="italic text-xs p-3">
        Once you have have rolled {PITY_BLOODLINE_ROLLS} times for a given rank
        bloodline using items, you get 1 free roll, which is guarenteed to give you a
        random bloodline of the given rank. <b>Note:</b> Pity system will be disabled
        next monday alongside sales of S-rank items!
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
  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

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
  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<"Active" | "Ledger">("Active");
  const showActive = tab === "Active";

  // Utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: create, isPending: isCreating } =
    api.blackmarket.createOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.blackmarket.getRyoOffers.invalidate();
        }
      },
    });

  const { mutate: delist, isPending: isDelisting } =
    api.blackmarket.delistOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.blackmarket.getRyoOffers.invalidate();
        }
      },
    });

  const { mutate: accept, isPending: isAccepting } =
    api.blackmarket.takeOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.blackmarket.getRyoOffers.invalidate();
        }
      },
    });

  const isLoading = isCreating || isDelisting || isAccepting;

  // Creator search
  const maxUsers = 1;
  const creatorSearchSchema = getSearchValidator({ max: maxUsers });
  const creatorSearchMethods = useForm<z.infer<typeof creatorSearchSchema>>({
    resolver: zodResolver(creatorSearchSchema),
  });
  const creatorUser = useWatch({
    control: creatorSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Buyer search
  const buyerSearchSchema = getSearchValidator({ max: maxUsers });
  const buyerSearchMethods = useForm<z.infer<typeof buyerSearchSchema>>({
    resolver: zodResolver(buyerSearchSchema),
  });
  const buyerUser = useWatch({
    control: buyerSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Allowed buyer schema
  const allowedSearchSchema = getSearchValidator({ max: maxUsers });
  const allowedSearchMethods = useForm<z.infer<typeof allowedSearchSchema>>({
    resolver: zodResolver(allowedSearchSchema),
  });
  const allowedUser = useWatch({
    control: allowedSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

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
    .map((page) => page.data)
    .flat()
    .map((offer) => {
      const hasRyo = userData.money >= offer.requestedRyo;
      const owner = offer.creatorUserId === userData.userId;
      const isTerr = userData.username === "Terriator";
      const canDelist =
        new Date() >=
        secondsFromDate(3600 * 24 * RYO_FOR_REP_DAYS_FROZEN, offer.createdAt);
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
            {showActive && hasRyo && !owner && (
              <Button onClick={() => accept({ offerId: offer.id })}>
                <ShoppingCart className="h-5 w-5 mr-2" />
                Buy
              </Button>
            )}
            {showActive && (isTerr || (owner && canDelist)) && (
              <Button onClick={() => delist({ offerId: offer.id })}>
                <X className="h-6 w-6" />
              </Button>
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
  const FormSchema = z.object({
    reps: z.coerce.number().int().min(1),
    ryo: z.coerce.number().int().min(1),
  });
  type FormSchemaType = z.infer<typeof FormSchema>;
  const form = useForm<FormSchemaType>({
    resolver: zodResolver(FormSchema),
    defaultValues: { reps: 0, ryo: 0 },
  });
  const offerReps = useWatch({ control: form.control, name: "reps" });
  const offerRyo = useWatch({ control: form.control, name: "ryo" });
  const onSubmit = form.handleSubmit((data) =>
    create({ ...data, allowedUser: allowedUser?.userId }),
  );

  // Derived
  const tradeableReps = Math.max(userData.reputationPoints - 5, 0);

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
            id="hospital-page"
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
            <DialogContent className="min-w-[99%] min-h-[99%]">
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
      {tradeableReps > 0 && (
        <div className="pb-5">
          <p className="p-3">
            You have <b>{tradeableReps.toLocaleString()} reputation points</b> and{" "}
            <b>{userData.money.toLocaleString()} ryo</b> in your pocket. You may list reputation points
            here for sale, so that other users may buy them for a pre-determined amount
            of ryo. Once listed, your sale cannot be delisted for{" "}
            {RYO_FOR_REP_DAYS_FROZEN} days. You can not trade the first 10 reputation
            points given on your account.
          </p>
          {!showActive && (
            <div className="px-3 flex flex-row gap-2">
              <div className="w-full">
                <Label>Creator</Label>
                <UserSearchSelect
                  useFormMethods={creatorSearchMethods}
                  selectedUsers={[]}
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
                  selectedUsers={[]}
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
                          <Input {...field} />
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
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="col-span-2">
                    <Label>Restrict Purchase [optional]</Label>
                    <UserSearchSelect
                      useFormMethods={allowedSearchMethods}
                      selectedUsers={[]}
                      showYourself={true}
                      showAi={false}
                      inline={true}
                      maxUsers={maxUsers}
                    />
                  </div>
                  <div className="col-span-2 px-1 py-2">
                    <Confirm2
                      title="Create Offer"
                      proceed_label={
                        offerReps > 0 && offerRyo > 0 ? "Confirm" : "Fill in values"
                      }
                      isValid={!isLoading && offerReps > 0}
                      confirmClassName={
                        offerReps > 0 && offerRyo > 0
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-red-600 text-white hover:bg-red-700"
                      }
                      button={
                        <Button type="submit" className="w-full" decoration="gold">
                          <ReceiptJapaneseYen className="w-5 h-5 mr-2" />
                          Create offer
                        </Button>
                      }
                      onAccept={async (e) => {
                        e.preventDefault();
                        await onSubmit();
                      }}
                    >
                      {offerReps > 0 && offerRyo > 0 && (
                        <p>
                          Confirm that you wish to put{" "}
                          {Number(offerReps).toLocaleString()} reputation points up for
                          sale for a total price of{" "} {Number(offerRyo).toLocaleString()}
                          ryo, i.e. at a{" "}<b>ryo/rep price of{" "}
                          {round(Number(offerRyo) / Number(offerReps)).toLocaleString()}</b>
                          . This offer will be listed for at least{" "}{RYO_FOR_REP_DAYS_FROZEN}
                           days, after which you can delist them.
                        </p>
                      )}
                      {(offerReps === 0 || offerRyo === 0) && (
                        <p>Must enter reputation & reputation values above 0.</p>
                      )}
                    </Confirm2>
                  </div>
                </div>
              </form>
            </Form>
          )}
        </div>
      )}
      {/* TABLE OF CURRENT OFFERS */}
      {!isLoading && allOffers && allOffers.length > 0 && (
        <div className="border-t-2 border-dashed">
          <Table data={allOffers} columns={columns} setLastElement={setLastElement} />
        </div>
      )}
      {!allOffers?.length && (
        <p className="p-3 bg-popover mt-3 border-t-2 border-dashed">
          No offers currently listed.
        </p>
      )}
      {/* LOADERS */}
      {isLoading && <Loader explanation="Loading" />}
    </ContentBox>
  );
};
