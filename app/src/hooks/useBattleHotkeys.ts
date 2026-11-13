"use client";

import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { getLoadoutsWithHotkeys } from "@/deltas/loadout";
import {
  assignHotkey,
  DEFAULT_BASIC_HOTKEYS,
  findLoadoutHotkeyConflict,
  type HotkeyKind,
  type HotkeyMap,
  resolveHotkeys,
} from "@/libs/combat/hotkeys";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";
import type { SetLoadoutHotkeysSchema } from "@/validators/loadout";

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
  const { data: userData } = useUserDataSelector((u) => ({
    jutsuLoadout: u.jutsuLoadout,
    itemLoadout: u.itemLoadout,
  }));
  const jutsuLoadoutId =
    options.jutsuLoadoutId !== undefined
      ? options.jutsuLoadoutId
      : userData?.jutsuLoadout;
  const itemLoadoutId =
    options.itemLoadoutId !== undefined ? options.itemLoadoutId : userData?.itemLoadout;
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  // Whole-map saves share a scope so neither kind can overtake an earlier save.
  const scope = { id: "loadoutHotkeys" };
  const enabled = !!userData && (options.enabled ?? true);
  const { data: savedJutsuLoadouts } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled,
  });
  const { data: savedItemLoadouts } = api.item.getItemLoadouts.useQuery(undefined, {
    enabled,
  });
  const pendingHotkeys = useMutationState({
    filters: {
      status: "pending",
      predicate: (mutation) => mutation.options.scope?.id === scope.id,
    },
    select: (mutation) => ({
      kind: mutation.options.meta?.hotkeyKind,
      input: mutation.state.variables as SetLoadoutHotkeysSchema,
    }),
  });
  // Equipment changes can refetch these rows while whole-map saves are queued.
  let jutsuLoadouts = savedJutsuLoadouts;
  let itemLoadouts = savedItemLoadouts;
  for (const { kind, input } of pendingHotkeys) {
    if (kind === "jutsu" && jutsuLoadouts) {
      jutsuLoadouts =
        getLoadoutsWithHotkeys(jutsuLoadouts, input.id, input.hotkeys) ?? jutsuLoadouts;
    } else if (kind === "item" && itemLoadouts) {
      itemLoadouts =
        getLoadoutsWithHotkeys(itemLoadouts, input.id, input.hotkeys) ?? itemLoadouts;
    }
  }
  const jutsuLoadout = jutsuLoadouts?.find((l) => l.id === jutsuLoadoutId);
  const itemLoadout = itemLoadouts?.find((l) => l.id === itemLoadoutId);
  const jutsuMap = jutsuLoadout?.hotkeys;
  const itemMap = itemLoadout?.hotkeys;
  const resolved = useMemo(
    () => resolveHotkeys(jutsuMap, itemMap),
    [jutsuMap, itemMap],
  );

  // Reconcile both kinds only after every queued whole-map save has finished.
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
    meta: { hotkeyKind: "jutsu" },
    onSuccess: async (result, input) => {
      if (!result.success) {
        showMutationToast(result);
        return;
      }
      await utils.jutsu.getLoadouts.cancel();
      utils.jutsu.getLoadouts.setData(
        undefined,
        (rows) => rows && getLoadoutsWithHotkeys(rows, input.id, input.hotkeys),
      );
    },
    onSettled,
  });
  const saveItem = api.item.setLoadoutHotkeys.useMutation({
    scope,
    meta: { hotkeyKind: "item" },
    onSuccess: async (result, input) => {
      if (!result.success) {
        showMutationToast(result);
        return;
      }
      await utils.item.getItemLoadouts.cancel();
      utils.item.getItemLoadouts.setData(
        undefined,
        (rows) => rows && getLoadoutsWithHotkeys(rows, input.id, input.hotkeys),
      );
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
        message: `${owner.key.toUpperCase()} is used by ${names[owner.actionId] ?? (kind === "jutsu" ? "an item" : "a jutsu or basic action")} in ${owner.loadoutName}. Change it there first.`,
      });
      return false;
    }
    // Patch directly: shared revision helpers can start reconciliation reads
    // before the queued whole-map writes finish.
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
        message: `${key.toUpperCase()} moved from ${displaced.map((id) => names[id] ?? id).join(", ")}`,
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
