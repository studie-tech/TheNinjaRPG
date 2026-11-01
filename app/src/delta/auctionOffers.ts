export const getCreateAuctionOfferUserUpdate = ({
  input,
}: {
  input: { offerType: "REQUEST"; ryo: number } | { offerType: "TRADE" };
}) => ({ userDelta: input.offerType === "REQUEST" ? { bank: -input.ryo } : {} });

export const getAuctionOfferCreditUserUpdate = ({
  offerOfferType,
  offerRyo,
}: {
  offerOfferType: "REQUEST" | "TRADE";
  offerRyo: number;
}) => ({
  userDelta: offerOfferType === "REQUEST" ? { bank: offerRyo } : {},
});
