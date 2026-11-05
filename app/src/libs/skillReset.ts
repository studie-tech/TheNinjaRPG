/**
 * Button note for a free Skills or Bloodright reset. Staff resets never consume the shared
 * allowance, so staff see that instead of the count; a free reset with nothing remaining
 * can only be a staff reset.
 */
export const freeResetNote = (
  isStaff: boolean,
  remaining: number,
  allowance = "free resets",
) =>
  isStaff || remaining === 0 ? "Free for staff" : `${remaining} ${allowance} remaining`;
