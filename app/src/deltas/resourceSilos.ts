import type { RouterOutputs } from "@/app/_trpc/client";
import type { ResourceSiloEntryType } from "@/validators/resourceSilos";

/** Mark only the claimed spawn; a rollover must reconcile with the server. */
export const applyResourceSiloClaim = (
  current: RouterOutputs["resourceSilos"]["getStatus"],
  windowId: string,
) => (current.window.id === windowId ? { ...current, claimed: true } : undefined);
/** Replace the saved reward snapshots while preserving loaded catalog choices. */
export const applyResourceSiloEditorSave = (
  current: RouterOutputs["resourceSilos"]["getEditor"],
  entries: ResourceSiloEntryType[],
) => ({ ...current, entries });
