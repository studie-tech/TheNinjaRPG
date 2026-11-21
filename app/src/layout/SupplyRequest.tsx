"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SUPPLY_REQUEST_BUNDLE_SIZE,
  SUPPLY_REQUEST_EXPERIENCE,
  SUPPLY_REQUEST_PAYOUT_PERCENT,
} from "@/drizzle/constants";
import { useSupplyRequest } from "@/hooks/useSupplyRequest";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { getSupplyRequestReward } from "@/libs/supplyRequest";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Submit a single carried stack through the Administration Building's daily supply desk. */
export const SupplyRequest = () => {
  const { request, result, isSubmitting, submit } = useSupplyRequest();
  const { timeDiff } = useRequiredUserInfo();
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(SUPPLY_REQUEST_BUNDLE_SIZE);
  const data = request.data;
  const selected = data?.stacks.find((stack) => stack.id === selectedId);
  const reward = selected
    ? getSupplyRequestReward(selected.auctionMaxPrice, quantity)
    : undefined;
  const valid =
    !!selected &&
    quantity >= SUPPLY_REQUEST_BUNDLE_SIZE &&
    quantity <= selected.quantity &&
    quantity % SUPPLY_REQUEST_BUNDLE_SIZE === 0;
  const profession = data?.occupation?.toLowerCase() ?? "profession";

  return (
    <ContentBox
      title="Supply Request"
      subtitle="Daily profession supplies"
      initialBreak
    >
      <p className="mb-3">
        Submit one stack matching your active profession in complete bundles of{" "}
        {SUPPLY_REQUEST_BUNDLE_SIZE} items. Earn {SUPPLY_REQUEST_PAYOUT_PERCENT}% of its
        auction maximum in Ryo and {SUPPLY_REQUEST_EXPERIENCE.toLocaleString()}{" "}
        profession EXP per bundle. You can submit once per daily reset, across all
        professions.
      </p>
      {request.isPending && <Loader explanation="Loading supplies" />}
      {request.isError && (
        <div role="alert">
          <p>Could not load supplies. {request.error.message}</p>
          <Button onClick={() => void request.refetch()}>Try again</Button>
        </div>
      )}
      {data && (
        <>
          <p className="mb-3">
            Active profession: <strong>{data.occupation ?? "None"}</strong>. Next reset
            in{" "}
            <Countdown
              targetDate={data.nextResetAt}
              timeDiff={timeDiff}
              onFinish={() => void request.refetch()}
            />
            .
          </p>
          {data.blocked && <p className="rounded-md border p-3">{data.blocked}</p>}
          {!data.blocked && (
            <>
              {data.stacks.length === 0 && (
                <p>
                  No eligible supplies. You need at least {SUPPLY_REQUEST_BUNDLE_SIZE}{" "}
                  items in one plain carried stack matching your profession, with an
                  auction maximum price. Equipped, stored, auctioned, unfinished,
                  modified or imbued copies cannot be submitted.
                </p>
              )}
              {data.stacks.length > 0 && (
                <div className="space-y-3">
                  <label className="block" htmlFor="supply-stack">
                    Supply stack
                  </label>
                  <select
                    id="supply-stack"
                    className="bg-background w-full rounded-md border p-2"
                    value={selectedId}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setSelectedId(event.target.value);
                      setQuantity(SUPPLY_REQUEST_BUNDLE_SIZE);
                    }}
                  >
                    <option value="">Choose one stack</option>
                    {data.stacks.map((stack) => (
                      <option key={stack.id} value={stack.id}>
                        {stack.name} — {stack.quantity.toLocaleString()} carried
                      </option>
                    ))}
                  </select>
                  {selected && (
                    <>
                      <div className="flex items-center gap-3">
                        {selected.image && (
                          <Image
                            src={selected.image}
                            alt={selected.name}
                            width={64}
                            height={64}
                            className="rounded-md"
                          />
                        )}
                        <div>
                          <p className="font-bold">{selected.name}</p>
                          <p>
                            Auction maximum: {selected.auctionMaxPrice.toLocaleString()}{" "}
                            Ryo per item
                          </p>
                        </div>
                      </div>
                      <label className="block" htmlFor="supply-quantity">
                        Quantity (multiples of {SUPPLY_REQUEST_BUNDLE_SIZE})
                      </label>
                      <div className="flex gap-2">
                        <Input
                          id="supply-quantity"
                          type="number"
                          min={SUPPLY_REQUEST_BUNDLE_SIZE}
                          max={selected.quantity}
                          step={SUPPLY_REQUEST_BUNDLE_SIZE}
                          value={quantity}
                          disabled={isSubmitting}
                          onChange={(event) => setQuantity(Number(event.target.value))}
                        />
                        <Button
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() =>
                            setQuantity(
                              Math.floor(
                                selected.quantity / SUPPLY_REQUEST_BUNDLE_SIZE,
                              ) * SUPPLY_REQUEST_BUNDLE_SIZE,
                            )
                          }
                        >
                          Max
                        </Button>
                      </div>
                      {!valid && (
                        <p role="alert">
                          Choose complete bundles up to{" "}
                          {Math.floor(selected.quantity / SUPPLY_REQUEST_BUNDLE_SIZE) *
                            SUPPLY_REQUEST_BUNDLE_SIZE}{" "}
                          items.
                        </p>
                      )}
                      {valid && reward && (
                        <p>
                          You receive <strong>{reward.ryo.toLocaleString()} Ryo</strong>{" "}
                          and{" "}
                          <strong>
                            {reward.experience.toLocaleString()} {profession} EXP
                          </strong>
                          . {selected.quantity - quantity} items remain.
                        </p>
                      )}
                      <Confirm
                        title="Submit supplies?"
                        button={
                          <Button disabled={!valid || isSubmitting}>
                            Submit supplies
                          </Button>
                        }
                        disabled={!valid || isSubmitting}
                        isLoading={isSubmitting}
                        tone="destructive"
                        proceed_label="Submit supplies"
                        onAccept={() => {
                          if (valid && data.occupation)
                            submit({
                              userItemId: selected.id,
                              quantity,
                              expectedQuantity: selected.quantity,
                              expectedUpdatedAt: selected.updatedAt,
                              occupation: data.occupation,
                              auctionMaxPrice: selected.auctionMaxPrice,
                            });
                        }}
                      >
                        {valid && reward
                          ? `Permanently exchange ${quantity.toLocaleString()}x ${selected.name} for ${reward.ryo.toLocaleString()} Ryo and ${reward.experience.toLocaleString()} ${profession} EXP? This uses your supply request for this reset.`
                          : "Review your supplies before submitting."}
                      </Confirm>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {result && (
        <p
          role={result.success ? "status" : "alert"}
          className="mt-3 rounded-md border p-3"
        >
          {result.message}
        </p>
      )}
    </ContentBox>
  );
};
