"use client";

import Image from "@/layout/Image";
import Table from "@/layout/Table";
import SliderField from "@/layout/SliderField";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import NavTabs from "@/layout/NavTabs";
import BanInfo from "@/layout/BanInfo";
import { Button } from "@/components/ui/button";
import { useForm, useWatch } from "react-hook-form";
import { useState, useEffect, useRef } from "react";
import {
  PayPalScriptProvider,
  PayPalButtons,
  usePayPalScriptReducer,
  DISPATCH_ACTION,
} from "@paypal/react-paypal-js";
import { api, onError } from "@/app/_trpc/client";
import { useInfinitePagination } from "@/libs/pagination";
import { useRequiredUserData } from "@/utils/UserContext";
import { reps2dollars, calcFedUgradeCost, fedStatusRepsCost } from "@/utils/paypal";
import { showMutationToast } from "@/libs/toast";
import { getSearchValidator } from "@/validators/register";
import { FederalStatuses } from "@/drizzle/constants";
import { buyRepsSchema } from "@/validators/points";
import { searchPaypalTransactionSchema } from "@/validators/points";
import { zodResolver } from "@hookform/resolvers/zod";
import { nanoid } from "nanoid";
import { Check, ChevronsUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { sendGTMEvent } from "@next/third-parties/google";
import { dynamicMonthlyRepCap } from "@/utils/paypal";
import { FED_NORMAL_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_SILVER_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_GOLD_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_NORMAL_JUTSU_SLOTS } from "@/drizzle/constants";
import { FED_SILVER_JUTSU_SLOTS } from "@/drizzle/constants";
import { FED_GOLD_JUTSU_SLOTS } from "@/drizzle/constants";
import { FED_NORMAL_BANK_INTEREST } from "@/drizzle/constants";
import { FED_SILVER_BANK_INTEREST } from "@/drizzle/constants";
import { FED_GOLD_BANK_INTEREST } from "@/drizzle/constants";
import { IMG_REPSHOP_BRONZE } from "@/drizzle/constants";
import { IMG_REPSHOP_SILVER } from "@/drizzle/constants";
import { SKILL_TREE_RESET_FREE_GOLD } from "@/drizzle/constants";
import { SKILL_TREE_RESET_FREE_NORMAL } from "@/drizzle/constants";
import { SKILL_TREE_RESET_FREE_SILVER } from "@/drizzle/constants";
import { IMG_REPSHOP_GOLD } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_NORMAL } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_SILVER } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_GOLD } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_DEFAULT } from "@/drizzle/constants";
import { FED_NORMAL_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_SILVER_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_GOLD_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_NORMAL_ITEM_LOADOUTS } from "@/drizzle/constants";
import { FED_SILVER_ITEM_LOADOUTS } from "@/drizzle/constants";
import { FED_GOLD_ITEM_LOADOUTS } from "@/drizzle/constants";
import { PAYPAL_DISCOUNT_PERCENT } from "@/drizzle/constants";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { ColumnDefinitionType } from "@/layout/Table";
import type { z } from "zod";
import type { BuyRepsSchema } from "@/validators/points";
import type { SearchPaypalTransactionSchema } from "@/validators/points";
import type { ArrayElement } from "@/utils/typeutils";

