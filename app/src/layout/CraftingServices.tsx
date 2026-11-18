"use client";

import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CRAFTING_SERVICE_MAX_FEE,
  CRAFTING_SERVICES,
  ItemRarities,
} from "@/drizzle/constants";
import {
  useCraftingServiceCache,
  useCraftingServicePriceCache,
  useServiceRequests,
} from "@/hooks/useCraftingServices";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { SearchSelect } from "@/layout/SearchSelect";
import { getMissingCraftingRank } from "@/libs/crafting";
import {
  getServiceRepairDurability,
  isServiceEquipmentAvailable,
} from "@/libs/craftingServices";
import { needsInventoryRepair } from "@/libs/repair";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/** Public profile entry point, with requester-owned recipe/equipment selectors. */
export function CraftForMe({ crafterId }: { crafterId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Craft for Me</Button>
      </DialogTrigger>
      <DialogContent className="p-4 sm:p-6 md:max-w-xl">
        <DialogHeader>
          <DialogTitle>Craft for Me</DialogTitle>
          <DialogDescription>
            Choose a service and supply your items or materials.
          </DialogDescription>
        </DialogHeader>
        {open && <ServiceRequestForm key={crafterId} crafterId={crafterId} />}
      </DialogContent>
    </Dialog>
  );
}

