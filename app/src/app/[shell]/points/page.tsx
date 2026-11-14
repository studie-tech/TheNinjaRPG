"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendGTMEvent } from "@next/third-parties/google";
import {
  DISPATCH_ACTION,
  PayPalButtons,
  PayPalScriptProvider,
  usePayPalScriptReducer,
} from "@paypal/react-paypal-js";
import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, onError } from "@/app/_trpc/client";
import NativeStore from "@/components/native/NativeStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FARM_GOLD_FED_TIME_REDUCTION_PERCENT,
  FED_BANK_INTEREST,
  FED_COOKING_SLOTS,
  FED_EVENT_ITEMS,
  FED_INVENTORY_SLOTS,
  FED_ITEM_LOADOUTS,
  FED_ITEM_LOADOUTS_BASE,
  FED_JUTSU_LOADOUTS,
  FED_JUTSU_LOADOUTS_BASE,
  FED_JUTSU_SLOTS,
  FEDERAL_MONTHLY_USD_CENTS,
  type FederalStatus,
  FederalStatuses,
  IMG_REPSHOP_BRONZE,
  IMG_REPSHOP_GOLD,
  IMG_REPSHOP_SILVER,
  PAYPAL_DISCOUNT_PERCENT,
  PET_FED_COLLECTION_SLOTS,
  QUEUE_WAITING_SLOTS,
  SKILL_TREE_RESET_FREE,
  WEB_REP_MAX,
  WEB_REP_MIN,
  WEB_REP_PRESETS,
} from "@/drizzle/constants";
import { useNativeShell } from "@/hooks/useNativeShell";
import { useStoreDeliveryRefresh } from "@/hooks/useStoreDeliveryRefresh";
import BanInfo from "@/layout/BanInfo";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import SliderField from "@/layout/SliderField";
import {
  StripeCheckoutButton,
  StripePaymentHistory,
  StripePaymentReturn,
  StripePendingCheckouts,
  StripeSubscriptions,
} from "@/layout/StripePayments";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import { TransactionHistory } from "@/layout/TransactionHistory";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { isPayPalCleanupError } from "@/utils/error";
import {
  calcFedUgradeCost,
  dynamicMonthlyRepCap,
  fedRepsUnavailableNote,
  fedStatusRepsCost,
  reps2dollars,
} from "@/utils/paypal";
import { useRecipientPicker } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";
import {
  useRequiredUserData,
  useRequiredUserDataSelector,
  useRequiredUserInfo,
} from "@/utils/UserContext";
import type { BuyRepsSchema, SearchPaypalTransactionSchema } from "@/validators/points";
import { buyRepsSchema, searchPaypalTransactionSchema } from "@/validators/points";
import { StoreBundles } from "./StoreBundles";
import { StoreCheckout } from "./StoreCheckout";

const CURRENCY = "USD";
const OPTIONS = {
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "",
  currency: CURRENCY,
  intent: "capture",
};

/** Plan ids stay literal `process.env` reads so Next.js inlines them. */
const FEDERAL_TIERS: { status: FederalTier; image: string; planId: string }[] = [
  {
    status: "NORMAL",
    image: IMG_REPSHOP_BRONZE,
    planId: process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL,
  },
  {
    status: "SILVER",
    image: IMG_REPSHOP_SILVER,
    planId: process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER,
  },
  {
    status: "GOLD",
    image: IMG_REPSHOP_GOLD,
    planId: process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD,
  },
];

