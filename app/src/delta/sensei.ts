export const getAcceptRequestUserUpdate = ({
  userRank,
  senseiId,
}: {
  userRank: "NONE" | "STUDENT" | "GENIN" | "CHUNIN" | "JONIN" | "ELITE JONIN" | "ELDER";
  senseiId: string;
}) => ({
  userPatch: userRank === "GENIN" ? { senseiId } : {},
});

export const getLeaveSenseiUserUpdate = () => ({
  userPatch: { senseiId: null },
});