const CURRENCY = "USD";
const OPTIONS = {
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
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

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <>
      {process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID && (
        <PayPalScriptProvider
          options={{
            ...OPTIONS,
            vault: true,
          }}
        >
          <PaypalShopContent userData={userData} />
        </PayPalScriptProvider>
      )}
    </>
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
  const currency = "USD";

  const { data: purchasedReps } = api.paypal.getRecentRepsCount.useQuery(
    { userId: userData?.userId ?? "-" },
    { enabled: !!userData },
  );

  // Properly update SDK options when tab changes
  useEffect(() => {
    dispatch({
      type: DISPATCH_ACTION.RESET_OPTIONS,
      value: {
        ...OPTIONS,
        vault: true,
        intent: activeTab === "Reputation" ? "capture" : "subscription",
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
    <>
      <ContentBox
        title={activeTab}
        subtitle={`Monthly Reps [${purchasedReps ?? 0} / ${dynamicMonthlyRepCap(userData)}]`}
        padding={activeTab === "Log" ? false : true}
        topRightContent={
          <>
            <div className="grow"></div>
            <NavTabs
              current={activeTab}
              options={["Reputation", "Federal"]}
              setValue={setActiveTab}
            />
          </>
        }
      >
        {isReady && activeTab === "Reputation" && (
          <ReputationStore currency={currency} />
        )}
        {isReady && activeTab === "Federal" && <FederalStore />}
        {!isReady && <Loader explanation="Loading..." />}
      </ContentBox>
      {activeTab === "Reputation" && <TransactionHistory userId={userData.userId} />}
      {activeTab === "Reputation" && <LookupTransaction />}
      {activeTab === "Federal" && <SubscriptionsOverview />}
    </>
  );
};

/**
 * Reputation Store component
 */
const ReputationStore = (props: { currency: string }) => {
  const { data: userData } = useRequiredUserData();
  const [{ isResolved }] = usePayPalScriptReducer();
  const [amount, setAmount] = useState(0);
  const maxUsers = 1;
  const invoiceIdRef = useRef(nanoid());
  const isMountedRef = useRef(true);

  // Track mount state to prevent operations after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const utils = api.useUtils();

  const { mutate: buyReps, isPending } = api.paypal.resolveOrder.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.profile.getUser.invalidate();
    },
  });

  const { data: purchasedReps } = api.paypal.getRecentRepsCount.useQuery(
    { userId: userData?.userId ?? "-" },
    { enabled: !!userData },
  );

  const repFormMethods = useForm<BuyRepsSchema>({
    defaultValues: { reputationPoints: 20 },
    resolver: zodResolver(buyRepsSchema),
  });

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
  const watchedPoints = useWatch({
    control: repFormMethods.control,
    name: "reputationPoints",
    defaultValue: 20,
  });
  const selectedUser = watchedUsers?.[0];

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setAmount(reps2dollars(watchedPoints));
    }, 200);
    return () => clearTimeout(delayDebounceFn);
  }, [watchedPoints, setAmount]);

  useEffect(() => {
    if (userData && userData.username && watchedUsers.length === 0) {
      userSearchMethods.setValue("users", [userData]);
    }
  }, [userData, userSearchMethods, watchedUsers]);

  // No reps for banned users
  if (userData?.isBanned) return <BanInfo />;

  // Set the maximum number of purchaseable points
  const dynamicLimit = dynamicMonthlyRepCap(userData);
  const maxPoints = purchasedReps ? dynamicLimit - purchasedReps : dynamicLimit;

  return (
    <>
      <div className="text-center text-2xl">
        {PAYPAL_DISCOUNT_PERCENT > 0 && (
          <p className="text-red-500 font-bold text-3xl">
            {PAYPAL_DISCOUNT_PERCENT}% Discount Applied!
          </p>
        )}
        <SliderField
          id="reputationPoints"
          default={20}
          min={5}
          max={maxPoints}
          unit={`reputation points for $${amount} USD`}
          register={repFormMethods.register}
          setValue={repFormMethods.setValue}
          watchedValue={watchedPoints}
          error={repFormMethods.formState.errors.reputationPoints?.message}
        />
      </div>
      {userData && (
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          selectedUsers={[userData]}
          showYourself={true}
          showAi={false}
          inline={true}
          maxUsers={maxUsers}
        />
      )}
      <div className="grid grid-cols-2 mt-3">
        <div className="bg-slate-500 mx-2 mb-2 rounded-md p-2 font-bold text-center cursor-not-allowed">
          Crypto, Coming Soon
        </div>
        {isResolved && userData && selectedUser && !isPending ? (
          <PayPalButtons
            style={{ layout: "horizontal", tagline: false }}
            forceReRender={[amount, watchedUsers, props.currency]}
            createOrder={(data, actions) => {
              return actions.order.create({
                intent: "CAPTURE",
                purchase_units: [
                  {
                    amount: {
                      currency_code: props.currency,
                      value: amount.toString(),
                    },
                    invoice_id: invoiceIdRef.current,
                    custom_id: `${userData.userId}-${selectedUser.userId}`,
                  },
                ],
              });
            }}
            onApprove={(data, actions) => {
              invoiceIdRef.current = nanoid();
              if (actions.order) {
                return actions.order.capture().then((details) => {
                  // Only proceed if component is still mounted
                  if (!isMountedRef.current) return;
                  buyReps({ orderId: details.id ?? nanoid() });
                  // Send GTM event with conversion data
                  const purchaseUnit = details?.purchase_units?.[0];
                  const transaction_id = purchaseUnit?.invoice_id;
                  const currency = purchaseUnit?.amount?.currency_code;
                  const value = purchaseUnit?.amount?.value;
                  if (transaction_id && currency && value) {
                    sendGTMEvent({ ecommerce: null });
                    sendGTMEvent({
                      event: "purchase",
                      ecommerce: {
                        transaction_id: transaction_id,
                        value: Number(value),
                        currency: currency,
                        items: [
                          {
                            item_id: "BASIC_REPS",
                            item_name: "REPUTATION POINTS",
                            price: Number(value),
                            quantity: 1,
                          },
                        ],
                      },
                    });
                  }
                });
              } else {
                if (!isMountedRef.current) return Promise.resolve();
                showMutationToast({
                  success: false,
                  message:
                    "Order not fully completed yet. Please wait for the order to clear, or when you know your transaction ID, contact support through our paypal email",
                  title: "No order",
                });
                return Promise.resolve();
              }
            }}
            onCancel={() => {
              // User closed the popup without completing payment - this is expected behavior
            }}
            onError={(err) => {
              // Suppress PayPal cleanup errors (occur during navigation)
              if (isPayPalCleanupError(err)) return;
              // Only show toast if component is still mounted
              if (!isMountedRef.current) return;
              showMutationToast({
                success: false,
                message: "Payment could not be processed. Please try again.",
                title: "Payment Error",
              });
            }}
          />
        ) : (
          <Loader />
        )}
      </div>
    </>
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

  // tRPC utility
  const utils = api.useUtils();

  // Mutation for starting subscription
  const { mutate: subscribe, isPending: isSubscribing } =
    api.paypal.resolveSubscription.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.profile.getUser.invalidate();
        if (props.onSuccess) props.onSuccess();
      },
      onError: (error) => {
        onError(error);
        if (props.onFailure) props.onFailure();
      },
    });

  // Mutation for upgrading subscription
  const { mutate: upgrade, isPending: isUpgrading } =
    api.paypal.upgradeSubscription.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
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
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
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
        <li>+{FED_NORMAL_JUTSU_SLOTS} Jutsu slot</li>
        <li>+{FED_NORMAL_BANK_INTEREST}% bank interest</li>
        <li>{FED_NORMAL_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_NORMAL_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_NORMAL} skill tree resets per month</li>
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
        <li>+{FED_SILVER_JUTSU_SLOTS} Jutsu slots</li>
        <li>+{FED_SILVER_BANK_INTEREST}% bank interest</li>
        <li>{FED_SILVER_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_SILVER_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_SILVER} skill tree resets per month</li>
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
        <li>+{FED_GOLD_JUTSU_SLOTS} Jutsu slots</li>
        <li>+{FED_GOLD_BANK_INTEREST}% bank interest</li>
        <li>{FED_GOLD_JUTSU_LOADOUTS} jutsu loadouts</li>
        <li>{FED_GOLD_ITEM_LOADOUTS} item loadouts</li>
        <li>+{SKILL_TREE_RESET_FREE_GOLD} skill tree resets per month</li>
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
      className={`${
        props.currentUserStatus === props.buttonStatus ? "bg-orange-200 rounded-lg" : ""
      }`}
    >
      <div className="relative">
        <Image
          className={`mb-3`}
          src={props.imageSrc}
          alt={props.buttonStatus}
          width={512}
          height={512}
        />
        {props.currentUserStatus === props.buttonStatus && (
          <Check className="absolute top-0 right-0 h-8 w-8 rounded-full bg-green-500 p-1" />
        )}
        {hasSubscription && canUpgrade && (
          <Confirm2
            title="Confirm Upgrade"
            button={
              <ChevronsUp className="absolute top-0 right-0 h-8 w-8 rounded-full bg-blue-500 p-1 cursor-pointer hover:bg-green-500" />
            }
            onAccept={(e) => {
              e.preventDefault();
              e.stopPropagation();
              upgrade({ userId: props.userId, plan: props.buttonStatus });
            }}
          >
            You are about to upgrade your federal subscription. This can only be done if
            you own the paypal subscription in question, and only for your own
            character. Note that this action is permanent and will cost {upgradeCost}{" "}
            reputation points. You currently have {userData?.reputationPoints}{" "}
            reputation points. Are you sure?
          </Confirm2>
        )}
      </div>
      <div>
        {props.buttonStatus === "NORMAL" && normalBenefits}
        {props.buttonStatus === "SILVER" && silverBenefits}
        {props.buttonStatus === "GOLD" && goldBenefits}
      </div>
      <div className="bg-amber-200 text-black border-2 z-0 border-black p-2 rounded-lg text-center hover:cursor-pointer hover:bg-orange-200">
        {isResolved ? (
          <PayPalButtons
            style={{ layout: "horizontal", label: "subscribe", tagline: false }}
            forceReRender={[props.userId]}
            createSubscription={(data, actions) => {
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
        ) : (
          <Loader />
        )}
        {props.buttonStatus === "NORMAL" && (
          <h3 className="font-bold italic">$5 / Month</h3>
        )}
        {props.buttonStatus === "SILVER" && (
          <h3 className="font-bold italic">$10 / Month</h3>
        )}
        {props.buttonStatus === "GOLD" && (
          <h3 className="font-bold italic">$15 / Month</h3>
        )}
      </div>
      {!hasSubscription && (
        <Confirm2
          title="Confirm Upgrade"
          button={
            <div className="bg-amber-200 text-black border-2 border-black p-2 mt-2 rounded-lg text-center hover:cursor-pointer hover:bg-orange-200">
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
            buy({ userId: props.userId, status: props.buttonStatus });
          }}
        >
          You are about to purchase a federal subscription with reputation points. You
          currently have {userData?.reputationPoints} reputation points. Are you sure?
        </Confirm2>
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
    if (userData && userData.username && watchedUsers.length === 0) {
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
          selectedUsers={[userData]}
          showYourself={true}
          showAi={false}
          inline={true}
          maxUsers={maxUsers}
        />
      )}
      {status !== "NONE" && (
        <div className="my-3">
          This user already has federal support. If you are the creator of the
          subscription, you should be able to see it in a table below and cancel it.
          Otherwise, please go to your paypal account directly to manage the
          subscription.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
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
  ) : (
    <></>
  );
};

/**
 * Transaction History component
 */
export const TransactionHistory: React.FC<{ userId: string }> = (props) => {
  const { userId } = props;
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  const {
    data: transactions,
    fetchNextPage,
    hasNextPage,
  } = api.paypal.getPaypalTransactions.useInfiniteQuery(
    { limit: 10, userId },
    {
      enabled: !!userId,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allTransactions = transactions?.pages
    .map((page) => page.data)
    .flat()
    .map((transaction) => {
      return {
        ...transaction,
        receiver: transaction.affectedUser?.avatar || IMG_AVATAR_DEFAULT,
        value: `${transaction.amount} ${transaction.currency}`,
      };
    });

  type Transaction = ArrayElement<typeof allTransactions>;

  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  const columns: ColumnDefinitionType<Transaction, keyof Transaction>[] = [
    { key: "receiver", header: "Receiver", type: "avatar" },
    { key: "transactionId", header: "Transaction ID", type: "string" },
    { key: "reputationPoints", header: "Points", type: "string" },
    { key: "value", header: "Amount", type: "string" },
    { key: "type", header: "Type", type: "capitalized" },
    { key: "transactionUpdatedDate", header: "Last Update", type: "string" },
  ];

  // If no previous, do not show
  if (!allTransactions || allTransactions.length === 0) return null;

  return (
    <ContentBox
      title="Transaction History"
      subtitle="Previous purchases"
      initialBreak={true}
      padding={false}
    >
      <Table
        data={allTransactions}
        columns={columns}
        linkPrefix="/userid/"
        setLastElement={setLastElement}
      />
    </ContentBox>
  );
};

/**
 * Lookup paypal subscription
 */
const LookupTransaction = () => {
  // tRPC utility
  const utils = api.useUtils();

  // Form
  const searchForm = useForm<SearchPaypalTransactionSchema>({
    defaultValues: { transactionId: "", transactionDate: new Date() },
    resolver: zodResolver(searchPaypalTransactionSchema),
  });

  // Sync transaction
  const { mutate, isPending } = api.paypal.resolveTransaction.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
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
                  <FormItem className="flex flex-col basis-1/2">
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