const FEDERAL_TIER_BENEFITS = {
  NORMAL: {
    title: "Normal",
    usernameColor: "Blue",
    inventorySlots: FED_INVENTORY_SLOTS.NORMAL,
    eventItems: FED_EVENT_ITEMS.NORMAL,
    cookingSlots: FED_COOKING_SLOTS.NORMAL,
    jutsuSlots: FED_JUTSU_SLOTS.NORMAL,
    bankInterest: FED_BANK_INTEREST.NORMAL,
    jutsuLoadouts: FED_JUTSU_LOADOUTS.NORMAL,
    itemLoadouts: FED_ITEM_LOADOUTS.NORMAL,
    skillTreeResets: SKILL_TREE_RESET_FREE.NORMAL,
    avatarSize: "512KB",
  },
  SILVER: {
    title: "Silver",
    usernameColor: "Silver",
    inventorySlots: FED_INVENTORY_SLOTS.SILVER,
    eventItems: FED_EVENT_ITEMS.SILVER,
    cookingSlots: FED_COOKING_SLOTS.SILVER,
    jutsuSlots: FED_JUTSU_SLOTS.SILVER,
    bankInterest: FED_BANK_INTEREST.SILVER,
    jutsuLoadouts: FED_JUTSU_LOADOUTS.SILVER,
    itemLoadouts: FED_ITEM_LOADOUTS.SILVER,
    skillTreeResets: SKILL_TREE_RESET_FREE.SILVER,
    avatarSize: "1MB",
  },
  GOLD: {
    title: "Gold",
    usernameColor: "Gold",
    inventorySlots: FED_INVENTORY_SLOTS.GOLD,
    eventItems: FED_EVENT_ITEMS.GOLD,
    cookingSlots: FED_COOKING_SLOTS.GOLD,
    jutsuSlots: FED_JUTSU_SLOTS.GOLD,
    bankInterest: FED_BANK_INTEREST.GOLD,
    jutsuLoadouts: FED_JUTSU_LOADOUTS.GOLD,
    itemLoadouts: FED_ITEM_LOADOUTS.GOLD,
    skillTreeResets: SKILL_TREE_RESET_FREE.GOLD,
    avatarSize: "2MB",
  },
};

/**
 * Main component for doing paypal transactions
 */
export default function PaypalShop() {
  const { data: userData } = useRequiredUserData();
  const isNativeShell = useNativeShell();

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isNativeShell === undefined) {
    return <Loader explanation="Loading store" />;
  }

  // App Store guideline 3.1.1 requires digital goods to be sold through in-app purchase,
  // and both stores treat a web checkout inside the app as a violation. The native shell
  // therefore never sees web checkout.
  if (isNativeShell) {
    // Scoped to this branch on purpose. The native store is reached without passing through
    // the sub-components that carry this gate on the web, so without it a banned player
    // could still buy and the webhook would credit an account the game locks out. Gating
    // the whole page instead would take away the Subscriptions table below, and with it the
    // only in-game way for a banned player to stop a recurring web charge.
    if (userData.isBanned) return <BanInfo />;
    return <NativeStore />;
  }

  return (
    <PayPalScriptProvider
      deferLoading={!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID}
      options={{
        ...OPTIONS,
        vault: true,
      }}
    >
      <PaypalShopContent userData={userData} />
    </PayPalScriptProvider>
  );
}

/**
 * PayPal shop content wrapper with proper SDK management
 */
const PaypalShopContent = ({
  userData,
}: {
  userData: NonNullable<ReturnType<typeof useRequiredUserData>["data"]>;
}) => {
  const [activeTab, setActiveTab] = useState<string>("Reputation");
  const [, dispatch] = usePayPalScriptReducer();

  const allowance = api.paypal.getRecentRepsCount.useQuery({ userId: userData.userId });

  // Properly update SDK options when tab changes
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) return;
    dispatch({
      type: DISPATCH_ACTION.RESET_OPTIONS,
      value: {
        ...OPTIONS,
        vault: true,
        intent: activeTab === "Federal" ? "subscription" : "capture",
      },
    });
  }, [activeTab, dispatch]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <StripePaymentReturn />

      <ContentBox
        title={activeTab}
        subtitle={
          allowance.isPending
            ? "Loading monthly allowance…"
            : allowance.isError
              ? "Monthly allowance unavailable"
              : `Monthly reps ${allowance.data}/${dynamicMonthlyRepCap(userData)}`
        }
        topRightContent={
          <>
            <div className="grow"></div>
            <TabsList className="h-auto flex-wrap" aria-label="Store">
              {["Reputation", "Bundles", "Federal"].map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </>
        }
      >
        <TabsContent value="Reputation" className="mt-0">
          <ReputationStore />
        </TabsContent>
        <TabsContent value="Bundles" className="mt-0">
          <StoreBundles />
        </TabsContent>
        <TabsContent value="Federal" className="mt-0">
          <FederalStore />
        </TabsContent>
      </ContentBox>
      <StripePendingCheckouts />
      {activeTab === "Reputation" && <StripePaymentHistory />}
      {activeTab !== "Federal" && <TransactionHistory />}
      {activeTab !== "Federal" && <LookupTransaction />}
      {activeTab === "Federal" && <SubscriptionsOverview />}
      <StripeSubscriptions />
    </Tabs>
  );
};