/** Incoming/outgoing service receipts remain accessible regardless of occupation. */
export function CraftingServices({ navigation }: { navigation?: React.ReactNode }) {
  const { data: user, timeDiff } = useRequiredUserData();
  const requests = useServiceRequests();
  const { prepareServiceUpdate, updateService } = useCraftingServiceCache();
  const [message, setMessage] = useState("");
  const respond = api.occupation.respondToServiceRequest.useMutation({
    onMutate: prepareServiceUpdate,
    onSuccess: async (result, _input, snapshot) => {
      setMessage(result.message);
      showMutationToast(result);
      await updateService(result, snapshot);
    },
    onError: (error) => setMessage(error.message),
  });
  if (!user) return <Loader />;
  return (
    <ContentBox
      title="Service Requests"
      subtitle="Crafting services"
      topRightContent={navigation}
    >
      {message && (
        <p role="status" className="mb-3">
          {message}
        </p>
      )}
      <Tabs defaultValue="incoming">
        <TabsList className="mb-2">
          <TabsTrigger value="incoming">Incoming</TabsTrigger>
          <TabsTrigger value="outgoing">Outgoing</TabsTrigger>
          {user.occupation === "CRAFTING" && (
            <TabsTrigger value="prices">Service Prices</TabsTrigger>
          )}
        </TabsList>
        {["incoming", "outgoing"].map((direction) => (
          <TabsContent key={direction} value={direction}>
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              Pending requests can be cancelled or declined for a full refund. Completed
              items arrive automatically, even when your inventory is full.
            </p>
            {requests.isLoading ? (
              <Loader />
            ) : requests.isError ? (
              <p role="alert">
                Could not load requests.{" "}
                <Button onClick={() => void requests.refetch()}>Retry</Button>
              </p>
            ) : (
              <div className="space-y-3">
                {[false, true].map((isHistory) => {
                  const rows =
                    requests.data?.filter(
                      (row) =>
                        (direction === "incoming"
                          ? row.crafterId === user.userId
                          : row.requesterId === user.userId) &&
                        (row.status !== "PENDING" && row.status !== "ACTIVE") ===
                          isHistory,
                    ) ?? [];
                  if (!rows.length)
                    return !isHistory &&
                      requests.data?.some((row) =>
                        direction === "incoming"
                          ? row.crafterId === user.userId
                          : row.requesterId === user.userId,
                      ) ? (
                      <p key="empty" className="text-muted-foreground py-3 text-sm">
                        No open {direction} requests.
                      </p>
                    ) : null;
                  return (
                    <details
                      key={String(isHistory)}
                      open={isHistory ? undefined : true}
                      className="group"
                    >
                      <summary className="mb-3 cursor-pointer py-2 text-sm font-medium">
                        {isHistory ? "Request history" : "Open requests"} ({rows.length}
                        )
                      </summary>
                      <div className="space-y-3">
                        {rows.map((row) => (
                          <div
                            key={row.id}
                            className="min-w-0 space-y-3 rounded-lg border p-4"
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-muted-foreground text-xs">
                                  {SERVICE_LABELS[row.service]}
                                </p>
                                <p className="font-semibold break-words">
                                  {row.itemName}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className="font-medium tabular-nums">
                                  {row.fee.toLocaleString()} ryo
                                </span>
                                <Badge
                                  variant={
                                    row.status === "PENDING" || row.status === "ACTIVE"
                                      ? "secondary"
                                      : "outline"
                                  }
                                >
                                  {row.status === "PENDING"
                                    ? "Awaiting acceptance"
                                    : row.status === "ACTIVE"
                                      ? "In progress"
                                      : row.status === "COMPLETED"
                                        ? "Completed"
                                        : "Refunded"}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-muted-foreground text-sm">
                              {direction === "incoming" ? (
                                <>
                                  From{" "}
                                  <Link href={`/userid/${row.requesterId}`}>
                                    {row.requester?.username ?? "Player"}
                                  </Link>
                                </>
                              ) : (
                                <>
                                  Crafter:{" "}
                                  <Link href={`/userid/${row.crafterId}`}>
                                    {row.crafter?.username ?? "Player"}
                                  </Link>
                                </>
                              )}
                            </p>
                            {row.crystal && (
                              <p className="text-sm">
                                Crystal: {row.crystal.name}
                                {row.service === "DISIMBUE"
                                  ? " (returned to requester)"
                                  : ""}
                              </p>
                            )}
                            {row.materials.length > 0 && (
                              <details className="mt-2 text-sm">
                                <summary className="cursor-pointer py-1">
                                  Reserved materials
                                </summary>
                                <ul className="list-inside list-disc">
                                  {row.materials.map((material) => (
                                    <li key={material.userItemId}>
                                      {material.quantity} × {material.name}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {row.settlementError && (
                              <div role="alert" className="mt-2">
                                <p>{row.settlementError}</p>
                                <Button
                                  variant="outline"
                                  disabled={requests.isFetching}
                                  onClick={() => void requests.refetch()}
                                >
                                  Retry delivery
                                </Button>
                              </div>
                            )}
                            {row.status === "ACTIVE" &&
                              row.finishesAt &&
                              !row.settlementError && (
                                <p>
                                  Ready in{" "}
                                  <Countdown
                                    targetDate={row.finishesAt}
                                    timeDiff={timeDiff}
                                    onFinish={() => void requests.refetch()}
                                  />
                                </p>
                              )}
                            {row.status === "PENDING" && (
                              <div className="flex flex-wrap gap-2 border-t pt-3">
                                {direction === "incoming" ? (
                                  <>
                                    <Button
                                      disabled={respond.isPending}
                                      onClick={() =>
                                        respond.mutate({
                                          requestId: row.id,
                                          action: "ACCEPT",
                                        })
                                      }
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      variant="outline"
                                      disabled={respond.isPending}
                                      onClick={() =>
                                        respond.mutate({
                                          requestId: row.id,
                                          action: "DECLINE",
                                        })
                                      }
                                    >
                                      Decline &amp; refund
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="outline"
                                    disabled={respond.isPending}
                                    onClick={() =>
                                      respond.mutate({
                                        requestId: row.id,
                                        action: "CANCEL",
                                      })
                                    }
                                  >
                                    Cancel &amp; refund
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
                {!requests.data?.some((row) =>
                  direction === "incoming"
                    ? row.crafterId === user.userId
                    : row.requesterId === user.userId,
                ) && (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                    <p className="font-medium">No {direction} service requests</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {direction === "incoming"
                        ? "Requests from other players will appear here."
                        : "Visit a crafter’s profile and choose Craft for Me to get started."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        ))}
        {user.occupation === "CRAFTING" && (
          <TabsContent value="prices">
            <ServicePrices crafterId={user.userId} />
          </TabsContent>
        )}
      </Tabs>
    </ContentBox>
  );
}

function ServiceRequestForm({ crafterId }: { crafterId: string }) {
  useServiceRequests();
  const [service, setService] = useState<(typeof CRAFTING_SERVICES)[number]>("CRAFT");
  const [itemId, setItemId] = useState("");
  const [crystalId, setCrystalId] = useState("");
  const [imbuementId, setImbuementId] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const offers = api.occupation.getServicePrices.useQuery({ crafterId });
  const recipes = api.occupation.getCraftableItems.useQuery();
  const inventory = api.item.getUserItems.useQuery();
  const { prepareServiceUpdate, updateService } = useCraftingServiceCache();
  const submit = api.occupation.submitServiceRequest.useMutation({
    onMutate: prepareServiceUpdate,
    onSuccess: async (result, _input, snapshot) => {
      setMessage(result.message);
      setSubmitted(result.success);
      showMutationToast(result);
      await updateService(result, snapshot);
    },
    onError: (error) => setMessage(error.message),
  });
  const selectedRecipe = recipes.data?.find((row) => row.id === itemId);
  const target = inventory.data?.find((row) => row.id === itemId);
  const crystal = inventory.data?.find(
    (row) =>
      row.id === crystalId &&
      !target?.imbuements.some((installed) => installed.imbuementItemId === row.itemId),
  );
  const imbuement = target?.imbuements.find((row) => row.id === imbuementId);
  const info = service === "CRAFT" ? selectedRecipe : target?.item;
  const rarity =
    service === "IMBUE"
      ? crystal?.item.rarity
      : service === "DISIMBUE"
        ? imbuement?.item.rarity
        : info?.rarity;
  const price = offers.data?.prices.find(
    (row) => row.service === service && row.rarity === rarity && row.enabled,
  );
  const options =
    service === "CRAFT"
      ? (recipes.data ?? [])
          .filter(
            (row) =>
              !row.parentItemId &&
              row.craftingRequirements.length &&
              !getMissingCraftingRank(row, offers.data?.crafter.rank ?? "NOVICE"),
          )
          .map((row) => ({ value: row.id, label: `${row.name} (${row.rarity})` }))
      : (inventory.data ?? [])
          .filter(
            (row) =>
              isServiceEquipmentAvailable(row) &&
              (service === "REPAIR"
                ? needsInventoryRepair(row)
                : service === "DISIMBUE"
                  ? row.imbuements.length > 0
                  : row.item.canBeImbued),
          )
          .map((row) => ({
            value: row.id,
            label: `${row.item.name} (${row.item.rarity}, ${row.durability}/${row.item.maxDurability} durability)`,
          }));
  if (offers.isLoading || inventory.isLoading || recipes.isLoading) return <Loader />;
  if (offers.isError || inventory.isError || recipes.isError)
    return (
      <p role="alert">
        Could not load crafting services. Close this dialog and try again.
      </p>
    );
  if (offers.data?.crafter.occupation !== "CRAFTING")
    return <p>This player does not offer crafting services.</p>;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <span className="font-medium">{offers.data.crafter.username}</span>
        <Badge variant="outline" className="capitalize">
          {offers.data.crafter.rank.toLowerCase()} crafter
        </Badge>
      </div>
      <fieldset
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="Crafting service"
      >
        {CRAFTING_SERVICES.map((value) => (
          <Button
            key={value}
            variant={service === value ? "default" : "outline"}
            aria-pressed={service === value}
            disabled={submit.isPending}
            onClick={() => {
              if (value === service) return;
              setService(value);
              setItemId("");
              setCrystalId("");
              setImbuementId("");
              setMessage("");
              setSubmitted(false);
            }}
          >
            {SERVICE_SHORT_LABELS[value]}
          </Button>
        ))}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="service-item">
          {service === "CRAFT" ? "Recipe" : "Your item"}
        </Label>
        <SearchSelect
          id="service-item"
          label={service === "CRAFT" ? "Recipe" : "Your item"}
          value={itemId}
          options={options}
          emptyText={
            service === "CRAFT"
              ? "No eligible recipes found."
              : "No available items for this service."
          }
          placeholder={
            service === "CRAFT" ? "Search the recipe book" : "Select your item"
          }
          disabled={submit.isPending || submitted}
          onChange={(value) => {
            setItemId(value);
            setImbuementId("");
            const nextTarget = inventory.data?.find((row) => row.id === value);
            if (
              nextTarget?.imbuements.some(
                (installed) => installed.imbuementItemId === crystal?.itemId,
              )
            )
              setCrystalId("");
          }}
        />
      </div>
      {service === "IMBUE" && (
        <div className="space-y-2">
          <Label htmlFor="service-crystal">Crystal</Label>
          <SearchSelect
            id="service-crystal"
            label="Crystal"
            value={crystalId}
            options={(inventory.data ?? [])
              .filter(
                (row) =>
                  row.item.itemType === "CRYSTAL" &&
                  !target?.imbuements.some(
                    (installed) => installed.imbuementItemId === row.itemId,
                  ) &&
                  row.quantity > 0 &&
                  !row.isInAuction &&
                  !row.storedAtHome &&
                  (!row.craftingFinishedAt || row.craftingFinishedAt <= new Date()),
              )
              .map((row) => ({
                value: row.id,
                label: `${row.item.name} (${row.item.rarity})`,
              }))}
            placeholder="Select your crystal"
            disabled={submit.isPending || submitted}
            onChange={setCrystalId}
          />
        </div>
      )}
      {service === "DISIMBUE" && (
        <div className="space-y-2">
          <Label htmlFor="service-imbuement">Imbuement to remove</Label>
          <SearchSelect
            id="service-imbuement"
            label="Imbuement"
            value={imbuementId}
            options={(target?.imbuements ?? []).map((row) => ({
              value: row.id,
              label: row.item.name,
            }))}
            placeholder="Select the crystal to return"
            disabled={submit.isPending || submitted}
            onChange={setImbuementId}
          />
        </div>
      )}
      {service === "CRAFT" && selectedRecipe && (
        <div className="rounded-lg border p-3 break-words">
          <strong>
            Materials for {selectedRecipe.craftingOutputQuantity} ×{" "}
            {selectedRecipe.name}
          </strong>
          <ul className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {selectedRecipe.craftingRequirements.map((req) => (
              <li key={req.id}>
                {req.quantity} × {req.requirementItem.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {service === "REPAIR" && target && (
        <p>
          Instant repair to{" "}
          {getServiceRepairDurability(
            target.item.maxDurability,
            offers.data.crafter.rank,
          )}{" "}
          durability ({target.item.maxDurability} normal maximum).
        </p>
      )}
      <div className="bg-muted/40 space-y-3 rounded-lg p-3">
        {info && rarity && (
          <p className="font-semibold">
            {price
              ? `Service fee: ${price.fee.toLocaleString()} ryo`
              : "The crafter has not enabled a price for this service and rarity."}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          {service === "REPAIR"
            ? "Repair completes instantly. The crafter receives your fee and a notification."
            : "Your fee and submitted items are reserved immediately. The crafter must accept before work starts. Delivery is automatic, with inventory overflow when full."}
        </p>
      </div>
      {message && (
        <div className="space-y-2 rounded-lg border p-3">
          <p role="status">{message}</p>
          {!submitted && (
            <Button
              variant="outline"
              onClick={async () => {
                await offers.refetch();
                setMessage("");
              }}
            >
              Refresh offer
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          className="sm:ml-auto"
          disabled={
            !price ||
            !info ||
            submit.isPending ||
            submitted ||
            (service === "DISIMBUE" && !imbuementId)
          }
          onClick={() =>
            submit.mutate({
              crafterId,
              service,
              expectedFee: price?.fee ?? 0,
              ...(service === "CRAFT" ? { itemId } : { userItemId: itemId }),
              ...(service === "IMBUE" ? { userCrystalItemId: crystalId } : {}),
              ...(service === "DISIMBUE" ? { imbuementId } : {}),
            })
          }
        >
          {submit.isPending
            ? "Submitting…"
            : submitted
              ? "Submitted"
              : service === "REPAIR"
                ? "Repair now"
                : "Submit request"}
        </Button>
        {submitted && (
          <Link
            className="text-center text-sm underline"
            href="/occupation?tab=services"
          >
            View Service Requests
          </Link>
        )}
      </div>
    </div>
  );
}

function ServicePrices({ crafterId }: { crafterId: string }) {
  const [service, setService] = useState<(typeof CRAFTING_SERVICES)[number]>("CRAFT");
  const [rarity, setRarity] = useState<(typeof ItemRarities)[number]>("COMMON");
  const [draft, setDraft] = useState<{ fee: string; enabled: boolean }>();
  const [message, setMessage] = useState("");
  const prices = api.occupation.getServicePrices.useQuery({ crafterId });
  const cache = useCraftingServicePriceCache(crafterId);
  const save = api.occupation.setServicePrice.useMutation({
    onMutate: cache.prepareUpdate,
    onSuccess: async (result, _input, snapshot) => {
      setMessage(result.message);
      showMutationToast(result);
      if (result.success) await cache.updateCache(undefined, snapshot);
    },
    onError: (error) => setMessage(error.message),
  });
  const currentPrice = prices.data?.prices.find(
    (row) => row.service === service && row.rarity === rarity,
  );
  const fee = draft?.fee ?? String(currentPrice?.fee ?? 0);
  const enabled = draft?.enabled ?? currentPrice?.enabled ?? true;
  if (prices.isPending) return <Loader explanation="Loading service prices" />;
  if (prices.isError)
    return (
      <div role="alert">
        <p>Could not load service prices.</p>
        <Button disabled={prices.isFetching} onClick={() => void prices.refetch()}>
          Retry prices
        </Button>
      </div>
    );
  return (
    <div data-service-prices className="space-y-5 pt-2">
      <p className="text-muted-foreground text-sm">
        Set a fixed fee per service and rarity. A disabled or unset price is
        unavailable. Craft fees cover one recipe batch; repair fees cover one item.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-semibold">Set a service price</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="price-service">Service</Label>
              <SearchSelect
                id="price-service"
                label="Service"
                value={service}
                options={CRAFTING_SERVICES.map((value) => ({
                  value,
                  label: SERVICE_LABELS[value],
                }))}
                placeholder="Select service"
                disabled={save.isPending}
                onChange={(value) => {
                  if (value === service) return;
                  setService(value as typeof service);
                  setDraft(undefined);
                  setMessage("");
                }}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="price-rarity">Rarity</Label>
              <SearchSelect
                id="price-rarity"
                label="Rarity"
                value={rarity}
                options={ItemRarities.map((value) => ({ value, label: value }))}
                placeholder="Select rarity"
                disabled={save.isPending}
                onChange={(value) => {
                  if (value === rarity) return;
                  setRarity(value as typeof rarity);
                  setDraft(undefined);
                  setMessage("");
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-fee">Fee in ryo</Label>
            <NumberInput
              id="service-fee"
              min={0}
              max={CRAFTING_SERVICE_MAX_FEE}
              step={1}
              value={fee}
              disabled={save.isPending}
              onTextChange={(fee) => setDraft({ fee, enabled })}
            />
          </div>
          <Label className="bg-muted/40 flex min-h-11 cursor-pointer items-center gap-3 rounded-md p-3">
            <input
              type="checkbox"
              checked={enabled}
              disabled={save.isPending}
              onChange={(event) => setDraft({ fee, enabled: event.target.checked })}
            />
            Offer this service
          </Label>
          <Button
            disabled={
              save.isPending ||
              !fee ||
              !Number.isSafeInteger(Number(fee)) ||
              Number(fee) < 0 ||
              Number(fee) > CRAFTING_SERVICE_MAX_FEE
            }
            onClick={(event) => {
              if (
                validateNumberInputs(
                  event.currentTarget.closest("[data-service-prices]"),
                )
              )
                save.mutate({ service, rarity, fee: Number(fee), enabled });
            }}
          >
            Save price
          </Button>
          {message && <p role="status">{message}</p>}
        </div>
        <div className="min-w-0">
          <h3 className="mb-3 font-semibold">Your price list</h3>
          {prices.data?.prices.length ? (
            <ul className="divide-y rounded-lg border">
              {prices.data.prices.map((row) => (
                <li key={`${row.service}-${row.rarity}`}>
                  <button
                    type="button"
                    className="hover:bg-muted/40 flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left text-sm disabled:opacity-50"
                    disabled={save.isPending}
                    aria-label={`Edit ${SERVICE_LABELS[row.service]} ${row.rarity} price`}
                    onClick={() => {
                      if (row.service === service && row.rarity === rarity) return;
                      setService(row.service);
                      setRarity(row.rarity);
                      setDraft(undefined);
                      setMessage("");
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {SERVICE_SHORT_LABELS[row.service]} · {row.rarity}
                      </span>
                      <span className="text-muted-foreground">
                        {row.enabled ? "Available" : "Disabled"}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {row.fee.toLocaleString()} ryo{" "}
                      <span className="text-muted-foreground ml-2">Edit</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              No prices set. Save a price to offer your first service.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const SERVICE_LABELS = {
  CRAFT: "Craft an Item",
  IMBUE: "Imbue an Item",
  DISIMBUE: "Disimbue an Item",
  REPAIR: "Repair my Items",
} as const;

const SERVICE_SHORT_LABELS = {
  CRAFT: "Craft",
  IMBUE: "Imbue",
  DISIMBUE: "Disimbue",
  REPAIR: "Repair",
} as const;
