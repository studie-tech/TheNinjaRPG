"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { getLoadoutsWithHotkeys } from "@/deltas/loadout";
import {
  assignHotkey,
  DEFAULT_BASIC_HOTKEYS,
  findLoadoutHotkeyConflict,
  type HotkeyKind,
  type HotkeyMap,
  hotkeyLabel,
  resolveHotkeys,
} from "@/libs/combat/hotkeys";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Which loadout a key is stored in: jutsu and basics, or items. */
export type { HotkeyKind } from "@/libs/combat/hotkeys";

/**
 * Battle keys of the active jutsu and item loadouts, and a setter that saves a
 * change to the right loadout. Keys move within a loadout; a key already used by
 * any loadout of the other kind is refused so one key never means two actions.
 * A battle passes its own loadout ids, since the lobby can switch them.
 */
export const useBattleHotkeys = (
  options: {
    enabled?: boolean;
    jutsuLoadoutId?: string | null;
    itemLoadoutId?: string | null;
  } = {},
) => {
  const { data: userData } = useUserData();
  const jutsuLoadoutId =
    options.jutsuLoadoutId !== undefined
      ? options.jutsuLoadoutId
      : userData?.jutsuLoadout;
  const itemLoadoutId =
    options.itemLoadoutId !== undefined ? options.itemLoadoutId : userData?.itemLoadout;
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const enabled = !!userData && (options.enabled ?? true);
  const { data: jutsuLoadouts } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled,
  });
  const { data: itemLoadouts } = api.item.getItemLoadouts.useQuery(undefined, {
    enabled,
  });
  const jutsuLoadout = jutsuLoadouts?.find((l) => l.id === jutsuLoadoutId);
  const itemLoadout = itemLoadouts?.find((l) => l.id === itemLoadoutId);
  const jutsuMap = jutsuLoadout?.hotkeys;
  const itemMap = itemLoadout?.hotkeys;
  const resolved = useMemo(
    () => resolveHotkeys(jutsuMap, itemMap),
    [jutsuMap, itemMap],
  );

  // Each save sends a whole map, so saves run one at a time: an older map can
  // never land after a newer one. Both kinds share the scope because a save is
  // checked against the other kind's keys.
  const scope = { id: "loadoutHotkeys" };
  // Refetch only after the last queued save: an earlier refetch would replace
  // the newer keys shown for a save still waiting in the queue.
  const onSettled = () => {
    const pending = queryClient.isMutating({
      predicate: (mutation) => mutation.options.scope?.id === scope.id,
    });
    if (pending > 1) return;
    return Promise.all([
      utils.jutsu.getLoadouts.invalidate(),
      utils.item.getItemLoadouts.invalidate(),
    ]);
  };
  const saveJutsu = api.jutsu.setLoadoutHotkeys.useMutation({
    scope,
    onSuccess: (result) => {
      if (!result.success) showMutationToast(result);
    },
    onSettled,
  });
  const saveItem = api.item.setLoadoutHotkeys.useMutation({
    scope,
    onSuccess: (result) => {
      if (!result.success) showMutationToast(result);
    },
    onSettled,
  });

  /** Bind (or with "" clear) a key; returns false when it could not be saved. */
  const setHotkey = (
    kind: HotkeyKind,
    actionId: string,
    key: string,
    names: Record<string, string> = {},
  ) => {
    const loadout = kind === "jutsu" ? jutsuLoadout : itemLoadout;
    if (!loadout) {
      showMutationToast({ success: false, message: "Select a loadout first" });
      return false;
    }
    if (!jutsuLoadouts || !itemLoadouts) {
      showMutationToast({
        success: false,
        message: "Loadouts are not ready. Try again shortly.",
      });
      return false;
    }
    const current: HotkeyMap = loadout.hotkeys ?? {};
    const { map, displaced } = assignHotkey(
      current,
      actionId,
      key,
      kind === "jutsu" ? DEFAULT_BASIC_HOTKEYS : {},
    );
    const owner = findLoadoutHotkeyConflict(
      kind,
      map,
      kind === "jutsu" ? itemLoadouts : jutsuLoadouts,
    );
    if (owner) {
      showMutationToast({
        success: false,
        message: `${hotkeyLabel(owner.key)} is used by ${names[owner.actionId] ?? (kind === "jutsu" ? "an item" : "a jutsu or basic action")} in ${owner.loadoutName}. Change it there first.`,
      });
      return false;
    }
    // Show the new keys at once (the next change builds on these rows); the save
    // confirms them or the refetch restores them. Cancelling first drops a
    // refetch already in flight, which would otherwise overwrite them.
    if (kind === "jutsu") {
      void utils.jutsu.getLoadouts.cancel();
      utils.jutsu.getLoadouts.setData(
        undefined,
        (rows) => rows && getLoadoutsWithHotkeys(rows, loadout.id, map),
      );
      saveJutsu.mutate({ id: loadout.id, hotkeys: map });
    } else {
      void utils.item.getItemLoadouts.cancel();
      utils.item.getItemLoadouts.setData(
        undefined,
        (rows) => rows && getLoadoutsWithHotkeys(rows, loadout.id, map),
      );
      saveItem.mutate({ id: loadout.id, hotkeys: map });
    }
    if (displaced.length > 0) {
      showMutationToast({
        success: true,
        message: `${hotkeyLabel(key)} moved from ${displaced.map((id) => names[id] ?? id).join(", ")}`,
      });
    }
    return true;
  };

  return {
    ...resolved,
    hasJutsuLoadout: !!jutsuLoadout,
    hasItemLoadout: !!itemLoadout,
    setHotkey,
    isSaving: saveJutsu.isPending || saveItem.isPending,
  };
};
