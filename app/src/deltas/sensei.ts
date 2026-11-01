/**
 * Project the accepted sensei relationship only for a Genin caller; other ranks leave the
 * profile unchanged.
 */
export const getAcceptRequestUserUpdate = ({
  userRank,
  senseiId,
}: {
  userRank: "NONE" | "STUDENT" | "GENIN" | "CHUNIN" | "JONIN" | "ELITE JONIN" | "ELDER";
  senseiId: string;
}) => ({
  userPatch: userRank === "GENIN" ? { senseiId } : {},
});

/** Clear the caller's confirmed sensei relationship. */
export const getLeaveSenseiUserUpdate = () => ({
  userPatch: { senseiId: null },
});
