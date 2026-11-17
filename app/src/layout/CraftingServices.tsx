"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Craft for Me</DialogTitle>
        </DialogHeader>
        {open && <ServiceRequestForm key={crafterId} crafterId={crafterId} />}
      </DialogContent>
    </Dialog>
  );
}

/** Incoming/outgoing service receipts remain accessible regardless of occupation. */
export function CraftingServices() {
  const { data: user } = useRequiredUserData();
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
    <ContentBox title="Service Requests" subtitle="Crafting services">
      <p className="text-muted-foreground mb-4 text-sm">
        Fees and items are held in escrow until completion. Pending requests can be
        cancelled or declined for an immediate full refund. Completed items arrive in
        inventory even when it is full.
      </p>
      {message && (
        <p role="status" className="mb-3">
          {message}
        </p>
      )}
      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">Incoming</TabsTrigger>
          <TabsTrigger value="outgoing">Outgoing</TabsTrigger>
          {user.occupation === "CRAFTING" && (
            <TabsTrigger value="prices">Service Prices</TabsTrigger>
          )}
        </TabsList>
        {["incoming", "outgoing"].map((direction) => (
          <TabsContent key={direction} value={direction}>
            {requests.isLoading ? (
              <Loader />
            ) : requests.isError ? (
              <p role="alert">
                Could not load requests.{" "}
                <Button onClick={() => void requests.refetch()}>Retry</Button>
              </p>
            ) : (
              <div className="space-y-3">
                {requests.data
                  ?.filter((row) =>
                    direction === "incoming"
                      ? row.crafterId === user.userId
                      : row.requesterId === user.userId,
                  )
                  .map((row) => (
                    <div key={row.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <strong>
                          {SERVICE_LABELS[row.service]}: {row.itemName}
                        </strong>
                        <span>{row.fee.toLocaleString()} ryo</span>
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
                        )}{" "}
                        · {row.status.toLowerCase()}
                      </p>
                      {row.crystal && (
                        <p className="text-sm">
                          Crystal: {row.crystal.name}
                          {row.service === "DISIMBUE" ? " (returned to requester)" : ""}
                        </p>
                      )}
                      {row.materials.length > 0 && (
                        <details className="mt-2 text-sm">
                          <summary>Reserved materials</summary>
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
                              onFinish={() => void requests.refetch()}
                            />
                          </p>
                        )}
                      {row.status === "PENDING" && (
                        <div className="mt-2 flex flex-wrap gap-2">
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
                                respond.mutate({ requestId: row.id, action: "CANCEL" })
                              }
                            >
                              Cancel &amp; refund
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                {!requests.data?.some((row) =>
                  direction === "incoming"
                    ? row.crafterId === user.userId
                    : row.requesterId === user.userId,
                ) && (
                  <p className="text-muted-foreground py-4">
                    No {direction} service requests.
                  </p>
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
  const crystal = inventory.data?.find((row) => row.id === crystalId);
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
    <div className="space-y-4">
      <p>
        {offers.data.crafter.username} · {offers.data.crafter.rank.toLowerCase()}
      </p>
      <div className="flex flex-wrap gap-2">
        {CRAFTING_SERVICES.map((value) => (
          <Button
            key={value}
            variant={service === value ? "default" : "outline"}
            disabled={submit.isPending}
            onClick={() => {
              setService(value);
              setItemId("");
              setCrystalId("");
              setImbuementId("");
              setMessage("");
              setSubmitted(false);
            }}
          >
            {SERVICE_LABELS[value]}
          </Button>
        ))}
      </div>
      <SearchSelect
        label={service === "CRAFT" ? "Recipe" : "Your item"}
        value={itemId}
        options={options}
        placeholder={
          service === "CRAFT" ? "Search the recipe book" : "Select your item"
        }
        disabled={submit.isPending || submitted}
        onChange={(value) => {
          setItemId(value);
          setImbuementId("");
        }}
      />
      {service === "IMBUE" && (
        <SearchSelect
          label="Crystal"
          value={crystalId}
          options={(inventory.data ?? [])
            .filter(
              (row) =>
                row.item.itemType === "CRYSTAL" &&
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
      )}
      {service === "DISIMBUE" && (
        <SearchSelect
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
      )}
      {service === "CRAFT" && selectedRecipe && (
        <div className="rounded border p-3">
          <strong>
            Materials for {selectedRecipe.craftingOutputQuantity} ×{" "}
            {selectedRecipe.name}
          </strong>
          <ul className="mt-2 list-inside list-disc text-sm">
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
      {info && (
        <p className="font-medium">
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
      {message && (
        <div>
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
      <Button
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
        <Link className="ml-3 underline" href="/occupation?tab=services">
          View Service Requests
        </Link>
      )}
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
    <div data-service-prices className="space-y-4 pt-3">
      <p className="text-muted-foreground text-sm">
        Set a fixed fee per service and rarity. A disabled or unset price is
        unavailable. Craft fees cover one recipe batch; repair fees cover one item.
      </p>
      <SearchSelect
        label="Service"
        value={service}
        options={CRAFTING_SERVICES.map((value) => ({
          value,
          label: SERVICE_LABELS[value],
        }))}
        placeholder="Select service"
        disabled={save.isPending}
        onChange={(value) => {
          setService(value as typeof service);
          setDraft(undefined);
          setMessage("");
        }}
      />
      <SearchSelect
        label="Rarity"
        value={rarity}
        options={ItemRarities.map((value) => ({ value, label: value }))}
        placeholder="Select rarity"
        disabled={save.isPending}
        onChange={(value) => {
          setRarity(value as typeof rarity);
          setDraft(undefined);
          setMessage("");
        }}
      />
      <div>
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
      <Label className="flex items-center gap-2">
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
            validateNumberInputs(event.currentTarget.closest("[data-service-prices]"))
          )
            save.mutate({ service, rarity, fee: Number(fee), enabled });
        }}
      >
        Save price
      </Button>
      {message && <p role="status">{message}</p>}
      <div className="space-y-1 text-sm">
        {prices.data?.prices.map((row) => (
          <p key={`${row.service}-${row.rarity}`}>
            {SERVICE_LABELS[row.service]} · {row.rarity}: {row.fee.toLocaleString()} ryo
            · {row.enabled ? "enabled" : "disabled"}
          </p>
        ))}
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
