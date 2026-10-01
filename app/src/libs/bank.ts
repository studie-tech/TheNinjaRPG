import type { UserData } from "@/drizzle/schema";

export const bankAccessBlockMessage = (
  user: Pick<UserData, "isBanned" | "status">,
): string | null => {
  if (user.isBanned) return "You are banned";
  if (user.status === "BATTLE") return "Cannot access bank while in combat";
  return null;
};
