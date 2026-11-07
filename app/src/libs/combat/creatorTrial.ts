import { CREATOR_USERNAME } from "@/drizzle/constants";

/** Frozen at initiation, so settlement credits the creator without reading their account. */
export type CreatorTrialState = { creatorId: string; username: string };

/** The creator's own account, which open-world attacks never reach. */
export const isCreator = (user: { username: string; isAi?: boolean | number }) =>
  !user.isAi && user.username === CREATOR_USERNAME;
