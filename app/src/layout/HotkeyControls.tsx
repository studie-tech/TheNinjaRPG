"use client";

import { Keyboard, Plus } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { type HotkeyKind, useBattleHotkeys } from "@/hooks/useBattleHotkeys";
import { BASIC_HOTKEY_ACTIONS, toHotkey } from "@/libs/combat/hotkeys";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

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
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") return; // The dialog closes itself.
    // Keep keyboard navigation of the dialog's own buttons.
    if (["Tab", "Enter", " ", "Shift"].includes(event.key)) return;
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
      <DialogContent
        className="max-w-sm text-center md:max-w-sm"
        onOpenAutoFocus={() => {
          // Shared programmatic openers have no single DialogTrigger.
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          // Restore the opener only if focus has not moved elsewhere during dismissal.
          if (
            returnFocusRef.current?.isConnected &&
            document.activeElement === document.body
          ) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogTitle className="flex items-center justify-center gap-2">
          <Keyboard className="h-5 w-5" aria-hidden /> Hotkey for {target?.name}
        </DialogTitle>
        <DialogDescription>
          Press a key to use in battle. Backspace removes it, Escape cancels.
        </DialogDescription>
        <p className="font-mono text-3xl">
          {currentKey ? currentKey.toUpperCase() : "—"}
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
        hotkey ? `${label}: hotkey ${hotkey.toUpperCase()}` : `Set hotkey for ${label}`
      }
      title={hotkey ? "Change hotkey" : "Set hotkey"}
      className="bg-background hover:bg-muted inline-flex h-[26px] min-w-[26px] items-center justify-center rounded border px-[6px] font-mono text-[12px] font-bold"
    >
      {hotkey ? (
        hotkey.toUpperCase()
      ) : (
        <Plus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      )}
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
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
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
        <ul className="flex flex-wrap gap-x-6 gap-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex min-w-0 items-center gap-2 text-sm">
              <HotkeyChip
                label={row.name}
                hotkey={hotkeys.byAction[row.id]}
                onClick={() => assign(row)}
              />
              <span className="truncate">{row.name}</span>
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
