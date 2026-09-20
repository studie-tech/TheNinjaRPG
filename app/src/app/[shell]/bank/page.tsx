"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  Coins,
  Gift,
  Landmark,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
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
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { IMG_BUILDING_BANK } from "@/drizzle/constants";
import BanInfo from "@/layout/BanInfo";
import ContentBox from "@/layout/ContentBox";
import GraphBankLedger from "@/layout/GraphBankLedger";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { calcBankInterest, getStrucBoost } from "@/utils/village";
import {
  createMoneyTransferSchema,
  type MoneyTransferSchema,
  type MoneyTransferSchemaInput,
} from "@/validators/bank";
import { getSearchValidator } from "@/validators/register";

export default function Bank() {
  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // User data
  const { userData, updateUser, access } = useRequireInVillage("/bank");
  const money = userData?.money ?? 0;
  const bank = userData?.bank ?? 0;

  // Current interest
  const boost = getStrucBoost("bankInterestPerLvl", userData?.village?.structures);
  const interest = calcBankInterest(boost, userData);

  // Pending interest query
  const { data: pendingInterest, refetch: refetchPendingInterest } =
    api.bank.getPendingInterest.useQuery(undefined, {
      enabled: !!userData,
    });

  // Schemas
  const fromPocketSchema = createMoneyTransferSchema(money);
  const fromBankSchema = createMoneyTransferSchema(bank);

  // Forms
  const toBankForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: 0 },
    resolver: zodResolver(fromPocketSchema),
  });
  const toPocketForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: 0 },
    resolver: zodResolver(fromBankSchema),
  });
  const toUserForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: 0 },
    resolver: zodResolver(fromBankSchema),
  });

  // Mutations
  const { mutate: toBank, isPending: l1 } = api.bank.toBank.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser({
          bank: data.data.bank,
          money: data.data.money,
        });
        toBankForm.reset();
      }
    },
  });

  const { mutate: toPocket, isPending: l2 } = api.bank.toPocket.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser({
          bank: data.data.bank,
          money: data.data.money,
        });
        toPocketForm.reset();
      }
    },
  });

  const { mutate: transfer, isPending: l3 } = api.bank.transfer.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser({
          bank: data.data.bank,
        });
        toUserForm.reset();
      }
    },
  });

  const { mutate: claimInterest, isPending: l4 } = api.bank.claimInterest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser({
          bank: data.data.bank,
        });
        await refetchPendingInterest();
      }
    },
  });

  // User search
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // User search for ledger sender
  const userSearchSchemaFrom = getSearchValidator({ max: maxUsers });
  const userSearchMethodsFrom = useForm<z.infer<typeof userSearchSchemaFrom>>({
    resolver: zodResolver(userSearchSchemaFrom),
    defaultValues: { username: "", users: [] },
  });
  const targetUserFrom = useWatch({
    control: userSearchMethodsFrom.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // User search for ledger receiver
  const userSearchSchemaTo = getSearchValidator({ max: maxUsers });
  const userSearchMethodsTo = useForm<z.infer<typeof userSearchSchemaTo>>({
    resolver: zodResolver(userSearchSchemaTo),
    defaultValues: { username: "", users: [] },
  });
  const targetUserTo = useWatch({
    control: userSearchMethodsTo.control,
    name: "users",
    defaultValue: [],
  })?.[0];

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
    { key: "type", header: "Type", type: "string" },
    { key: "amountFormatted", header: "Amount", type: "string" },
    { key: "createdAt", header: "Date", type: "date" },
  ];

  // Submit handlers
  const onDeposit = toBankForm.handleSubmit((data) => toBank(data));
  const onWithdraw = toPocketForm.handleSubmit((data) => toPocket(data));
  const onTransfer = toUserForm.handleSubmit((data) => {
    if (targetUser) {
      transfer({ targetId: targetUser.userId, amount: data.amount });
    } else {
      showMutationToast({ success: false, message: "No receiver selected" });
    }
  });

  // Loading screens
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Bank" />;
  if (userData.isBanned) return <BanInfo />;
  if (l1 || l2 || l3 || l4) return <Loader explanation="Processing bank transaction" />;

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
              <Form {...toBankForm}>
                <form onSubmit={onDeposit} className="relative">
                  <FormField
                    control={toBankForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className="flex w-full flex-col">
                        <FormControl>
                          <Input
                            id="amount"
                            placeholder="Transfer to bank"
                            {...field}
                            value={field.value as number}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button className="absolute top-0 right-0" type="submit">
                    <ChevronsRight className="h-5 w-5" />
                  </Button>
                </form>
              </Form>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <Landmark className="h-20 w-20" />
            <p className="text-lg">{bank.toLocaleString()} ryo</p>
            <h2 className="font-bold text-xl">Money in bank</h2>
            <div className="w-full px-4 pt-3">
              <Form {...toPocketForm}>
                <form onSubmit={onWithdraw} className="relative">
                  <FormField
                    control={toPocketForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className="flex w-full flex-col">
                        <FormControl>
                          <Input
                            id="amount"
                            placeholder="Transfer to pocket"
                            {...field}
                            value={field.value as number}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button className="absolute top-0 right-0" type="submit">
                    <ChevronsLeft className="h-5 w-5" />
                  </Button>
                </form>
              </Form>
            </div>
          </div>
        </div>
      </ContentBox>
      {pendingInterest && pendingInterest.totalPending > 0 && (
        <ContentBox
          title="Pending Interest"
          subtitle={`Interest older than 7-8 days are discarded!`}
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
            selectedUsers={[]}
            showYourself={false}
            inline={true}
            showAi={false}
            maxUsers={maxUsers}
          />
          <Form {...toUserForm}>
            <form onSubmit={onTransfer} className="relative mt-2 mr-1 px-1">
              <FormField
                control={toUserForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="flex w-full flex-col">
                    <FormControl>
                      <Input
                        id="amount"
                        placeholder="Amount to transfer"
                        {...field}
                        value={field.value as number}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className="absolute top-0 right-0" type="submit">
                <ChevronsUp className="h-5 w-5" />
              </Button>
            </form>
          </Form>
        </div>
      </ContentBox>
      <ContentBox
        title="Bank Ledger"
        subtitle="Search historical transactions"
        initialBreak={true}
        padding={false}
        topRightContent={
          <Dialog>
            <DialogTrigger asChild>
              <Button type="submit">
                <Waypoints className="h-5 w-5" />
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
            selectedUsers={[]}
            showYourself={true}
            inline={true}
            showAi={false}
            maxUsers={maxUsers}
          />
          <UserSearchSelect
            useFormMethods={userSearchMethodsTo}
            label="Search receiver"
            selectedUsers={[]}
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
