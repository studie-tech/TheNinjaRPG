"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Hammer,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  WAREHOUSE_DEPOSIT_COOLDOWN_HOURS,
  WAREHOUSE_HISTORY_PAGE_SIZE,
  WAREHOUSE_LOYALTY_BONUS,
  WAREHOUSE_LOYALTY_DAYS,
  WAREHOUSE_MAX_PRODUCTION_ITEMS,
  WAREHOUSE_MIN_DEPOSIT,
  WAREHOUSE_PRODUCTION_INTERVAL_HOURS,
  type WarehouseLogType,
} from "@/drizzle/constants";
import type { useCaravans } from "@/hooks/useCaravans";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useUserPicker } from "@/utils/search";

type WarehouseData = NonNullable<RouterOutputs["warehouse"]["getWarehouse"]>;
type CaravanActions = ReturnType<typeof useCaravans>;

/** Level, bonuses and the leader's construction and upgrade control. */
export const WarehouseOverview = ({
  data,
  actions,
  clanId,
}: {
  data: WarehouseData;
  actions: CaravanActions;
  clanId: string | null;
}) => {
  const { structure, village } = data;
  const built = !!structure && structure.level > 0;
  const funds = village.usesClanPoints ? "clan points" : "village tokens";
  return (
    <ContentBox
      title="Warehouse"
      subtitle={`${village.name} stores, produces and trades materials`}
      defaultBackHref="/village"
    >
      <div className="@container">
        <div className="grid gap-3 @lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-3">
            <Warehouse className="size-14 shrink-0 text-orange-500" aria-hidden />
            <div>
              <p className="text-lg font-bold">
                {built
                  ? `Level ${structure.level} / ${structure.maxLevel}`
                  : "Not constructed"}
              </p>
              {structure && structure.effectiveLevel !== structure.level && built && (
                <p className="text-muted-foreground text-sm">
                  Effective level {structure.effectiveLevel}
                </p>
              )}
              {structure?.raidBoosted && <Badge>Raid victory boost</Badge>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm @md:grid-cols-4">
            <Stat label="Production bonus" value={`+${data.productionBonus}%`} />
            <Stat label="Deposit bonus" value={`+${data.depositBonus}%`} />
            <Stat
              label={`Per item / ${WAREHOUSE_PRODUCTION_INTERVAL_HOURS}h`}
              value={data.cycleQuantity.toLocaleString()}
            />
            <Stat label="Village funds" value={village.tokens.toLocaleString()} />
          </dl>
        </div>
        {data.isLeader && structure && structure.nextCost !== null && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <p className="grow text-sm">
              {built
                ? `Next level costs ${structure.nextCost.toLocaleString()} ${funds} and adds 1% production and 2% deposit bonus.`
                : `Constructing the Warehouse costs ${structure.nextCost.toLocaleString()} ${funds}. Villages need it to store goods and send caravans.`}
            </p>
            {village.structureMaintenanceDue > 0 ? (
              <p className="text-destructive text-sm">
                Pay structure maintenance first
              </p>
            ) : (
              <Confirm
                title={built ? "Upgrade Warehouse" : "Construct Warehouse"}
                proceed_label={built ? "Upgrade" : "Construct"}
                onAccept={() =>
                  actions.build.mutate({
                    structureId: structure.id,
                    villageId: village.id,
                    clanId,
                  })
                }
                button={
                  <Button
                    disabled={actions.build.isPending}
                    loading={actions.build.isPending}
                  >
                    <Hammer className="mr-2 size-4" aria-hidden />
                    {built ? "Upgrade" : "Construct"}
                  </Button>
                }
              >
                This spends {structure.nextCost.toLocaleString()} {funds}.
              </Confirm>
            )}
          </div>
        )}
        {!built && !data.isLeader && (
          <p className="text-muted-foreground mt-3 text-sm">
            Your leader has not constructed the Warehouse yet.
          </p>
        )}
      </div>
    </ContentBox>
  );
};

