import { RYO_CAP } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";

export const bankAccessBlockMessage = (
  user: Pick<UserData, "isBanned" | "status">,
): string | null => {
  if (user.isBanned) return "You are banned";
  if (user.status === "BATTLE") return "Cannot access bank while in combat";
  return null;
};

/** The part of `amount` that fits on top of `balance` under RYO_CAP; null when none does. */
export const clampToRyoCap = (balance: number, amount: number): number | null => {
  if (balance + amount <= RYO_CAP) return amount;
  const room = RYO_CAP - balance;
  return room > 0 ? room : null;
};
