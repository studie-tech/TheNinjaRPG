/**
 * Replace the saved Bloodright allocation and debit silver while increasing recorded
 * spending. Withhold balance deltas when the opening user needs a refresh.
 */
export const getPurchaseUserUpdate = ({
  updatedUserRequiresUserRefresh,
  tierSeichiSilverCost,
  bloodright,
}: {
  updatedUserRequiresUserRefresh: boolean;
  tierSeichiSilverCost: number;
  bloodright: {
    skillId: string;
    cost: number;
  }[];
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : {
        seichiSilver: -tierSeichiSilverCost,
        bloodrightSpent: tierSeichiSilverCost,
      },
  userPatch: { bloodright },
});

/**
 * Replace the retained Bloodright allocation and return the confirmed silver refund. Withhold
 * balance deltas when the opening user needs a refresh.
 */
export const getRefundUserUpdate = ({
  updatedUserRequiresUserRefresh,
  refund,
  bloodright,
}: {
  updatedUserRequiresUserRefresh: boolean;
  refund: number;
  bloodright: {
    skillId: string;
    cost: number;
  }[];
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : { seichiSilver: refund, bloodrightSpent: -refund },
  userPatch: { bloodright },
});

/**
 * Clear Bloodright allocation and spending, record the monthly reset and refund spent silver
 * and debit any reputation reset fee. Withhold balance deltas when the opening user needs a
 * refresh.
 */
export const getResetUserUpdate = ({
  updatedUserRequiresUserRefresh,
  userBloodrightSpent,
  cost,
  monthlySkillResets,
}: {
  updatedUserRequiresUserRefresh: boolean;
  userBloodrightSpent: number;
  cost: number;
  monthlySkillResets: {
    count: number;
    month: string;
  };
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : {
        seichiSilver: userBloodrightSpent,
        ...(cost > 0 ? { reputationPoints: -cost } : {}),
      },
  userPatch: { bloodright: [], bloodrightSpent: 0, monthlySkillResets },
});
