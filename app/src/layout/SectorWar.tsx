"use client";
import { LandPlot, Loader2, Trash2 } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  VILLAGE_SYNDICATE_ID,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_SHRINE_IMAGE,
} from "@/drizzle/constants";
import { useAdminEndWar } from "@/hooks/useWarActions";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import StatusBar from "@/layout/StatusBar";
import { showMutationToast } from "@/libs/toast";
import { isFactionVillage } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { canAdministrateWars } from "@/utils/permissions";

/**
 * Sector War Component
 */
export const SectorWar: React.FC<{
  war: FetchActiveWarsReturnType;
  user: NonNullable<UserWithRelations>;
  isKage: boolean;
}> = ({ war, user, isKage }) => {
  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const adminEnd = useAdminEndWar(war.id);
  const { mutate: buildShrine, isPending: isBuilding } =
    api.war.buildShrine.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.war.getActiveWars.invalidate(),
            utils.war.getRaidOptions.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
            utils.travel.getAllSectors.invalidate(),
          ]);
        }
      },
    });

  // Only show active sector wars
  if (war.status !== "ACTIVE") return null;

  // Derived
  const isFaction = !!user.village && isFactionVillage(user.village);
  const canBuildShrine =
    isKage &&
    !isFaction &&
    user.village?.tokens &&
    war.attackerVillageId === user.villageId &&
    war.defenderShrineHp <= 0 &&
    user.village?.tokens >= WAR_PURCHASE_SHRINE_TOKEN_COST;

  // Render
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex w-full justify-end">
            {canAdministrateWars(user.role) && (
              <Button
                variant="destructive"
                size="icon"
                aria-label={`End sector war ${war.id}`}
                disabled={isBuilding || adminEnd.isPending}
                onClick={() => adminEnd.setShowDialog(true)}
              >
                {adminEnd.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Trash2 className="h-5 w-5" />
                )}
              </Button>
            )}
          </div>
          <Image
            src={WAR_SHRINE_IMAGE}
            alt="War Shrine"
            width={200}
            height={200}
            className={war.defenderShrineHp <= 0 ? "opacity-50 grayscale" : ""}
          />
          <div className="w-full max-w-md space-y-2">
            <div>
              <p className="font-medium text-sm">Shrine - Sector {war.sector}</p>
              {war.defenderShrineHp > 0 && (
                <StatusBar
                  key={`shrine-${war.defenderShrineHp}-${war.defenderShrineMaxHp}`}
                  title="HP"
                  tooltip="Shrine Health"
                  color="bg-red-500"
                  showText={true}
                  status="AWAKE"
                  current={war.defenderShrineHp}
                  total={war.defenderShrineMaxHp}
                />
              )}
            </div>
            <div className="mt-2 rounded-md bg-popover p-3 text-popover-foreground text-sm">
              {war.defenderShrineHp > 0 ? (
                war.defenderVillageId === VILLAGE_SYNDICATE_ID ? (
                  <p>
                    <strong>Note:</strong> To attack this shrine, you must travel to
                    sector {war.sector} and engage in combat with the shrine directly.
                  </p>
                ) : (
                  <p>
                    <strong>Note:</strong> To damage this shrine, attack players from
                    the defending village. Each victory will reduce the shrine&apos;s
                    HP.
                  </p>
                )
              ) : isFaction ? (
                <p>This shrine has been destroyed. Factions cannot purchase sectors.</p>
              ) : (
                <p>
                  <strong>Note:</strong> This shrine has been destroyed, and your
                  leaders can chose to build a new shrine to claim this sector. The cost
                  of building a new shrine is{" "}
                  {WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()} tokens. Currently we
                  have {user.village?.tokens?.toLocaleString()} tokens.
                </p>
              )}
            </div>
            {canBuildShrine && (
              <Confirm
                title="Build Shrine"
                disabled={adminEnd.isPending}
                button={
                  <Button
                    className="w-full"
                    loading={isBuilding}
                    disabled={adminEnd.isPending}
                  >
                    <LandPlot className="mr-2 h-5 w-5" />
                    Build Shrine ({WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()}{" "}
                    tokens)
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  buildShrine({ warId: war.id });
                }}
              >
                <p>
                  You are about to build a shrine in sector {war.sector}. This will cost{" "}
                  {WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()} village tokens. Are
                  you sure?
                </p>
              </Confirm>
            )}
          </div>
        </div>
      </div>
      <Modal
        id="sector-admin-end-war"
        title="End Sector War"
        isOpen={adminEnd.showDialog}
        setIsOpen={adminEnd.setShowDialog}
        proceed_label="End sector war"
        proceed_loading_label="Ending"
        confirmClassName="bg-amber-600 text-white hover:bg-amber-700"
        isLoading={adminEnd.isPending}
        keepOpenOnAccept={true}
        onAccept={adminEnd.endWar}
      >
        <div className="space-y-3">
          <p>
            This removes the war and its war history without assigning a winner or
            applying village losses.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <dt className="font-medium">War ID</dt>
            <dd className="break-all font-mono">{war.id}</dd>
            <dt className="font-medium">Type</dt>
            <dd>Sector War</dd>
            <dt className="font-medium">Sector</dt>
            <dd>{war.sector}</dd>
            <dt className="font-medium">Participants</dt>
            <dd>
              {war.attackerVillage?.name ?? war.attackerVillageId} vs.{" "}
              {war.defenderVillage?.name ?? war.defenderVillageId}
            </dd>
            <dt className="font-medium">Status</dt>
            <dd>{war.status}</dd>
          </dl>
          <p className="font-medium text-amber-600 dark:text-amber-400">
            This administrative action cannot be undone.
          </p>
        </div>
      </Modal>
    </div>
  );
};
