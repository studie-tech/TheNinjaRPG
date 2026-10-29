"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendGTMEvent } from "@next/third-parties/google";
import {
  DISPATCH_ACTION,
  PayPalButtons,
  PayPalScriptProvider,
  usePayPalScriptReducer,
} from "@paypal/react-paypal-js";
import { Check, ChevronsUp, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
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
  FED_COOKING_GOLD_SLOTS,
  FED_COOKING_NORMAL_SLOTS,
  FED_COOKING_SILVER_SLOTS,
  FED_EVENT_ITEMS_DEFAULT,
  FED_EVENT_ITEMS_GOLD,
  FED_EVENT_ITEMS_NORMAL,
  FED_EVENT_ITEMS_SILVER,
  FED_GOLD_BANK_INTEREST,
  FED_GOLD_INVENTORY_SLOTS,
  FED_GOLD_ITEM_LOADOUTS,
  FED_GOLD_JUTSU_LOADOUTS,
  FED_GOLD_JUTSU_SLOTS,
  FED_ITEM_LOADOUTS_BASE,
  FED_JUTSU_LOADOUTS_BASE,
  FED_NORMAL_BANK_INTEREST,
  FED_NORMAL_INVENTORY_SLOTS,
  FED_NORMAL_ITEM_LOADOUTS,
  FED_NORMAL_JUTSU_LOADOUTS,
  FED_NORMAL_JUTSU_SLOTS,
  FED_SILVER_BANK_INTEREST,
  FED_SILVER_INVENTORY_SLOTS,
  FED_SILVER_ITEM_LOADOUTS,
  FED_SILVER_JUTSU_LOADOUTS,
  FED_SILVER_JUTSU_SLOTS,
  FEDERAL_MONTHLY_USD_CENTS,
  FederalStatuses,
  IMG_REPSHOP_BRONZE,
  IMG_REPSHOP_GOLD,
  IMG_REPSHOP_SILVER,
  PAYPAL_DISCOUNT_PERCENT,
  PET_FED_COLLECTION_SLOTS,
  QUEUE_WAITING_SLOTS,
  SKILL_TREE_RESET_FREE_GOLD,
  SKILL_TREE_RESET_FREE_NORMAL,
  SKILL_TREE_RESET_FREE_SILVER,
  WEB_REP_MAX,
  WEB_REP_MIN,
  WEB_REP_PRESETS,
} from "@/drizzle/constants";
import { useNativeShell } from "@/hooks/useNativeShell";
import BanInfo from "@/layout/BanInfo";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
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
import {
  calcFedUgradeCost,
  dynamicMonthlyRepCap,
  fedStatusRepsCost,
  reps2dollars,
} from "@/utils/paypal";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { BuyRepsSchema, SearchPaypalTransactionSchema } from "@/validators/points";
import { buyRepsSchema, searchPaypalTransactionSchema } from "@/validators/points";
import { getSearchValidator } from "@/validators/register";
import { StoreBundles } from "./StoreBundles";
import { StoreCheckout } from "./StoreCheckout";

const CURRENCY = "USD";
const OPTIONS = {
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "",
  currency: CURRENCY,
  intent: "capture",
};

/**
 * Helper to check if an error is a PayPal cleanup error that should be suppressed.
 * These occur when users navigate away while PayPal buttons are initializing,
 * or when users close the PayPal popup before the transaction completes.
 */
