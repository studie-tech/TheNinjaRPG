"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { VILLAGE_STRUCTURE_MONTHLY_COST } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { countMaintainedStructures } from "@/utils/village";

/** Show village upkeep and pay outstanding maintenance with confirmed server feedback. */
export const VillageStructureMaintenance = ({ villageId }: { villageId: string }) => {
  const utils = api.useUtils();
  const [message, setMessage] = useState("");
  const { data, isPending, isError, refetch } = api.village.get.useQuery(
    { id: villageId },
    { enabled: !!villageId },
  );
  const pay = api.kage.payStructureMaintenance.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      showMutationToast(result);
      if (result.success)
        await Promise.all([
          utils.village.get.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
    },
    onError: (error) => setMessage(error.message),
  });
  const village = data?.villageData;
  const count = countMaintainedStructures(village?.structures ?? []);
  const monthlyCost = count * VILLAGE_STRUCTURE_MONTHLY_COST;
  return (
    <ContentBox title="Structure Maintenance" initialBreak>
      {isPending ? (
        <Loader explanation="Loading maintenance" />
      ) : isError ? (
        <Button onClick={() => void refetch()}>Retry maintenance details</Button>
      ) : (
        village && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Monthly upkeep</dt>
                <dd className="font-semibold tabular-nums">
                  {monthlyCost.toLocaleString()}
                </dd>
                <p className="mt-1 text-muted-foreground text-xs">
                  {count} structures × {VILLAGE_STRUCTURE_MONTHLY_COST.toLocaleString()}
                </p>
              </div>
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Village tokens</dt>
                <dd className="font-semibold tabular-nums">
                  {village.tokens.toLocaleString()}
                </dd>
              </div>
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Maintenance due</dt>
                <dd className="font-semibold tabular-nums">
                  {village.structureMaintenanceDue.toLocaleString()}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-sm">
              Billed at the start of each UTC calendar month and paid automatically when
              the village has enough tokens. Unpaid maintenance accumulates and must be
              paid before upgrading structures.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {village.structureMaintenanceDue > 0 ? (
                <>
                  <Button
                    disabled={
                      pay.isPending || village.tokens < village.structureMaintenanceDue
                    }
                    onClick={() => pay.mutate({ villageId })}
                  >
                    {pay.isPending ? "Paying..." : "Pay maintenance"}
                  </Button>
                  {village.tokens < village.structureMaintenanceDue && (
                    <p className="text-muted-foreground text-sm">
                      {(
                        village.structureMaintenanceDue - village.tokens
                      ).toLocaleString()}{" "}
                      more tokens needed.
                    </p>
                  )}
                </>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                  Maintenance is up to date
                </p>
              )}
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </div>
        )
      )}
    </ContentBox>
  );
};
