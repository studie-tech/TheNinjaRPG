"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type RefObject, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import {
  STORE_BUNDLE_MAX_ITEMS,
  STORE_BUNDLE_MAX_PRICE_CENTS,
  STORE_BUNDLE_MAX_PURCHASE_LIMIT,
  STORE_BUNDLE_MAX_QUANTITY,
  STORE_BUNDLE_MAX_RYO,
  STORE_BUNDLE_MIN_PRICE_CENTS,
  WEB_REP_MAX,
} from "@/drizzle/constants";
import BanInfo from "@/layout/BanInfo";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { SearchSelect } from "@/layout/SearchSelect";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getStoreBundleMinimumPriceCents } from "@/utils/paypal";
import { canManageStore } from "@/utils/permissions";
import { useRecipientPicker } from "@/utils/search";
import { useRequiredUserData } from "@/utils/UserContext";
import { type StoreBundleInput, storeBundleSchemaForItems } from "@/validators/points";
import { StoreCheckout } from "./StoreCheckout";

/** Show per-buyer availability and staff editing through the shared validated bundle catalog. */
export function StoreBundles() {
  const { data: user } = useRequiredUserData();
  const canManage = canManageStore(user?.role);
  const query = api.paypal.getStoreBundles.useQuery({ includeInactive: canManage });
  const [selected, setSelected] = useState<string>();
  const [isCheckoutPending, setIsCheckoutPending] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; data: StoreBundleInput }>();
  const [message, setMessage] = useState<string>();
  const returnFocusRef = useRef<HTMLElement>(null);
  const selectedBundleRef = useRef<HTMLDivElement>(null);
  const { methods, users } = useRecipientPicker(user);
  const save = api.paypal.saveStoreBundle.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success) {
        setEditing(undefined);
        await query.refetch();
      }
    },
    onError: (error) => setMessage(error.message),
  });
  const offer = query.data?.bundles.find(
    (bundle) => bundle.id === selected && bundle.isActive,
  );
  if (user?.isBanned) return <BanInfo />;
  if (query.isPending) return <Loader explanation="Loading store bundles" />;
  if (query.isError)
    return (
      <p role="alert">
        Could not load bundles.{" "}
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Browse reputation packs and bundles with guaranteed in-game contents.
        </p>
        {canManage && (
          <Button
            onClick={(event) => {
              returnFocusRef.current = event.currentTarget;
              setMessage(undefined);
              setEditing({
                data: {
                  name: "",
                  description: "",
                  priceCents: STORE_BUNDLE_MIN_PRICE_CENTS,
                  isActive: false,
                  purchaseLimit: 0,
                  contents: { reputationPoints: 0, money: 0, items: [] },
                },
              });
            }}
          >
            Create bundle
          </Button>
        )}
      </div>
      {message && !editing && (
        <p role="status" className="rounded border p-3">
          {message}
        </p>
      )}
      {canManage && editing && (
        <StoreBundleEditor
          draft={editing.data}
          isEditing={!!editing.id}
          items={query.data?.items ?? []}
          isPending={save.isPending}
          message={message}
          returnFocusRef={returnFocusRef}
          onSave={(data) => {
            setMessage(undefined);
            save.mutate({ id: editing.id, data });
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
      {!query.data?.bundles.length && (
        <p className="rounded border border-dashed p-6 text-center text-muted-foreground">
          No bundles are available yet. You can still choose a custom amount in
          Reputation.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {query.data?.bundles.map((bundle) => (
          <Card
            key={bundle.id}
            ref={selected === bundle.id ? selectedBundleRef : undefined}
            tabIndex={-1}
            className={
              selected === bundle.id ? "border-primary ring-1 ring-primary" : ""
            }
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{bundle.name}</CardTitle>
                {!bundle.isActive && <Badge variant="secondary">Hidden</Badge>}
              </div>
              <CardDescription>{bundle.description}</CardDescription>
              {bundle.purchaseLimit > 0 && (
                <p className="text-sm">
                  Limit {bundle.purchaseLimit.toLocaleString()} per account ·{" "}
                  {bundle.purchaseCount.toLocaleString()} purchased
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {bundle.contents.reputationPoints > 0 && (
                  <li>
                    {bundle.contents.reputationPoints.toLocaleString()} reputation
                    points
                  </li>
                )}
                {bundle.contents.money > 0 && (
                  <li>{bundle.contents.money.toLocaleString()} ryo</li>
                )}
                {bundle.contents.items.map((reward) => (
                  <li key={reward.id}>
                    {reward.quantity} ×{" "}
                    {query.data?.items.find((item) => item.id === reward.id)?.name ??
                      "Unavailable item"}
                  </li>
                ))}
              </ul>
              <p className="font-bold text-2xl">
                ${(bundle.priceCents / 100).toFixed(2)}{" "}
                <span className="font-normal text-sm">USD</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    !bundle.isActive ||
                    (bundle.purchaseLimit > 0 &&
                      bundle.purchaseCount >= bundle.purchaseLimit)
                  }
                  variant={selected === bundle.id ? "default" : "outline"}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setSelected(bundle.id);
                  }}
                >
                  {bundle.purchaseLimit > 0 &&
                  bundle.purchaseCount >= bundle.purchaseLimit
                    ? "Purchase limit reached"
                    : selected === bundle.id
                      ? "Selected"
                      : "Select bundle"}
                </Button>
                {canManage && (
                  <Button
                    variant="outline"
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setMessage(undefined);
                      setEditing({
                        id: bundle.id,
                        data: {
                          name: bundle.name,
                          description: bundle.description,
                          priceCents: bundle.priceCents,
                          isActive: bundle.isActive,
                          purchaseLimit: bundle.purchaseLimit,
                          contents: bundle.contents,
                        },
                      });
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Modal
        title={offer ? `Purchase ${offer.name}` : "Purchase bundle"}
        isOpen={!!offer}
        isLoading={isCheckoutPending}
        setIsOpen={(open) => {
          if (!open) {
            // Delivery can disable the opener; keep focus on the purchased bundle.
            if (returnFocusRef.current?.matches(":disabled"))
              returnFocusRef.current = selectedBundleRef.current;
            setSelected(undefined);
          }
        }}
        returnFocusRef={returnFocusRef}
        bodyClassName="space-y-3 py-2"
      >
        {offer && (
          <>
            <p className="text-muted-foreground text-sm">
              All listed contents go to the selected player. Reputation counts toward
              your monthly allowance.
            </p>
            <UserSearchSelect
              useFormMethods={methods}
              showYourself
              showAi={false}
              inline
              maxUsers={1}
            />
            <p className="font-semibold">
              Total: ${(offer.priceCents / 100).toFixed(2)} USD
            </p>
            <StoreCheckout
              selection={{ type: "bundle", bundleId: offer.id }}
              recipientId={users[0]?.userId}
              onPendingChange={setIsCheckoutPending}
              disabled={
                offer.purchaseLimit > 0 && offer.purchaseCount >= offer.purchaseLimit
              }
            />
          </>
        )}
      </Modal>
    </div>
  );
}

/** Edit one offer in the shared modal, with field errors and focus returned to its trigger. */
function StoreBundleEditor({
  draft,
  isEditing,
  items,
  isPending,
  message,
  returnFocusRef,
  onSave,
  onClose,
}: {
  draft: StoreBundleInput;
  isEditing: boolean;
  items: { id: string; name: string; repsCost: number }[];
  isPending: boolean;
  message?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onSave: (data: StoreBundleInput) => void;
  onClose: () => void;
}) {
  const form = useForm<StoreBundleInput>({
    defaultValues: draft,
    resolver: zodResolver(storeBundleSchemaForItems(items)),
  });
  const rewards = useFieldArray({ control: form.control, name: "contents.items" });
  const contents = useWatch({ control: form.control, name: "contents" });
  const minimumCents = getStoreBundleMinimumPriceCents(contents, items);
  const minimumPrice = Number.isFinite(minimumCents) ? minimumCents / 100 : undefined;
  const options = items
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const errors = form.formState.errors;
  const contentsError = errors.contents?.message;
  const itemsError = errors.contents?.items?.root?.message;
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Modal
      title={isEditing ? "Edit bundle" : "Create bundle"}
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      isLoading={isPending}
      returnFocusRef={returnFocusRef}
      className="max-w-2xl"
      bodyClassName="space-y-3 py-2"
      footerClassName="flex-row flex-wrap"
      footerExtra={
        <>
          {(message || hasErrors) && (
            <p role="alert" className="w-full text-destructive text-sm">
              {message ??
                contentsError ??
                itemsError ??
                "Check the highlighted fields before saving."}
            </p>
          )}
          <Button type="submit" form="store-bundle-form" disabled={isPending}>
            {isPending ? "Saving…" : "Save bundle"}
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">
        {minimumPrice === undefined
          ? "Enter valid quantities to calculate the minimum USD price."
          : `Minimum $${minimumPrice.toFixed(2)} USD, based on reputation and rep-priced items.`}
      </p>
      <Form {...form}>
        <form
          id="store-bundle-form"
          onSubmit={form.handleSubmit(onSave)}
          className="space-y-3"
        >
          <fieldset disabled={isPending} className="space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bundle name</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="purchaseLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase limit per account</FormLabel>
                  <FormControl>
                    <NumberInput
                      {...field}
                      min={0}
                      max={STORE_BUNDLE_MAX_PURCHASE_LIMIT}
                      step={1}
                      onValueChange={field.onChange}
                      required
                    />
                  </FormControl>
                  <FormDescription>
                    0 means unlimited. 1 allows one lifetime purchase per buyer account,
                    including gifts.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={1000} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="priceCents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (USD)</FormLabel>
                    <FormControl>
                      <NumberInput
                        {...field}
                        min={STORE_BUNDLE_MIN_PRICE_CENTS / 100}
                        max={STORE_BUNDLE_MAX_PRICE_CENTS / 100}
                        step="0.01"
                        value={field.value / 100}
                        onValueChange={(value) =>
                          field.onChange(Math.round(value * 100))
                        }
                        required
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contents.reputationPoints"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reputation points</FormLabel>
                    <FormControl>
                      <NumberInput
                        {...field}
                        min={0}
                        max={WEB_REP_MAX}
                        step={1}
                        onValueChange={field.onChange}
                        required
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contents.money"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ryo</FormLabel>
                    <FormControl>
                      <NumberInput
                        {...field}
                        min={0}
                        max={STORE_BUNDLE_MAX_RYO}
                        step={1}
                        onValueChange={field.onChange}
                        required
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-sm">Items</p>
              {rewards.fields.map((reward, index) => (
                <div key={reward.id} className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`contents.items.${index}.id`}
                    render={({ field }) => (
                      <FormItem className="min-w-0 flex-1">
                        <FormControl>
                          <SearchSelect
                            ref={field.ref}
                            label={`Item ${index + 1}`}
                            value={field.value}
                            options={options}
                            placeholder="Choose an item"
                            onChange={field.onChange}
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`contents.items.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem className="w-16 shrink-0 sm:w-24">
                        <FormControl>
                          <NumberInput
                            {...field}
                            aria-label={`Item ${index + 1} quantity`}
                            min={1}
                            max={STORE_BUNDLE_MAX_QUANTITY}
                            step={1}
                            onValueChange={field.onChange}
                            required
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => rewards.remove(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {itemsError && (
                <p role="alert" className="text-destructive text-sm">
                  {itemsError}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={rewards.fields.length >= STORE_BUNDLE_MAX_ITEMS}
                onClick={() => rewards.append({ id: "", quantity: 1 })}
              >
                Add item
              </Button>
            </div>
            {contentsError && (
              <p role="alert" className="text-destructive text-sm">
                {contentsError}
              </p>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register("isActive")} />
              Published in store
            </label>
          </fieldset>
        </form>
      </Form>
    </Modal>
  );
}
