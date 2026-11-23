"use client";
import { Caravan, Swords } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveWars } from "@/hooks/useActiveWars";
import { useHeaderActionsFocus } from "@/hooks/useHeaderActionsFocus";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { CaravanControls } from "@/layout/CaravanControls";
import Link from "@/layout/Link";
import Modal from "@/layout/Modal";
import { ObjectiveWarPanel } from "@/layout/ObjectiveWarPanel";
import { mapToolClassName } from "@/layout/travel/styles";
import { useUserDataSelector } from "@/utils/UserContext";

/** Keep Travel focused on the map, fetching detailed war actions only on demand. */
export const WarFieldActions = ({
  includeCaravans = false,
  asMenu = false,
}: {
  includeCaravans?: boolean;
  asMenu?: boolean;
}) => {
  const [isCaravansOpen, setIsCaravansOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWar, setSelectedWar] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useHeaderActionsFocus() ?? triggerRef;
  const { data: user, timeDiff } = useUserDataSelector((user) => ({
    villageId: user.villageId,
    warMission: user.warMission,
  }));
  const { data: wars } = useActiveWars(user?.villageId ?? "", {
    enabled: !!user,
    polling: isOpen ? "live" : "discovery",
    timeDiff,
  });
  const objectiveWars = useMemo(() => wars?.filter((war) => war.rules) ?? [], [wars]);
  const camps = api.war.getWarCampNotices.useQuery(undefined, {
    enabled: objectiveWars.length > 0,
    refetchInterval: 60000,
    notifyOnChangeProps: ["data"],
  });
  const attempt = objectiveWars.some((war) => war.id === user?.warMission?.warId)
    ? user?.warMission
    : null;
  // Refresh the badge on server deadlines without mounting the detailed panel.
  useRefreshAt(
    [attempt?.endsAt, ...(camps.data?.map((camp) => camp.endsAt) ?? [])],
    () => void camps.refetch(),
    timeDiff,
    objectiveWars.length > 0,
  );
  const now = Date.now() - timeDiff;
  const updates =
    (camps.data?.filter((camp) => camp.endsAt.getTime() > now).length ?? 0) +
    (attempt && new Date(attempt.endsAt).getTime() <= now ? 1 : 0);
  const activeWar =
    objectiveWars.find((war) => war.id === selectedWar) ?? objectiveWars[0];
  useEffect(() => {
    // A later war must never reopen a dialog dismissed when participation ended.
    if (!objectiveWars.length) setIsOpen(false);
  }, [objectiveWars.length]);
  return useMemo(() => {
    if (!user || (!activeWar && !includeCaravans)) return null;
    return (
      <>
        {includeCaravans || asMenu ? (
          <>
            <button
              type="button"
              className={mapToolClassName}
              disabled={!activeWar}
              aria-haspopup="dialog"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              <Swords className="size-6 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">War</span>
                <span className="text-muted-foreground block text-xs">
                  {activeWar
                    ? updates
                      ? `${updates} ${updates === 1 ? "update" : "updates"} · View war objectives`
                      : "View war objectives"
                    : "No active wars"}
                </span>
              </span>
            </button>
            {includeCaravans && (
              <button
                type="button"
                className={mapToolClassName}
                aria-haspopup="dialog"
                onClick={() => {
                  setIsCaravansOpen(true);
                }}
              >
                <Caravan className="size-6 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Caravans</span>
                  <span className="text-muted-foreground block text-xs">
                    Scout trade routes and manage operations
                  </span>
                </span>
              </button>
            )}
          </>
        ) : (
          <Button
            ref={triggerRef}
            size="icon"
            variant="ghost"
            className="mr-2 h-7 w-7"
            aria-label={
              updates
                ? `War, ${updates} ${updates === 1 ? "update" : "updates"}`
                : "War"
            }
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            count={updates}
            onClick={() => setIsOpen(true)}
          >
            <Swords className="h-7 w-7" aria-hidden />
          </Button>
        )}
        {isCaravansOpen && (
          <Modal
            title="Caravans"
            isOpen={isCaravansOpen}
            setIsOpen={setIsCaravansOpen}
            returnFocusRef={returnFocusRef}
            className="sm:max-w-3xl md:max-w-3xl"
          >
            <CaravanControls />
          </Modal>
        )}
        {isOpen && activeWar && (
          <Modal
            title="War"
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            returnFocusRef={returnFocusRef}
            className="sm:max-w-3xl md:max-w-3xl"
          >
            {objectiveWars.length > 1 ? (
              <Select value={activeWar.id} onValueChange={setSelectedWar}>
                <SelectTrigger aria-label="Choose a war">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {objectiveWars.map((war) => (
                    <SelectItem key={war.id} value={war.id}>
                      {war.attackerVillage.name} vs {war.defenderVillage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="font-semibold text-sm">
                {activeWar.attackerVillage.name} vs {activeWar.defenderVillage.name}
              </p>
            )}
            <Link
              href="/townhall#Wars"
              className="text-sm underline underline-offset-4"
              onNavigate={() => setIsOpen(false)}
            >
              View war overview and contributions
            </Link>
            <ObjectiveWarPanel
              key={activeWar.id}
              warId={activeWar.id}
              isFieldView
              onNavigate={() => setIsOpen(false)}
            />
          </Modal>
        )}
      </>
    );
  }, [
    user,
    activeWar,
    objectiveWars,
    updates,
    isOpen,
    selectedWar,
    includeCaravans,
    asMenu,
    isCaravansOpen,
    returnFocusRef,
  ]);
};
