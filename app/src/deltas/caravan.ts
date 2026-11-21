/** Profile patch of an escort entering or leaving their caravan's queue. */
export const getEscortStatusUserUpdate = (status: "QUEUED" | "AWAKE") => ({
  userPatch: { status },
});
