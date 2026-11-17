/**
 * Move the confirmed amount between pocket and bank. The guarded write changed both
 * balances by exactly this amount, so the delta applies on top of the cached balances.
 */
export const getTransferRyoUserUpdate = ({
  fromPocket,
  value,
}: {
  fromPocket: boolean;
  value: number;
}) => ({
  userDelta: fromPocket
    ? { money: -value, bank: value }
    : { money: value, bank: -value },
});

/** Debit the sender's bank by the confirmed amount sent to another player. */
export const getBankTransferUserUpdate = ({ value }: { value: number }) => ({
  userDelta: { bank: -value },
});
