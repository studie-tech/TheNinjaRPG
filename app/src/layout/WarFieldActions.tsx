"use client";
import { Swords } from "lucide-react";
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
import { useRefreshAt } from "@/hooks/useRefreshAt";
import Link from "@/layout/Link";
import Modal from "@/layout/Modal";
import { ObjectiveWarPanel } from "@/layout/ObjectiveWarPanel";
import { useUserDataSelector } from "@/utils/UserContext";

/** Keep Travel focused on the map, fetching detailed war actions only on demand. */
export const WarFieldActions = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWar, setSelectedWar] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    if (!user || !activeWar) return null;
    return (
      <>
        <Button
          ref={triggerRef}
          size="icon"
          variant="ghost"
          className="mr-2 h-7 w-7"
          aria-label={
            updates ? `War, ${updates} ${updates === 1 ? "update" : "updates"}` : "War"
          }
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          count={updates}
          onClick={() => setIsOpen(true)}
        >
          <Swords className="h-7 w-7" aria-hidden />
        </Button>
        {isOpen && (
          <Modal
            title="War"
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            returnFocusRef={triggerRef}
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
  }, [user, activeWar, objectiveWars, updates, isOpen, selectedWar]);
};