const isPayPalCleanupError = (err: unknown): boolean => {
  const errorMessage = err?.toString() ?? "";
  return (
    errorMessage.includes("zoid destroyed") ||
    errorMessage.includes("popup close") ||
    errorMessage.includes("Window closed") ||
    errorMessage.includes("Component closed") ||
    errorMessage.includes("Target window is closed")
  );
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
  const [isReady, setIsReady] = useState(true);
  const [, dispatch] = usePayPalScriptReducer();

  const allowance = api.paypal.getRecentRepsCount.useQuery(
    { userId: userData?.userId ?? "-" },
    { enabled: !!userData },
  );

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

  // Prevent PayPal components from rendering during unmount
  useEffect(() => {
    setIsReady(true);
    return () => {
      setIsReady(false);
    };
  }, []);

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
              : `Monthly Reps [${allowance.data} / ${dynamicMonthlyRepCap(userData)}]`
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
          {isReady ? <ReputationStore /> : <Loader />}
        </TabsContent>
        <TabsContent value="Bundles" className="mt-0">
          {isReady ? <StoreBundles /> : <Loader />}
        </TabsContent>
        <TabsContent value="Federal" className="mt-0">
          {isReady ? <FederalStore /> : <Loader />}
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
  const userSearchSchema = getSearchValidator({ max: 1 });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    defaultValues: { username: "", users: [] },
    resolver: zodResolver(userSearchSchema),
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  useEffect(() => {
    if (userData && watchedUsers.length === 0)
      userSearchMethods.setValue("users", [userData]);
  }, [userData, watchedUsers, userSearchMethods]);
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
 * Subscript paypal button, which needs a subscription plan as input
 */
const PayPalSubscriptionButton = (props: {
  subscriptionPlan: string;
  userId: string;
  buyerId: string;
  imageSrc: string;
  buttonStatus: (typeof FederalStatuses)[number];
  currentUserStatus: (typeof FederalStatuses)[number];
  onSuccess?: () => void;
  onFailure?: () => void;
}) => {
  // User state
  const { data: userData } = useRequiredUserData();
  const [{ isResolved }] = usePayPalScriptReducer();

  // Track mount state to prevent operations after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  // Mutation for starting subscription
  const { mutate: subscribe, isPending: isSubscribing } =
    api.paypal.resolveSubscription.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success || data.userPatch)
          await updateUser(data.userPatch, {
            revision,
            delta: data.userDelta,
            achievementProgress: data.achievementProgress,
          });
        if (data.success && props.onSuccess) props.onSuccess();
      },
      onError: (error) => {
        onError(error);
        if (props.onFailure) props.onFailure();
      },
    });

  // Mutation for upgrading subscription
  const { mutate: upgrade, isPending: isUpgrading } =
    api.paypal.upgradeSubscription.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data.userPatch, { revision, delta: data.userDelta });
          if (props.onSuccess) props.onSuccess();
        }
      },
      onError: (error) => {
        onError(error);
        if (props.onFailure) props.onFailure();
      },
    });

  // Mutation for buyins with reputation points
  const { mutate: buy, isPending: isBuying } = api.paypal.subscribeWithReps.useMutation(
    {
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data.userPatch, { revision, delta: data.userDelta });
          if (props.onSuccess) props.onSuccess();
        }
      },
      onError: (error) => {
        onError(error);
        if (props.onFailure) props.onFailure();
      },
    },
  );

  // Loading status
  const isPending = isUpgrading || isSubscribing || isBuying;

  // If not loaded yet, show loader
  if (isPending) return <Loader explanation="Processing..." />;

  const normalBenefits = (
    <>
      <h2 className="font-bold">Normal Support</h2>
      <ul className="mx-2 mb-2 ml-6 list-disc text-xs">
        <li>Blue username in tavern</li>
        <li>+{FED_NORMAL_INVENTORY_SLOTS} Normal Inventory space</li>
        <li>
          +{FED_EVENT_ITEMS_NORMAL - FED_EVENT_ITEMS_DEFAULT} Event inventory space
        </li>
        <li>+{FED_COOKING_NORMAL_SLOTS} Cooking inventory space</li>
        <li>
          +{PET_FED_COLLECTION_SLOTS.NORMAL} companion collection slot while active
        </li>
        <li>+{FED_NORMAL_JUTSU_SLOTS} Jutsu slot</li>
        <li>+{FED_NORMAL_BANK_INTEREST}% bank interest</li>
        <li>{FED_JUTSU_LOADOUTS_BASE + FED_NORMAL_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_ITEM_LOADOUTS_BASE + FED_NORMAL_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_NORMAL} skill tree resets per month</li>
        <li>
          {QUEUE_WAITING_SLOTS.NORMAL} waiting slots in each training and crafting queue
        </li>
        <li>Custom avatar (512KB)</li>
      </ul>
    </>
  );

  const silverBenefits = (
    <>
      <h2 className="font-bold">Silver Support</h2>
      <ul className="mx-2 mb-2 ml-6 list-disc text-xs">
        <li>Silver username in tavern</li>
        <li>+{FED_SILVER_INVENTORY_SLOTS} Normal Inventory space</li>
        <li>
          +{FED_EVENT_ITEMS_SILVER - FED_EVENT_ITEMS_DEFAULT} Event inventory space
        </li>
        <li>+{FED_COOKING_SILVER_SLOTS} Cooking inventory space</li>
        <li>
          +{PET_FED_COLLECTION_SLOTS.SILVER} companion collection slots while active
        </li>
        <li>+{FED_SILVER_JUTSU_SLOTS} Jutsu slots</li>
        <li>+{FED_SILVER_BANK_INTEREST}% bank interest</li>
        <li>{FED_JUTSU_LOADOUTS_BASE + FED_SILVER_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_ITEM_LOADOUTS_BASE + FED_SILVER_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_SILVER} skill tree resets per month</li>
        <li>
          {QUEUE_WAITING_SLOTS.SILVER} waiting slots in each training and crafting queue
        </li>
        <li>Custom avatar (1MB)</li>
      </ul>
    </>
  );

  const goldBenefits = (
    <>
      <h2 className="font-bold">Gold Support</h2>
      <ul className="mx-2 mb-2 ml-6 list-disc text-xs">
        <li>Gold username in tavern</li>
        <li>+{FED_GOLD_INVENTORY_SLOTS} Normal Inventory space</li>
        <li>+{FED_EVENT_ITEMS_GOLD - FED_EVENT_ITEMS_DEFAULT} Event inventory space</li>
        <li>+{FED_COOKING_GOLD_SLOTS} Cooking inventory space</li>
        <li>
          +{PET_FED_COLLECTION_SLOTS.GOLD} companion collection slots while active
        </li>
        <li>+{FED_GOLD_JUTSU_SLOTS} Jutsu slots</li>
        <li>+{FED_GOLD_BANK_INTEREST}% bank interest</li>
        <li>{FARM_GOLD_FED_TIME_REDUCTION_PERCENT}% faster farming</li>
        <li>{FED_JUTSU_LOADOUTS_BASE + FED_GOLD_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_ITEM_LOADOUTS_BASE + FED_GOLD_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_GOLD} skill tree resets per month</li>
        <li>
          {QUEUE_WAITING_SLOTS.GOLD} waiting slots in each training and crafting queue
        </li>
        <li>Custom avatar (2MB)</li>
      </ul>
    </>
  );

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
        {hasSubscription && canUpgrade && (
          <Confirm
            title="Confirm Upgrade"
            button={
              <ChevronsUp className="absolute top-0 right-0 h-8 w-8 cursor-pointer rounded-full bg-blue-500 p-1 hover:bg-green-500" />
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
      </div>
      <div className="flex-1">
        {props.buttonStatus === "NORMAL" && normalBenefits}
        {props.buttonStatus === "SILVER" && silverBenefits}
        {props.buttonStatus === "GOLD" && goldBenefits}
      </div>
      <div className="z-0 rounded-lg border-2 border-black bg-amber-200 p-2 text-center text-black hover:cursor-pointer hover:bg-orange-200">
        {isResolved ? (
          <PayPalButtons
            style={{ layout: "horizontal", label: "subscribe", tagline: false }}
            forceReRender={[props.userId]}
            createSubscription={(_data, actions) => {
              return actions.subscription.create({
                plan_id: props.subscriptionPlan,
                custom_id: `${props.buyerId}-${props.userId}`,
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
            onCancel={() => {
              // User closed the popup without completing subscription - this is expected behavior
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
        {props.buttonStatus === "NORMAL" && (
          <h3 className="font-bold italic">
            ${FEDERAL_MONTHLY_USD_CENTS.NORMAL / 100} USD / Month
          </h3>
        )}
        {props.buttonStatus === "SILVER" && (
          <h3 className="font-bold italic">
            ${FEDERAL_MONTHLY_USD_CENTS.SILVER / 100} USD / Month
          </h3>
        )}
        {props.buttonStatus === "GOLD" && (
          <h3 className="font-bold italic">
            ${FEDERAL_MONTHLY_USD_CENTS.GOLD / 100} USD / Month
          </h3>
        )}
      </div>
      {props.buttonStatus !== "NONE" && (
        <StripeCheckoutButton
          userId={props.userId}
          purchase={{ type: "federal", federalStatus: props.buttonStatus }}
        />
      )}
      {!hasSubscription && (
        <Confirm
          title="Confirm Upgrade"
          button={
            <div className="mt-2 w-full rounded-lg border-2 border-black bg-amber-200 p-2 text-center text-black hover:cursor-pointer hover:bg-orange-200">
              Or, buy with
              {props.buttonStatus === "NORMAL" && (
                <h3 className="font-bold italic">
                  {fedStatusRepsCost("NORMAL")} Reputation Points
                </h3>
              )}
              {props.buttonStatus === "SILVER" && (
                <h3 className="font-bold italic">
                  {fedStatusRepsCost("SILVER")} Reputation Points
                </h3>
              )}
              {props.buttonStatus === "GOLD" && (
                <h3 className="font-bold italic">
                  {fedStatusRepsCost("GOLD")} Reputation Points
                </h3>
              )}
            </div>
          }
          onAccept={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (userData)
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

/**
 * Federal Store component
 */
const FederalStore = () => {
  const { data: userData } = useRequiredUserData();
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    defaultValues: { username: "", users: [] },
    resolver: zodResolver(userSearchSchema),
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  const selectedUser = watchedUsers?.[0];

  useEffect(() => {
    if (userData?.username && watchedUsers.length === 0) {
      userSearchMethods.setValue("users", [userData]);
    }
  }, [userData, userSearchMethods, watchedUsers]);

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
        <div>
          {selectedUser && userData ? (
            <PayPalSubscriptionButton
              subscriptionPlan={process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL}
              userId={selectedUser.userId}
              buyerId={userData.userId}
              imageSrc={IMG_REPSHOP_BRONZE}
              buttonStatus="NORMAL"
              currentUserStatus={selectedUser.federalStatus}
              onSuccess={() => {
                userSearchMethods.setValue("users", []);
              }}
            />
          ) : (
            <Loader />
          )}
        </div>

        <div>
          {selectedUser && userData ? (
            <PayPalSubscriptionButton
              subscriptionPlan={process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER}
              userId={selectedUser.userId}
              buyerId={userData.userId}
              imageSrc={IMG_REPSHOP_SILVER}
              buttonStatus="SILVER"
              currentUserStatus={selectedUser.federalStatus}
              onSuccess={() => {
                userSearchMethods.setValue("users", []);
              }}
            />
          ) : (
            <Loader />
          )}
        </div>

        <div>
          {selectedUser && userData ? (
            <PayPalSubscriptionButton
              subscriptionPlan={process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD}
              userId={selectedUser.userId}
              buyerId={userData.userId}
              imageSrc={IMG_REPSHOP_GOLD}
              buttonStatus="GOLD"
              currentUserStatus={selectedUser.federalStatus}
              onSuccess={() => {
                userSearchMethods.setValue("users", []);
              }}
            />
          ) : (
            <Loader />
          )}
        </div>
      </div>
    </>
  );
};

/**
 * Subscriptions overview component
 */
const SubscriptionsOverview = () => {
  const { data: userData } = useRequiredUserData();
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

  const { mutate: cancelSubscription, isPending } =
    api.paypal.cancelPaypalSubscription.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
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
      {isPending ? (
        <Loader />
      ) : (
        <Table
          data={allSubscriptions}
          columns={columns}
          buttons={[
            {
              label: "Cancel",
              onClick: (subscription: Subscription) => {
                cancelSubscription({
                  subscriptionId: subscription.subscriptionId,
                });
              },
            },
          ]}
        />
      )}
    </ContentBox>
  ) : null;
};

/**
 * Lookup paypal subscription
 */
const LookupTransaction = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  // tRPC utility
  const utils = api.useUtils();

  // Form
  const searchForm = useForm<SearchPaypalTransactionSchema>({
    defaultValues: { transactionId: "", transactionDate: new Date() },
    resolver: zodResolver(searchPaypalTransactionSchema),
  });

  // Sync transaction
  const { mutate, isPending } = api.paypal.resolveTransaction.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success || data.userPatch)
        await updateUser(data.userPatch, {
          revision,
          delta: data.userDelta,
          achievementProgress: data.achievementProgress,
        });
      if (data.success) {
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.paypal.getRecentRepsCount.invalidate(),
          utils.paypal.getPaypalTransactions.invalidate(),
          utils.paypal.getStoreBundles.invalidate(),
        ]);
      }
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
          <form onSubmit={handleSubmitRequest} className="relative">
            <div className="relative flex flex-row gap-2">
              <FormField
                control={searchForm.control}
                name="transactionDate"
                render={({ field }) => (
                  <FormItem className="flex basis-1/2 flex-col">
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
                  <FormItem className="basis-1/2">
                    <FormControl>
                      <Input {...field} placeholder="Transaction ID" />
                    </FormControl>
                    <FormDescription>Find on paypal receipt</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className="absolute top-0 right-0" type="submit">
                <Search className="mr-1 h-5 w-5" />
              </Button>
            </div>
          </form>
        </Form>
      )}
    </ContentBox>
  );
};
