"use client";

import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemWithEffects from "@/layout/ItemWithEffects";

/** Meals and raid rewards use the same visible timed-effect surface. */
export const ActiveTimedBuffs = () => {
  const utils = api.useUtils();
  const { data, refetch, isError } = api.raids.getUserRaidBuffs.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const buffs = data?.buffs.filter((buff) => buff.expiresAt > new Date()) ?? [];
  if (isError)
    return (
      <p role="alert">
        Unable to load active effects.{" "}
        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </button>
      </p>
    );
  if (!buffs.length) return null;
  return (
    <ContentBox
      title="Active Raid & Meal Effects"
      subtitle="Timed bonuses"
      initialBreak
    >
      <p className="mb-2 text-sm">
        Meal effects replace one another. Overlapping raid and meal bonuses use the
        strongest effect.
      </p>
      <div className="grid gap-2">
        {buffs.map((buff) => (
          <div key={buff.id} className="rounded border p-2">
            <ItemWithEffects
              item={{
                id: buff.id,
                name: buff.item?.name ?? buff.quest?.name ?? "Raid Buff",
                description: buff.itemId ? "Meal effect" : "Raid effect",
                image: buff.item?.image ?? buff.quest?.image ?? undefined,
                effects: buff.effects,
                createdAt: buff.createdAt,
                updatedAt: buff.createdAt,
              }}
              hideDetails
              hideDates
              hideData
            />
            <p className="text-sm">
              Remaining:{" "}
              <Countdown
                targetDate={buff.expiresAt}
                onEndShow="Expired"
                onFinish={() => {
                  void refetch();
                  void utils.profile.getUser.invalidate();
                }}
              />
            </p>
          </div>
        ))}
      </div>
    </ContentBox>
  );
};
