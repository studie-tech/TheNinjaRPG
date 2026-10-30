"use client";

import { useMemo } from "react";
import { api } from "@/app/_trpc/client";
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
 */
export const useBattleHotkeys = (options: { enabled?: boolean } = {}) => {
  const { data: userData } = useUserData();
  const utils = api.useUtils();
  const enabled = !!userData && (options.enabled ?? true);
  const { data: jutsuLoadouts } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled,
  });
  const { data: itemLoadouts } = api.item.getItemLoadouts.useQuery(undefined, {
    enabled,
  });
  const jutsuLoadout = jutsuLoadouts?.find((l) => l.id === userData?.jutsuLoadout);
  const itemLoadout = itemLoadouts?.find((l) => l.id === userData?.itemLoadout);
  const jutsuMap = jutsuLoadout?.hotkeys;
  const itemMap = itemLoadout?.hotkeys;
  const resolved = useMemo(
    () => resolveHotkeys(jutsuMap, itemMap),
    [jutsuMap, itemMap],
  );

  const onSettled = (kind: HotkeyKind) => () =>
    kind === "jutsu"
      ? utils.jutsu.getLoadouts.invalidate()
      : utils.item.getItemLoadouts.invalidate();
  const saveJutsu = api.jutsu.setLoadoutHotkeys.useMutation({
    onSuccess: (result) => {
      if (!result.success) showMutationToast(result);
    },
    onSettled: onSettled("jutsu"),
  });
  const saveItem = api.item.setLoadoutHotkeys.useMutation({
    onSuccess: (result) => {
      if (!result.success) showMutationToast(result);
    },
    onSettled: onSettled("item"),
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
    // Show the new keys at once; the save confirms or the refetch restores them.
    if (kind === "jutsu") {
      utils.jutsu.getLoadouts.setData(undefined, (rows) =>
        rows?.map((row) => (row.id === loadout.id ? { ...row, hotkeys: map } : row)),
      );
      saveJutsu.mutate({ id: loadout.id, hotkeys: map });
    } else {
      utils.item.getItemLoadouts.setData(undefined, (rows) =>
        rows?.map((row) => (row.id === loadout.id ? { ...row, hotkeys: map } : row)),
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
