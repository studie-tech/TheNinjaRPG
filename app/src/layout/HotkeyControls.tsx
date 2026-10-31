"use client";

import { Keyboard } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { type HotkeyKind, useBattleHotkeys } from "@/hooks/useBattleHotkeys";
import { BASIC_HOTKEY_ACTIONS, hotkeyLabel, toHotkey } from "@/libs/combat/hotkeys";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

/** An action that can carry a battle key. */
export type HotkeyTarget = { id: string; name: string; kind: HotkeyKind };

/**
 * Waits for the next key press and binds it. Escape cancels; Backspace or Delete
 * removes the binding.
 */
export function HotkeyCaptureDialog({
  target,
  currentKey,
  onAssign,
  onClose,
}: {
  target: HotkeyTarget | null;
  currentKey?: string;
  /** Returns false to keep the dialog open, e.g. when the key is refused. */
  onAssign: (key: string) => boolean | null | undefined;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") return; // The dialog closes itself.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete") {
      if (onAssign("") !== false) onClose();
      return;
    }
    const key = toHotkey(event.key);
    if (!key) {
      setError("Use a letter, a number or one of - = [ ] ; ' , . /");
      return;
    }
    if (onAssign(key) !== false) onClose();
  });

  useEffect(() => {
    if (!target) return;
    setError(undefined);
    // Capture so the battle's own key handling does not act on this press.
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm text-center">
        <DialogTitle className="flex items-center justify-center gap-2">
          <Keyboard className="h-5 w-5" aria-hidden /> Hotkey for {target?.name}
        </DialogTitle>
        <DialogDescription>
          Press a key to use in battle. Backspace removes it, Escape cancels.
        </DialogDescription>
        <p className="font-mono text-3xl">
          {currentKey ? hotkeyLabel(currentKey) : "—"}
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {currentKey && (
          <Button
            variant="outline"
            onClick={() => {
              if (onAssign("") !== false) onClose();
            }}
          >
            Remove hotkey
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A key chip that opens the capture dialog for one action. */
export function HotkeyChip({
  label,
  hotkey,
  onClick,
}: {
  label: string;
  hotkey?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        hotkey ? `${label}: hotkey ${hotkeyLabel(hotkey)}` : `Set hotkey for ${label}`
      }
      title={hotkey ? "Change hotkey" : "Set hotkey"}
      className="bg-background hover:bg-muted inline-flex h-[26px] min-w-[26px] items-center justify-center rounded border px-[6px] font-mono text-[12px] font-bold"
    >
      {hotkey ? hotkeyLabel(hotkey) : <span className="text-muted-foreground">+</span>}
    </button>
  );
}

/**
 * Battle keys for the active loadout: the basic actions plus the given equipped
 * jutsu or items. Used on the jutsu and items pages where loadouts are built.
 */
export function LoadoutHotkeysPanel({
  kind,
  actions,
}: {
  kind: HotkeyKind;
  actions: { id: string; name: string; hidden?: boolean }[];
}) {
  const { data: userData } = useUserData();
  // Match the battle and inventory grids, which hide hidden content from players.
  const canSeeHidden = !!userData && canChangeContent(userData.role);
  const rows: HotkeyTarget[] = [
    ...actions
      .filter((action) => !action.hidden || canSeeHidden)
      .map((action) => ({ id: action.id, name: action.name, kind })),
    ...(kind === "jutsu"
      ? BASIC_HOTKEY_ACTIONS.map((action) => ({
          id: action.id,
          name: action.name,
          kind,
        }))
      : []),
  ];
  const names = Object.fromEntries(rows.map((row) => [row.id, row.name]));
  const { hotkeys, assign, dialog } = useHotkeyAssignment(names);
  const hasLoadout =
    kind === "jutsu" ? hotkeys.hasJutsuLoadout : hotkeys.hasItemLoadout;

  return (
    <section aria-label="Battle hotkeys" className="space-y-2">
      <p className="text-muted-foreground text-sm">
        Keys are saved with the selected {kind} loadout. You can also right-click an
        equipped {kind === "jutsu" ? "jutsu" : "item"} above, or an action in battle. A
        key used by any item loadout is reserved across jutsu loadouts, and vice versa.
      </p>
      {!hasLoadout ? (
        <p className="text-sm">Select a loadout to set its hotkeys.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm">Equip items to give them hotkeys.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate">{row.name}</span>
              <HotkeyChip
                label={row.name}
                hotkey={hotkeys.byAction[row.id]}
                onClick={() => assign(row)}
              />
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}

/**
 * Key assignment for a page: the current bindings, a function that opens the
 * capture dialog for an action, and the dialog element to render once.
 */
export function useHotkeyAssignment(names: Record<string, string> = {}) {
  const hotkeys = useBattleHotkeys();
  const [target, setTarget] = useState<HotkeyTarget | null>(null);
  const dialog = (
    <HotkeyCaptureDialog
      target={target}
      currentKey={target ? hotkeys.byAction[target.id] : undefined}
      onAssign={(key) =>
        target &&
        hotkeys.setHotkey(target.kind, target.id, key, {
          ...Object.fromEntries(
            BASIC_HOTKEY_ACTIONS.map((action) => [action.id, action.name]),
          ),
          ...names,
          [target.id]: target.name,
        })
      }
      onClose={() => setTarget(null)}
    />
  );
  return { hotkeys, assign: setTarget, dialog };
}
