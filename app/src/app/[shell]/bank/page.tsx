"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronsLeft,
  ChevronsRight,
  Coins,
  Gift,
  Landmark,
  Send,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
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
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { BANK_INTEREST_CLAIM_DAYS, IMG_BUILDING_BANK } from "@/drizzle/constants";
import { useClaimBankInterest, usePendingBankInterest } from "@/hooks/useBankInterest";
import BanInfo from "@/layout/BanInfo";
import ContentBox from "@/layout/ContentBox";
import GraphBankLedger from "@/layout/GraphBankLedger";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserPicker } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { calcBankInterest, getStrucBoost } from "@/utils/village";
import {
  createMoneyTransferSchema,
  type MoneyTransferSchema,
  type MoneyTransferSchemaInput,
} from "@/validators/bank";

/** Render bank balances, money transfers and claimable interest. */
export default function Bank() {
  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{
    targetId: string;
    username: string;
    amount: number;
  } | null>(null);

  // User data
  const { userData, access, timeDiff, prepareUserUpdate, updateUser } =
    useRequireInVillage("/bank");
  const money = userData?.money ?? 0;
  const bank = userData?.bank ?? 0;

  // Current interest
  const boost = getStrucBoost("bankInterestPerLvl", userData?.village?.structures);
  const interest = calcBankInterest(boost, userData);

  // Pending interest query
  const { data: pendingInterest } = usePendingBankInterest(!!userData, timeDiff);

  // Schemas
  const fromPocketSchema = createMoneyTransferSchema(money);
  const fromBankSchema = createMoneyTransferSchema(bank);

  // Forms
  const toBankForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: undefined },
    resolver: zodResolver(fromPocketSchema),
  });
  const toPocketForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: undefined },
    resolver: zodResolver(fromBankSchema),
  });
  const toUserForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: undefined },
    resolver: zodResolver(fromBankSchema),
  });

  // Mutations
  // Deposits and withdrawals return both balances and clear their own form
  const moveMoneyOptions = (form: typeof toBankForm) => ({
    onMutate: prepareUserUpdate,
    onSuccess: async (
      data: RouterOutputs["bank"]["toBank"],
      _variables: unknown,
      revision: number | undefined,
    ) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser(
          {
            bank: data.data.bank,
            money: data.data.money,
          },
          { revision },
        );
        form.reset();
      }
    },
  });
  const { mutate: toBank, isPending: l1 } = api.bank.toBank.useMutation(
    moveMoneyOptions(toBankForm),
  );
  const { mutate: toPocket, isPending: l2 } = api.bank.toPocket.useMutation(
    moveMoneyOptions(toPocketForm),
  );

  const { mutate: transfer, isPending: l3 } = api.bank.transfer.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser(
          {
            bank: data.data.bank,
          },
          { revision },
        );
        toUserForm.reset();
        setPendingTransfer(null);
      }
    },
  });

  const { mutate: claimInterest, isPending: l4 } = useClaimBankInterest();

  // User search
  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useUserPicker(maxUsers);

  // User search for ledger sender
  const { methods: userSearchMethodsFrom, user: targetUserFrom } =
    useUserPicker(maxUsers);

  // User search for ledger receiver
  const { methods: userSearchMethodsTo, user: targetUserTo } = useUserPicker(maxUsers);

  // Getting bank transers
  const {
    data: ledger,
    fetchNextPage,
    hasNextPage,
  } = api.bank.getTransfers.useInfiniteQuery(
    {
      limit: 30,
      senderId: targetUserFrom?.userId,
      receiverId: targetUserTo?.userId,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5, // every 5min
    },
  );
  const allTransfers = ledger?.pages
    .flatMap((page) => page.data)
    .map((entry) => ({
      ...entry,
      sender: entry.sender?.username ?? "Unknown",
      receiver: entry.receiver?.username ?? "Unknown",
      amountFormatted: entry.amount.toLocaleString(),
      // Date only keeps rows one line tall on phones; the full time shows on hover
      date: (
        <span className="whitespace-nowrap" title={entry.createdAt.toLocaleString()}>
          {entry.createdAt.toLocaleDateString()}
        </span>
      ),
    }));
  type Transfer = ArrayElement<typeof allTransfers>;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Table component
  const columns: ColumnDefinitionType<Transfer, keyof Transfer>[] = [
    { key: "sender", header: "Sender", type: "string" },
    { key: "receiver", header: "Receiver", type: "string" },
    { key: "type", header: "Type", type: "string", className: "hidden sm:table-cell" },
    { key: "amountFormatted", header: "Amount", type: "string" },
    { key: "date", header: "Date", type: "jsx" },
  ];

  // Submit handlers
  const onDeposit = toBankForm.handleSubmit((data) => toBank(data));
  const onWithdraw = toPocketForm.handleSubmit((data) => toPocket(data));
  // Transfers to another player cannot be undone, so they open a summary first
  const onTransfer = toUserForm.handleSubmit((data) => {
    if (targetUser) {
      setPendingTransfer({
        targetId: targetUser.userId,
        username: targetUser.username,
        amount: data.amount,
      });
    } else {
      showMutationToast({ success: false, message: "No receiver selected" });
    }
  });

  // Loading screens
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Bank" />;
  if (userData.isBanned) return <BanInfo />;
  // One transaction at a time: every bank control waits while any of them is pending.
  const isTransacting = l1 || l2 || l3 || l4;

  return (
    <>
      <ContentBox
        title="Bank"
        subtitle={`Save money & earn ${interest}% interest / day`}
        defaultBackHref="/village"
        padding={false}
      >
        <Image
          alt="welcome"
          src={IMG_BUILDING_BANK}
          width={512}
          height={195}
          className="w-full"
          priority={true}
        />
        <div className="my-4 grid grid-cols-2 text-center">
          <div className="flex flex-col items-center">
            <Coins className="h-20 w-20" />
            <p className="text-lg">{money.toLocaleString()} ryo</p>
            <h2 className="font-bold text-xl">Money on hand</h2>
            <div className="w-full px-4 pt-3">
              <AmountForm
                form={toBankForm}
                onSubmit={onDeposit}
                disabled={isTransacting}
                pending={l1}
                id="amount-to-bank"
                placeholder="Transfer to bank"
                max={money}
                label="Deposit"
                icon={<ChevronsRight className="h-5 w-5" />}
              />
            </div>
          </div>
          <div className="flex flex-col items-center">
            <Landmark className="h-20 w-20" />
            <p className="text-lg">{bank.toLocaleString()} ryo</p>
            <h2 className="font-bold text-xl">Money in bank</h2>
            <div className="w-full px-4 pt-3">
              <AmountForm
                form={toPocketForm}
                onSubmit={onWithdraw}
                disabled={isTransacting}
                pending={l2}
                id="amount-to-pocket"
                placeholder="Transfer to pocket"
                max={bank}
                label="Withdraw"
                icon={<ChevronsLeft className="h-5 w-5" />}
              />
            </div>
          </div>
        </div>
      </ContentBox>
      {pendingInterest && pendingInterest.totalPending > 0 && (
        <ContentBox
          title="Pending Interest"
          subtitle={`Claim interest from today and the previous ${BANK_INTEREST_CLAIM_DAYS - 1} days (UTC). Older interest expires.`}
          initialBreak={true}
          padding={false}
        >
          <div className="flex w-full flex-col items-center p-4">
            <Gift className="mb-2 h-16 w-16" />
            <p className="mb-2 text-lg">
              You have {pendingInterest.totalPending} ryo in unclaimed interest!
            </p>
            <p className="mb-4 text-muted-foreground text-sm">
              From {pendingInterest.records.length} day(s) of bank interest
            </p>
            <Button
              onClick={() => claimInterest()}
              disabled={isTransacting}
              loading={l4}
              className="w-full"
              animation="pulse"
            >
              <Gift className="mr-2 h-5 w-5" />
              Claim Interest
            </Button>
          </div>
        </ContentBox>
      )}
      <ContentBox
        title="Transfer"
        subtitle="Bank to Bank Transfers"
        initialBreak={true}
        padding={false}
      >
        <div className="w-full px-4 py-4">
          <UserSearchSelect
            useFormMethods={userSearchMethods}
            label="Search for receiver"
            showYourself={false}
            inline={true}
            showAi={false}
            maxUsers={maxUsers}
          />
          <AmountForm
            form={toUserForm}
            onSubmit={onTransfer}
            disabled={isTransacting}
            pending={l3}
            id="amount-to-user"
            placeholder="Amount to transfer"
            max={bank}
            label="Send"
            showLabel={true}
            icon={<Send className="h-5 w-5" />}
            className="mt-2"
          />
        </div>
        <Modal
          id="bank-transfer-confirm"
          title="Confirm transfer"
          isOpen={!!pendingTransfer}
          setIsOpen={(open) => {
            if (!open) setPendingTransfer(null);
          }}
          proceed_label="Send ryo"
          proceed_loading_label="Sending..."
          isLoading={l3}
          keepOpenOnAccept={true}
          onAccept={() => {
            if (pendingTransfer) {
              transfer({
                targetId: pendingTransfer.targetId,
                amount: pendingTransfer.amount,
              });
            }
          }}
        >
          {pendingTransfer && (
            <p>
              Send <b>{pendingTransfer.amount.toLocaleString()} ryo</b> from your bank
              to <b>{pendingTransfer.username}</b>? Transfers cannot be undone.
            </p>
          )}
        </Modal>
      </ContentBox>
      <ContentBox
        title="Bank Ledger"
        subtitle="Search historical transactions"
        initialBreak={true}
        padding={false}
        topRightContent={
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" aria-label="Open transfer graph">
                <Waypoints className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent className="min-h-[99%] min-w-[99%]">
              <DialogHeader>
                <DialogTitle>Bank Ledger</DialogTitle>
                <DialogDescription asChild>
                  <GraphBankLedger />
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="flex w-full flex-col gap-2 px-2 py-2">
          <UserSearchSelect
            useFormMethods={userSearchMethodsFrom}
            label="Search sender"
            showYourself={true}
            inline={true}
            showAi={false}
            maxUsers={maxUsers}
          />
          <UserSearchSelect
            useFormMethods={userSearchMethodsTo}
            label="Search receiver"
            showYourself={true}
            inline={true}
            showAi={false}
            maxUsers={maxUsers}
          />
        </div>
        <Table data={allTransfers} columns={columns} setLastElement={setLastElement} />
        <p className="p-2 text-xs italic">
          Note: All transactions in Seichi are on a public blockchain ledger. This means
          that all transactions are public and can be viewed by anyone.{" "}
        </p>
      </ContentBox>
    </>
  );
}

