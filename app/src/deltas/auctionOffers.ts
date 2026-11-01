/** Reserve bank ryo for a request offer; trade offers leave the profile balances unchanged. */
export const getCreateAuctionOfferUserUpdate = ({
  input,
}: {
  input: { offerType: "REQUEST"; ryo: number } | { offerType: "TRADE" };
}) => ({ userDelta: input.offerType === "REQUEST" ? { bank: -input.ryo } : {} });

/** Credit returned or earned bank ryo for a request offer; trade offers have no balance delta. */
export const getAuctionOfferCreditUserUpdate = ({
  offerOfferType,
  offerRyo,
}: {
  offerOfferType: "REQUEST" | "TRADE";
  offerRyo: number;
}) => ({
  userDelta: offerOfferType === "REQUEST" ? { bank: offerRyo } : {},
});
