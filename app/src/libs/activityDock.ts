import { atom } from "jotai";

/** The mounted dock reports its state so mobile navigation can control the same panel. */
export const activityDockStateAtom = atom<{
  userId: string | null;
  panelId: string | null;
  open: boolean;
  /** Story news waits in the collapsed dock. */
  hasNews: boolean;
}>({ userId: null, panelId: null, open: false, hasNews: false });

/** Navigation requests are scoped to the character that owns the mounted dock. */
export const activityDockRequestAtom = atom({
  userId: null as string | null,
  sequence: 0,
  open: false,
});