/**
 * Reputation Store component
 */
const ReputationStore = () => {
  const { data: userData } = useRequiredUserData();
  const {
    data: purchasedReps,
    isPending: isLoadingLimit,
    isError,
    refetch,
  } = api.paypal.getRecentRepsCount.useQuery(
    { userId: userData?.userId ?? "-" },
    { enabled: !!userData },
  );
  const repFormMethods = useForm<BuyRepsSchema>({
    defaultValues: { reputationPoints: WEB_REP_PRESETS[0] },
  });
  const watchedPoints = useWatch({
    control: repFormMethods.control,
    name: "reputationPoints",
  });
  const { methods: userSearchMethods, users: watchedUsers } =
    useRecipientPicker(userData);
  const isAllowanceReady = !isLoadingLimit && !isError;
  const monthlyRemaining = isAllowanceReady
    ? Math.max(0, dynamicMonthlyRepCap(userData) - (purchasedReps ?? 0))
    : undefined;
  const maxPoints = Math.min(WEB_REP_MAX, monthlyRemaining ?? 0);
  const canBuy = isAllowanceReady && maxPoints >= WEB_REP_MIN;
  const valid =
    canBuy &&
    buyRepsSchema.safeParse({ reputationPoints: watchedPoints }).success &&
    watchedPoints <= maxPoints;
  const amount = valid ? reps2dollars(watchedPoints) : undefined;
  if (userData?.isBanned) return <BanInfo />;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Support Seichi with reputation points for yourself or another player.
      </p>
      {PAYPAL_DISCOUNT_PERCENT > 0 && (
        <p className="font-bold text-destructive">
          {PAYPAL_DISCOUNT_PERCENT}% discount applied
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Choose your reputation</CardTitle>
            <CardDescription>Enter an amount or select a quick pack.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label htmlFor="reputation-amount" className="block font-semibold text-sm">
              Reputation points
            </label>
            <NumberInput
              id="reputation-amount"
              min={canBuy ? WEB_REP_MIN : undefined}
              max={canBuy ? maxPoints : undefined}
              disabled={!canBuy}
              step={1}
              aria-describedby="reputation-limit"
              value={watchedPoints}
              onValueChange={(value) =>
                repFormMethods.setValue("reputationPoints", value)
              }
            />
            <div className="grid grid-cols-5 gap-1">
              {WEB_REP_PRESETS.map((points) => (
                <Button
                  key={points}
                  variant={watchedPoints === points ? "default" : "outline"}
                  className="min-w-0 px-1 text-xs"
                  disabled={points > maxPoints || isLoadingLimit || isError}
                  onClick={() => repFormMethods.setValue("reputationPoints", points)}
                >
                  {points} rep
                </Button>
              ))}
            </div>
            {canBuy && (
              <SliderField
                id="reputationPoints"
                default={WEB_REP_PRESETS[0]}
                min={WEB_REP_MIN}
                max={maxPoints}
                unit="reputation points"
                formatWatchedValue={(value) => `${value} reputation points`}
                register={repFormMethods.register}
                setValue={repFormMethods.setValue}
                watchedValue={
                  Number.isFinite(watchedPoints) ? watchedPoints : WEB_REP_MIN
                }
              />
            )}
            <p id="reputation-limit" className="text-muted-foreground text-sm">
              {isLoadingLimit
                ? "Loading your monthly allowance…"
                : isError
                  ? "Your monthly allowance is unavailable."
                  : !canBuy
                    ? `${monthlyRemaining} reputation points left this month. The minimum purchase is ${WEB_REP_MIN}.`
                    : `${monthlyRemaining} reputation points left this month. Buy ${WEB_REP_MIN}–${maxPoints} per purchase.`}
            </p>
            {canBuy && !valid && (
              <p role="alert" className="text-destructive text-sm">
                Enter a whole number between {WEB_REP_MIN} and {maxPoints}.
              </p>
            )}
            {isError && (
              <p role="alert">
                Could not load your allowance.{" "}
                <Button onClick={() => void refetch()}>Retry</Button>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Purchase summary</CardTitle>
            <CardDescription>
              Choose who receives the points before checkout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UserSearchSelect
              useFormMethods={userSearchMethods}
              showYourself
              showAi={false}
              inline
              maxUsers={1}
            />
            <div className="flex items-baseline justify-between border-y py-4">
              <span>{valid ? `${watchedPoints} reputation` : "Choose an amount"}</span>
              <strong className="text-2xl">
                {amount === undefined ? "—" : `$${amount.toFixed(2)}`}
                <span className="ml-1 font-normal text-sm">USD</span>
              </strong>
            </div>
            {watchedUsers[0] && (
              <StripeCheckoutButton
                userId={watchedUsers[0].userId}
                purchase={{ type: "reputation", reputationPoints: watchedPoints }}
                disabled={!valid || isLoadingLimit || isError}
              />
            )}
            <StoreCheckout
              recipientId={watchedUsers[0]?.userId}
              selection={{
                type: "custom",
                reputationPoints: valid ? watchedPoints : WEB_REP_MIN,
              }}
              disabled={!valid || isLoadingLimit || isError}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

/**
 * PayPal subscription button for one federal tier's subscription plan
 */
const PayPalSubscriptionButton = (props: {
  subscriptionPlan: string;
  userId: string;
  imageSrc: string;
  buttonStatus: FederalTier;
  currentUserStatus: (typeof FederalStatuses)[number];
  onSuccess?: () => void;
}) => {
  // User state
  const { data: userData } = useRequiredUserDataSelector((profile) => ({
    userId: profile.userId,
    reputationPoints: profile.reputationPoints,
  }));
  const [{ isResolved }] = usePayPalScriptReducer();

  // Track mount state to prevent operations after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  // Mutation for starting subscription
  const { mutate: subscribe, isPending: isSubscribing } =
    api.paypal.resolveSubscription.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) await updateUser(data, { revision });
        if (data.success && props.onSuccess) props.onSuccess();
      },
      onError: (error) => {
        onError(error);
      },
    });

  // Mutation for upgrading subscription
  const { mutate: upgrade, isPending: isUpgrading } =
    api.paypal.upgradeSubscription.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data, { revision, delta: data.userDelta });
          if (props.onSuccess) props.onSuccess();
        }
      },
      onError: (error) => {
        onError(error);
      },
    });

  // Mutation for buyins with reputation points
  const { mutate: buy, isPending: isBuying } = api.paypal.subscribeWithReps.useMutation(
    {
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data, { revision, delta: data.userDelta });
          if (props.onSuccess) props.onSuccess();
        }
      },
      onError: (error) => {
        onError(error);
      },
    },
  );

  // Loading status
  const isPending = isUpgrading || isSubscribing || isBuying;

  // Show a loader while a subscription or purchase mutation runs
  if (isPending) return <Loader explanation="Processing..." />;

  // Derived vars
  const current = FederalStatuses.indexOf(props.currentUserStatus);
  const next = FederalStatuses.indexOf(props.buttonStatus);
  const canUpgrade = next > current && props.userId === userData?.userId;
  const hasSubscription = props.currentUserStatus !== "NONE";
  const upgradeCost = calcFedUgradeCost(props.currentUserStatus, props.buttonStatus);

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <div
      className={`flex h-full flex-col rounded-lg border p-3 ${props.currentUserStatus === props.buttonStatus ? "border-primary bg-accent" : "bg-card"}`}
    >
      <div className="relative">
        <Image
          className="mx-auto mb-3 max-w-40"
          src={props.imageSrc}
          alt={props.buttonStatus}
          width={512}
          height={512}
        />
        {props.currentUserStatus === props.buttonStatus && (
          <Check className="absolute top-0 right-0 h-8 w-8 rounded-full bg-green-500 p-1" />
        )}
      </div>
      <div className="flex-1">
        <FederalTierBenefits status={props.buttonStatus} />
      </div>
      <div className="z-0 rounded-lg border-2 border-black bg-amber-200 p-2 text-center text-black hover:cursor-pointer hover:bg-orange-200">
        {isResolved ? (
          <PayPalButtons
            style={{ layout: "horizontal", label: "subscribe", tagline: false }}
            forceReRender={[props.userId]}
            createSubscription={(_data, actions) => {
              return actions.subscription.create({
                plan_id: props.subscriptionPlan,
                custom_id: `${userData.userId}-${props.userId}`,
              });
            }}
            onApprove={(data, actions) => {
              // Only proceed if component is still mounted
              if (!isMountedRef.current) return Promise.resolve();
              if (data.subscriptionID) {
                subscribe({
                  subscriptionId: data.subscriptionID,
                  orderId: data.orderID,
                });
              } else {
                showMutationToast({
                  success: false,
                  message:
                    "Subscription ID not returned. Please wait for the order to clear, then your status should be updated.",
                  title: "No subscription",
                });
              }
              // Send GTM event with conversion data
              if (actions.order) {
                return actions.order.capture().then((details) => {
                  if (!isMountedRef.current) return;
                  const purchaseUnit = details?.purchase_units?.[0];
                  const transaction_id = purchaseUnit?.invoice_id;
                  const currency = purchaseUnit?.amount?.currency_code;
                  const value = purchaseUnit?.amount?.value;
                  if (transaction_id && currency && value) {
                    sendGTMEvent({ ecommerce: null });
                    sendGTMEvent({
                      event: "purchase",
                      transaction_id: transaction_id,
                      currency: currency,
                      value: Number(value),
                      items: [
                        {
                          item_id: data.subscriptionID,
                          item_name: props.buttonStatus,
                        },
                      ],
                    });
                  }
                });
              } else {
                return Promise.resolve();
              }
            }}
            onError={(err) => {
              // Suppress PayPal cleanup errors (occur during navigation)
              if (isPayPalCleanupError(err)) return;
              // Only show toast if component is still mounted
              if (!isMountedRef.current) return;
              showMutationToast({
                success: false,
                message: "Subscription could not be processed. Please try again.",
                title: "Subscription Error",
              });
            }}
          />
        ) : process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? (
          <Loader />
        ) : (
          <p>PayPal checkout is temporarily unavailable.</p>
        )}
        <h3 className="font-bold italic">
          ${FEDERAL_MONTHLY_USD_CENTS[props.buttonStatus] / 100} USD / Month
        </h3>
      </div>
      <StripeCheckoutButton
        userId={props.userId}
        purchase={{ type: "federal", federalStatus: props.buttonStatus }}
      />
      {hasSubscription && canUpgrade && (
        <Confirm
          title="Confirm Upgrade"
          button={
            <div className="mt-2 w-full rounded-lg border-2 border-black bg-amber-200 p-2 text-center text-black hover:cursor-pointer hover:bg-orange-200">
              Upgrade for
              <h3 className="font-bold italic">{upgradeCost} Reputation Points</h3>
            </div>
          }
          onAccept={(e) => {
            e.preventDefault();
            e.stopPropagation();
            upgrade({ userId: props.userId, plan: props.buttonStatus });
          }}
        >
          You are about to upgrade your federal subscription. This can only be done if
          you own the PayPal or Stripe subscription in question, and only for your own
          character. This costs {upgradeCost} reputation points. For Stripe
          subscriptions, the upgrade lasts for the rest of the current paid period;
          renewals keep the original subscription tier. You currently have{" "}
          {userData?.reputationPoints} reputation points. Are you sure?
        </Confirm>
      )}
      {hasSubscription && !canUpgrade && (
        <p className="mt-2 text-center text-sm">
          {fedRepsUnavailableNote(
            props.currentUserStatus,
            props.buttonStatus,
            props.userId === userData.userId,
          )}
        </p>
      )}
      {!hasSubscription && (
        <Confirm
          title="Confirm Upgrade"
          button={
            <div className="mt-2 w-full rounded-lg border-2 border-black bg-amber-200 p-2 text-center text-black hover:cursor-pointer hover:bg-orange-200">
              Or, buy with
              <h3 className="font-bold italic">
                {fedStatusRepsCost(props.buttonStatus)} Reputation Points
              </h3>
            </div>
          }
          onAccept={(e) => {
            e.preventDefault();
            e.stopPropagation();
            buy({
              userId: props.userId,
              expectedUserId: userData.userId,
              status: props.buttonStatus,
            });
          }}
        >
          You are about to purchase a federal subscription with reputation points. You
          currently have {userData?.reputationPoints} reputation points. Are you sure?
        </Confirm>
      )}
    </div>
  );
};

