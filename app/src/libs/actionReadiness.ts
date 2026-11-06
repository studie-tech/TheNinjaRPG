import type { UserStatus } from "@/drizzle/constants";

/** Shared status feedback for actions that require an available character. */
export const actionStatusMessage = (status: UserStatus, name = "You") => {
  const are = name === "You" ? "are" : "is";
  const states: Record<UserStatus, string> = {
    AWAKE: "awake",
    ASLEEP: "asleep. Wake up before taking this action",
    HOSPITALIZED: "in the hospital. Check out before taking this action",
    TRAVEL: "traveling. Finish traveling before taking this action",
    BATTLE: "in battle. Finish the battle before taking this action",
    QUEUED: "queued for battle. Leave the queue before taking this action",
  };
  return `${name} ${are} ${states[status]}.`;
};

/** Confirmed wake-up notice shared by endpoint responses and feature feedback. */
export const AUTO_WAKE_MESSAGE = "This action woke you up.";
/** Confirmed free-checkout notice; automatic recovery never authorizes payment. */
export const AUTO_CHECKOUT_MESSAGE =
  "This action checked you out of the hospital for free.";

/**
 * Admit explicit recovery attempts, respecting the sleep preference. Hospital affordability
 * is checked by the server, so a hospitalized actor may still receive a checkout rejection.
 */
export const canAttemptAwakeAction = (
  user: { status: UserStatus; autoWakeUp?: boolean } | null | undefined,
) =>
  !!user &&
  (user.status === "AWAKE" ||
    user.status === "HOSPITALIZED" ||
    (user.status === "ASLEEP" && user.autoWakeUp !== false));

/** Project availability for client-side prerequisite hints; the server validates real status. */
export const actionPrerequisiteUser = <
  T extends { status: UserStatus; autoWakeUp?: boolean },
>(
  user: T,
): T => (canAttemptAwakeAction(user) ? { ...user, status: "AWAKE" } : user);