/**
 * Numeric amount field with its submit button attached on the same row; starts blank.
 * In narrow columns the button shows only its icon below `sm`, keeping its text as the
 * accessible name, unless `showLabel` keeps the text visible at every width.
 */
const AmountForm = ({
  form,
  onSubmit,
  id,
  placeholder,
  max,
  label,
  icon,
  showLabel = false,
  className,
  disabled,
  pending,
}: {
  form: UseFormReturn<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  /** Blocks input while any bank transaction is pending. */
  disabled: boolean;
  /** Spins this form's button while its own transaction is pending. */
  pending: boolean;
  id: string;
  placeholder: string;
  max: number;
  label: string;
  icon: React.ReactNode;
  showLabel?: boolean;
  className?: string;
}) => (
  <Form {...form}>
    <form onSubmit={onSubmit} className={className} aria-busy={pending}>
      <fieldset disabled={disabled}>
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem className="flex w-full flex-col">
              <div className="flex w-full">
                <FormControl>
                  <NumberInput
                    id={id}
                    aria-label={placeholder}
                    placeholder={placeholder}
                    min={1}
                    max={max}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value as number | undefined}
                    onOptionalValueChange={field.onChange}
                    className="min-w-0 flex-1 rounded-r-none border-r-0"
                  />
                </FormControl>
                <Button
                  type="submit"
                  className={cn(
                    "shrink-0 rounded-l-none",
                    showLabel ? "px-3" : "px-2.5 sm:px-3",
                  )}
                  loading={pending}
                >
                  {icon}
                  <span
                    className={showLabel ? "ml-1" : "sr-only sm:not-sr-only sm:ml-1"}
                  >
                    {label}
                  </span>
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </fieldset>
    </form>
  </Form>
);