/** Benefit list of one federal tier. */
const FederalTierBenefits = ({ status }: { status: FederalTier }) => {
  const benefits = FEDERAL_TIER_BENEFITS[status];
  const collectionSlots = PET_FED_COLLECTION_SLOTS[status];
  return (
    <>
      <h2 className="font-bold">{benefits.title} Support</h2>
      <ul className="mx-2 mb-2 ml-6 list-disc text-xs">
        <li>{benefits.usernameColor} username in tavern</li>
        <li>+{benefits.inventorySlots} Normal Inventory space</li>
        <li>+{benefits.eventItems - FED_EVENT_ITEMS.NONE} Event inventory space</li>
        <li>+{benefits.cookingSlots} Cooking inventory space</li>
        <li>
          +{collectionSlots} companion collection{" "}
          {collectionSlots === 1 ? "slot" : "slots"} while active
        </li>
        <li>
          +{benefits.jutsuSlots} Jutsu {benefits.jutsuSlots === 1 ? "slot" : "slots"}
        </li>
        <li>+{benefits.bankInterest}% bank interest</li>
        {status === "GOLD" && (
          <li>{FARM_GOLD_FED_TIME_REDUCTION_PERCENT}% faster farming</li>
        )}
        <li>{FED_JUTSU_LOADOUTS_BASE + benefits.jutsuLoadouts} jutsu loadouts</li>
        <li>{FED_ITEM_LOADOUTS_BASE + benefits.itemLoadouts} item loadouts</li>
        <li>+{benefits.skillTreeResets} skill tree resets per month</li>
        <li>
          {QUEUE_WAITING_SLOTS[status]} waiting slots in each training and crafting
          queue
        </li>
        <li>Custom avatar ({benefits.avatarSize})</li>
      </ul>
    </>
  );
};

