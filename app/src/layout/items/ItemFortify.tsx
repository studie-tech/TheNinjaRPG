"use client";

import { Hammer } from "lucide-react";
import { useState } from "react";
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
import { FORTIFY_FAILURE_BONUS, FORTIFY_MAX_LEVEL } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useFortify } from "@/hooks/useFortify";
import { SearchSelect } from "@/layout/SearchSelect";
import { fortifyTags, getFortifyQuote } from "@/libs/fortify";

/** Fortify a carried, equipped or stored single copy with an explicit per-attempt quote. */
export function ItemFortify({
  owned,
  crafter,
  money,
  blocked,
}: {
  owned: UserItemWithRelations;
  crafter: boolean;
  money: number;
  blocked: boolean;
}) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const mutation = useFortify(setMessage);
  const eligibility = api.item.getFortifyEligibility.useQuery(undefined, {
    enabled: owned.item.canBeEnhanced,
  });
  const tags = fortifyTags(owned.item);
  const tag = tags.find((tag) => tag.fortifyId === selected) ?? tags[0];
  const quote = tag ? getFortifyQuote(owned.fortification, tag, crafter) : undefined;
  const reason = eligibility.isError
    ? "Could not check evolution eligibility. Retry below."
    : eligibility.isPending
      ? "Checking evolution eligibility…"
      : eligibility.data.includes(owned.itemId)
        ? "Only the final evolution can be fortified, including hidden evolutions."
        : owned.quantity !== 1
          ? "Split the stack to a single item before fortifying."
          : blocked ||
              owned.isInAuction ||
              (owned.craftingFinishedAt && owned.craftingFinishedAt > new Date()) ||
              owned.imbuements.some((im) => im.craftingFinishedAt > new Date())
            ? "You must be awake, outside battle, with no auction or work in progress."
            : quote && quote.level >= FORTIFY_MAX_LEVEL
              ? `This tag is at Fortify +${FORTIFY_MAX_LEVEL}.`
              : quote && money < quote.cost
                ? "You do not have enough ryo."
                : undefined;
  if (!tags.length) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Hammer className="mr-2 h-5 w-5" />
          Fortify
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fortify {owned.item.name}</DialogTitle>
          <DialogDescription>
            Each base tag can reach +{FORTIFY_MAX_LEVEL} power. Imbuements cannot be
            fortified.
          </DialogDescription>
        </DialogHeader>
        <SearchSelect
          label="Tag to enhance"
          value={tag?.fortifyId ?? ""}
          disabled={mutation.isPending}
          placeholder="Select a tag"
          onChange={(value) => {
            setSelected(value);
            setMessage("");
          }}
          options={tags.map((tag, index) => ({
            value: tag.fortifyId!,
            label: `${index + 1}. ${tag.type} (+${getFortifyQuote(owned.fortification, tag, crafter).level})`,
          }))}
        />
        {tag && quote && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <p>{tag.description}</p>
            <p>
              Power: {tag.power + quote.level} →{" "}
              {tag.power + Math.min(FORTIFY_MAX_LEVEL, quote.level + 1)} (base{" "}
              {tag.power}, Fortify +{quote.level})
            </p>
            <p>
              Success chance: {quote.chance}%{crafter ? " (crafter rates)" : ""}
            </p>
            <p>
              Failure bonus: +{Math.min(100, quote.failures * FORTIFY_FAILURE_BONUS)}{" "}
              percentage points; resets on success.
            </p>
            <p>
              Attempt cost: {quote.cost.toLocaleString()} ryo. Failed attempts also
              consume the full cost.
            </p>
          </div>
        )}
        {reason && <p role="status">{reason}</p>}
        {eligibility.isError && (
          <Button variant="outline" onClick={() => void eligibility.refetch()}>
            Retry eligibility
          </Button>
        )}
        {message && (
          <p role="status" aria-live="polite">
            {message}
          </p>
        )}
        {mutation.needsRefresh && (
          <Button
            variant="outline"
            disabled={mutation.isRefreshing}
            onClick={() => void mutation.refresh()}
          >
            Refresh item and balance
          </Button>
        )}
        <Button
          disabled={
            mutation.needsRefresh ||
            mutation.isRefreshing ||
            !!reason ||
            !tag ||
            !quote ||
            mutation.isPending
          }
          loading={mutation.isPending}
          onClick={() => {
            if (tag && quote)
              mutation.mutate({
                userItemId: owned.id,
                tagId: tag.fortifyId!,
                expectedLevel: quote.level,
                expectedFailures: quote.failures,
              });
          }}
        >
          Attempt Fortify
        </Button>
      </DialogContent>
    </Dialog>
  );
}