/** Shared stock with withdrawal controls, the player's allowance and the deposit form. */
export const WarehouseStock = ({
  data,
  actions,
}: {
  data: WarehouseData;
  actions: CaravanActions;
}) => {
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const { allowance } = data;
  const stock = data.stock.filter((row) => row.quantity > 0);
  const busy = actions.withdraw.isPending || actions.deposit.isPending;
  return (
    <ContentBox
      title="Stock"
      subtitle={`You can withdraw ${allowance.remaining} of ${allowance.total} units today (UTC)`}
      initialBreak
    >
      <div className="@container">
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">
            {allowance.approved ? "Kage approved" : "Daily allowance"}: {allowance.base}
          </Badge>
          <Badge variant={allowance.loyaltyBonus ? "default" : "outline"}>
            Loyalty: +{allowance.loyaltyBonus || WAREHOUSE_LOYALTY_BONUS}
            {allowance.loyaltyBonus ? "" : ` after ${WAREHOUSE_LOYALTY_DAYS} days`}
          </Badge>
          <Badge variant="outline">Used today: {allowance.used}</Badge>
        </div>
        {stock.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The Warehouse is empty. Deposit materials or choose items to produce.
          </p>
        ) : (
          <ul className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3">
            {stock.map((row) => {
              const free = row.quantity - row.reserved;
              const amount =
                amounts[row.itemId] ?? Math.min(free, allowance.remaining, 10);
              const max = Math.min(free, allowance.remaining);
              return (
                <li
                  key={row.itemId}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <Image
                    src={row.image}
                    alt=""
                    width={80}
                    height={80}
                    className="size-10 rounded"
                  />
                  <div className="min-w-0 grow">
                    <p className="text-sm font-semibold">{row.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {free.toLocaleString()} free
                      {row.reserved > 0
                        ? ` · ${row.reserved.toLocaleString()} for caravans`
                        : ""}
                    </p>
                  </div>
                  <NumberInput
                    aria-label={`Units of ${row.name} to withdraw`}
                    className="w-16"
                    min={1}
                    max={Math.max(1, max)}
                    value={amount}
                    onValueChange={(value) =>
                      setAmounts((prev) => ({ ...prev, [row.itemId]: value }))
                    }
                    disabled={max < 1}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Withdraw ${row.name}`}
                    disabled={busy || max < 1 || !(amount >= 1 && amount <= max)}
                    onClick={() =>
                      actions.withdraw.mutate({ itemId: row.itemId, quantity: amount })
                    }
                  >
                    <ArrowUpFromLine className="size-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <DepositForm data={data} actions={actions} />
      </div>
    </ContentBox>
  );
};

/** Deposit a carried stack of at least the minimum size. */
const DepositForm = ({
  data,
  actions,
}: {
  data: WarehouseData;
  actions: CaravanActions;
}) => {
  const [stackId, setStackId] = useState<string>();
  const [quantity, setQuantity] = useState<number>(WAREHOUSE_MIN_DEPOSIT);
  const stack = data.depositCandidates.find((row) => row.userItemId === stackId);
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="font-semibold">Deposit</h3>
      <p className="text-muted-foreground mb-2 text-sm">
        Donate at least {WAREHOUSE_MIN_DEPOSIT} units; the Warehouse adds{" "}
        {data.depositBonus}% on top. Each item can be deposited once every{" "}
        {WAREHOUSE_DEPOSIT_COOLDOWN_HOURS} hours, and units you withdrew earn no bonus.
      </p>
      {data.depositCandidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Carry a stack of {WAREHOUSE_MIN_DEPOSIT} or more Warehouse goods to deposit
          them.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={stackId}
            onValueChange={(value) => {
              setStackId(value);
              const next = data.depositCandidates.find(
                (row) => row.userItemId === value,
              );
              if (next) setQuantity(next.quantity);
            }}
          >
            <SelectTrigger
              className="min-w-48 grow basis-48"
              aria-label="Stack to deposit"
            >
              <SelectValue placeholder="Choose a stack" />
            </SelectTrigger>
            <SelectContent>
              {data.depositCandidates.map((row) => (
                <SelectItem
                  key={row.userItemId}
                  value={row.userItemId}
                  disabled={!!row.availableAt}
                >
                  {row.name} ×{row.quantity}
                  {row.availableAt
                    ? ` · again at ${new Date(row.availableAt).toLocaleTimeString()}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NumberInput
            aria-label="Units to deposit"
            className="w-24"
            min={WAREHOUSE_MIN_DEPOSIT}
            max={stack?.quantity ?? WAREHOUSE_MIN_DEPOSIT}
            value={quantity}
            onValueChange={setQuantity}
            disabled={!stack}
          />
          <Button
            disabled={
              !stack ||
              actions.deposit.isPending ||
              !(quantity >= WAREHOUSE_MIN_DEPOSIT && quantity <= stack.quantity)
            }
            loading={actions.deposit.isPending}
            onClick={() =>
              stack &&
              actions.deposit.mutate({ userItemId: stack.userItemId, quantity })
            }
          >
            <ArrowDownToLine className="mr-2 size-4" aria-hidden />
            Deposit
          </Button>
        </div>
      )}
    </div>
  );
};

/** The items the Warehouse produces, chosen by the leader. */
export const WarehouseProduction = ({
  data,
  actions,
}: {
  data: WarehouseData;
  actions: CaravanActions;
}) => {
  const [draft, setDraft] = useState<string[]>();
  const selected = draft ?? data.production.map((row) => row.itemId);
  const changed = draft !== undefined;
  return (
    <ContentBox
      title="Production"
      subtitle={`Each item yields ${data.cycleQuantity} units every ${WAREHOUSE_PRODUCTION_INTERVAL_HOURS} hours · next at ${new Date(data.nextCycleAt).toLocaleTimeString()}`}
      initialBreak
    >
      {data.isLeader ? (
        data.producibleItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Warehouse items belong to your village yet.
          </p>
        ) : (
          <div className="@container">
            <p className="mb-2 text-sm">
              Choose up to {WAREHOUSE_MAX_PRODUCTION_ITEMS} items ({selected.length}{" "}
              chosen).
            </p>
            <ul className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3">
              {data.producibleItems.map((item) => {
                const isOn = selected.includes(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <Image
                      src={item.image}
                      alt=""
                      width={80}
                      height={80}
                      className="size-10 rounded"
                    />
                    <label htmlFor={`produce-${item.id}`} className="grow text-sm">
                      {item.name}
                    </label>
                    <Switch
                      id={`produce-${item.id}`}
                      checked={isOn}
                      disabled={
                        !isOn && selected.length >= WAREHOUSE_MAX_PRODUCTION_ITEMS
                      }
                      onCheckedChange={(on) =>
                        setDraft(
                          on
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              {changed && (
                <Button variant="outline" onClick={() => setDraft(undefined)}>
                  Reset
                </Button>
              )}
              <Button
                disabled={!changed || actions.setProduction.isPending}
                loading={actions.setProduction.isPending}
                onClick={() =>
                  actions.setProduction.mutate(
                    { itemIds: selected },
                    { onSuccess: (result) => result.success && setDraft(undefined) },
                  )
                }
              >
                Save production
              </Button>
            </div>
          </div>
        )
      ) : data.production.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your leader has not chosen production.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.production.map((row) => (
            <Badge key={row.itemId} variant="secondary">
              {row.name}
            </Badge>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

/** The leader's approvals for increased daily withdrawals. */
export const WarehouseAccess = ({
  data,
  actions,
}: {
  data: WarehouseData;
  actions: CaravanActions;
}) => {
  const { methods, user } = useUserPicker(1);
  const [wartime, setWartime] = useState(false);
  const atWar = data.activeWarIds.length > 0;
  return (
    <ContentBox
      title="Access"
      subtitle="Approved players withdraw up to 50 units a day"
      initialBreak
    >
      <div className="@container grid gap-4 @2xl:grid-cols-2">
        <div>
          <UserSearchSelect
            useFormMethods={methods}
            label="Approve a villager"
            showYourself={false}
            inline
            showAi={false}
            maxUsers={1}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Switch
                id="warehouse-wartime"
                checked={wartime}
                onCheckedChange={setWartime}
                disabled={!atWar}
              />
              <label htmlFor="warehouse-wartime">
                Wartime only {atWar ? "" : "(no active war)"}
              </label>
            </div>
            <Button
              className="ml-auto"
              disabled={!user || actions.setApproval.isPending}
              onClick={() =>
                user &&
                actions.setApproval.mutate(
                  { userId: user.userId, approve: true, wartime },
                  { onSuccess: (result) => result.success && methods.reset() },
                )
              }
            >
              <ShieldCheck className="mr-2 size-4" aria-hidden />
              Approve
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Elders can be approved during wartime only. Wartime approvals end with the
            war.
          </p>
        </div>
        <ul className="grid content-start gap-2">
          {data.approvals.length === 0 && (
            <li className="text-muted-foreground text-sm">Nobody is approved.</li>
          )}
          {data.approvals.map((row) => (
            <li
              key={row.userId}
              className="flex items-center gap-2 rounded-md border p-2"
            >
              <span className="grow text-sm font-semibold">{row.username}</span>
              {row.wartime && <Badge variant="outline">Wartime</Badge>}
              {!row.active && <Badge variant="destructive">Inactive</Badge>}
              <Button
                size="sm"
                variant="outline"
                disabled={actions.setApproval.isPending}
                onClick={() =>
                  actions.setApproval.mutate({ userId: row.userId, approve: false })
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </ContentBox>
  );
};

/** Paged movement history of the Warehouse. */
export const WarehouseHistory = () => {
  const history = api.warehouse.getHistory.useInfiniteQuery(
    { limit: WAREHOUSE_HISTORY_PAGE_SIZE },
    { getNextPageParam: (page) => page.nextCursor },
  );
  const rows = history.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <ContentBox
      title="History"
      subtitle="Deposits, withdrawals, production and shipments"
      initialBreak
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing has moved yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 py-1">
              <Badge variant="outline" className="w-24">
                {HISTORY_LABELS[row.type]}
              </Badge>
              <span className="grow">
                {row.quantity.toLocaleString()} {row.itemName ?? "items"}
                {row.username ? ` · ${row.username}` : ""}
              </span>
              <time
                className="text-muted-foreground text-xs"
                dateTime={new Date(row.createdAt).toISOString()}
              >
                {new Date(row.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          className="mt-2 w-full"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </ContentBox>
  );
};

/** One labelled figure. */
const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-2">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="font-semibold">{value}</dd>
  </div>
);

const HISTORY_LABELS: Record<WarehouseLogType, string> = {
  DEPOSIT: "Deposit",
  WITHDRAW: "Withdrawal",
  PRODUCTION: "Production",
  RESERVE: "Reserved",
  RELEASE: "Returned",
  DISPATCH: "Dispatched",
  DELIVERY: "Delivered",
};