/**
 * Federal Store component
 */
const FederalStore = () => {
  const { data: userData } = useRequiredUserData();
  const maxUsers = 1;
  const { methods: userSearchMethods, user: selectedUser } =
    useRecipientPicker(userData);

  const status = selectedUser?.federalStatus;

  // No fed for banned users
  if (userData?.isBanned) return <BanInfo />;

  return (
    <>
      {userData && (
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          showYourself={true}
          showAi={false}
          inline={true}
          maxUsers={maxUsers}
        />
      )}
      <p className="my-3 text-muted-foreground text-sm">
        Compare monthly federal benefits. Subscribe with PayPal or use reputation points
        for a month of support.
      </p>
      {status && status !== "NONE" && (
        <div className="my-3">
          This user already has federal support. If you are the creator of the
          subscription, you should be able to see it in a table below and cancel it.
          Manage Stripe renewal below, or use your PayPal account to manage PayPal
          subscriptions. Starting another provider subscription does not cancel the
          existing one.
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {FEDERAL_TIERS.map(({ status, image, planId }) => (
          <div key={status}>
            {selectedUser && userData ? (
              <PayPalSubscriptionButton
                subscriptionPlan={planId}
                userId={selectedUser.userId}
                imageSrc={image}
                buttonStatus={status}
                currentUserStatus={selectedUser.federalStatus}
                onSuccess={() => {
                  userSearchMethods.setValue("users", []);
                }}
              />
            ) : (
              <Loader />
            )}
          </div>
        ))}
      </div>
    </>
  );
};

/**
 * Subscriptions overview component
 */
const SubscriptionsOverview = () => {
  const { data: userData } = useRequiredUserInfo();
  const { data: subscriptions, refetch } = api.paypal.getPaypalSubscriptions.useQuery(
    undefined,
    { enabled: !!userData },
  );
  const allSubscriptions = subscriptions?.map((subscription) => {
    return {
      ...subscription,
      payer: subscription.createdBy?.avatar,
      receiver: subscription.affectedUser?.avatar,
    };
  });
  type Subscription = ArrayElement<typeof allSubscriptions>;
  const [pendingCancel, setPendingCancel] = useState<Subscription | null>(null);

  const { mutate: cancelSubscription, isPending } =
    api.paypal.cancelPaypalSubscription.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) setPendingCancel(null);
        await refetch();
      },
    });

  const columns: ColumnDefinitionType<Subscription, keyof Subscription>[] = [
    { key: "receiver", header: "Receiver", type: "avatar" },
    { key: "status", header: "Status", type: "string" },
    { key: "federalStatus", header: "Federal", type: "string" },
    { key: "createdAt", header: "Created", type: "date" },
  ];

  return allSubscriptions && allSubscriptions.length > 0 ? (
    <ContentBox
      title="Subscriptions"
      subtitle="Associated with your account."
      padding={false}
      initialBreak={true}
    >
      <Table
        data={allSubscriptions}
        columns={columns}
        buttons={[
          {
            label: "Cancel",
            onClick: (subscription: Subscription) => setPendingCancel(subscription),
          },
        ]}
      />
      <Modal
        id="paypal-subscription-cancel"
        title="Cancel subscription"
        isOpen={!!pendingCancel}
        setIsOpen={(open) => {
          if (!open) setPendingCancel(null);
        }}
        proceed_label="Cancel subscription"
        proceed_loading_label="Cancelling..."
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={isPending}
        keepOpenOnAccept={true}
        onAccept={() => {
          if (pendingCancel) {
            cancelSubscription({ subscriptionId: pendingCancel.subscriptionId });
          }
        }}
      >
        {pendingCancel && (
          <p>
            Cancel the <b>{pendingCancel.federalStatus}</b> subscription for{" "}
            {pendingCancel.affectedUser?.username ?? "this character"}? It stops at
            PayPal immediately and will not renew.
          </p>
        )}
      </Modal>
    </ContentBox>
  ) : null;
};

