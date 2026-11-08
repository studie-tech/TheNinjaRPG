"use client";

import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { HuntingBoard } from "@/layout/HuntingBoard";
import Modal from "@/layout/Modal";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { safeSessionStorageGetItem, safeSessionStorageSetItem } from "@/utils/storage";
import { blockingPopupOpenAtom, useUserDataSelector } from "@/utils/UserContext";

/**
 * Open the personal encounter when travel confirmation and global popups permit it.
 * Keep dismissal per account and sector/session across reloads and same-sector combat.
 */
export function HuntingArrival({ blocked = false }: { blocked?: boolean }) {
  const { data: user } = useUserDataSelector((user) => ({
    userId: user.userId,
    occupation: user.occupation,
    status: user.status,
    autoWakeUp: user.autoWakeUp,
    sector: user.sector,
  }));
  const isBlockingPopupOpen = useAtomValue(blockingPopupOpenAtom);
  const openButton = useRef<HTMLButtonElement>(null);
  const storageKey = `huntingArrival:${user?.userId}`;
  const [dismissed, setDismissed] = useState<string | null>(() =>
    safeSessionStorageGetItem(storageKey),
  );
  /** Persist this arrival's dismissal; null explicitly reopens the encounter. */
  const dismiss = (sessionId: string | null) => {
    const value = sessionId ? `${user?.sector}:${sessionId}` : null;
    safeSessionStorageSetItem(storageKey, value ?? "");
    setDismissed(value);
  };
  const encounter = api.hunting.getSession.useQuery(undefined, {
    enabled: user?.occupation === "HUNTER",
    refetchInterval: 5000,
    refetchOnMount: "always",
  });
  const session = encounter.data?.session;
  const isAtEncounter = canAttemptAwakeAction(user) && user?.sector === session?.sector;
  useEffect(() => {
    const saved = safeSessionStorageGetItem(storageKey);
    // Optimistic travel keeps the current sector until admission succeeds. Store
    // the dismissed sector so confirmed departure also works while the session loads.
    if (user && saved && !saved.startsWith(`${user.sector}:`)) {
      safeSessionStorageSetItem(storageKey, "");
      setDismissed(null);
    } else {
      setDismissed(saved);
    }
  }, [user?.sector, storageKey]);
  if (user?.occupation !== "HUNTER") return null;
  // Failed polls retain cached data, including a valid null response. Only an
  // initial load failure should replace the encounter and its action feedback.
  if (encounter.error && encounter.data === undefined)
    return (
      <p role="status">
        Unable to load your hunting contract.{" "}
        <Button variant="outline" onClick={() => void encounter.refetch()}>
          Retry
        </Button>
      </p>
    );
  if (!session || !isAtEncounter || session.battleId) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
        <p>
          Hunting contract:{" "}
          <strong>{encounter.data?.contract?.name ?? "Unavailable contract"}</strong>
        </p>
        <Button ref={openButton} onClick={() => dismiss(null)}>
          Open hunting contract
        </Button>
      </div>
      {/* An NPC prompt can open later; its focus must not dismiss this encounter. */}
      <Modal
        title="Hunting encounter"
        returnFocusRef={openButton}
        dismissOnInteractOutside={false}
        className="sm:max-w-2xl"
        isOpen={
          !blocked &&
          !isBlockingPopupOpen &&
          dismissed !== `${user.sector}:${session.id}`
        }
        setIsOpen={(open) => {
          if (!open) dismiss(session.id);
        }}
      >
        <HuntingBoard sessionOnly />
      </Modal>
    </>
  );
}