/**
 * Lookup a PayPal transaction
 */
const LookupTransaction = () => {
  // tRPC utility
  const utils = api.useUtils();
  const refreshStoreDelivery = useStoreDeliveryRefresh();

  // Form
  const searchForm = useForm<SearchPaypalTransactionSchema>({
    defaultValues: { transactionId: "", transactionDate: new Date() },
    resolver: zodResolver(searchPaypalTransactionSchema),
  });

  // Sync transaction
  const { mutate, isPending } = api.paypal.resolveTransaction.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      // A lookup can apply some receipts before another delivery fails.
      await Promise.all([utils.profile.getUser.invalidate(), refreshStoreDelivery()]);
    },
  });

  // Submit handler
  const handleSubmitRequest = searchForm.handleSubmit(
    (data) => mutate(data),
    (errors) => console.error(errors),
  );

  // Render input form
  return (
    <ContentBox
      title="Lookup Transaction"
      subtitle="Missing Points or Fed Support? Check status here!"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Searching..." />}
      {!isPending && (
        <Form {...searchForm}>
          <form onSubmit={handleSubmitRequest}>
            <div className="flex flex-row items-start gap-2">
              <FormField
                control={searchForm.control}
                name="transactionDate"
                render={({ field }) => (
                  <FormItem className="flex min-w-0 flex-1 flex-col">
                    <FormControl>
                      <Input
                        id="purchase-date"
                        type="date"
                        value={
                          field.value ? field.value.toISOString().slice(0, 10) : ""
                        }
                        min="1900-01-01"
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val ? new Date(val) : undefined);
                        }}
                      />
                    </FormControl>
                    <FormDescription>Approx. date of purchase</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={searchForm.control}
                name="transactionId"
                render={({ field }) => (
                  <FormItem className="min-w-0 flex-1">
                    <FormControl>
                      <Input {...field} placeholder="Transaction ID" />
                    </FormControl>
                    <FormDescription>Find on paypal receipt</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className="shrink-0" type="submit">
                <Search className="mr-1 h-5 w-5" />
                Look up
              </Button>
            </div>
          </form>
        </Form>
      )}
    </ContentBox>
  );
};

type FederalTier = Exclude<FederalStatus, "NONE">;
