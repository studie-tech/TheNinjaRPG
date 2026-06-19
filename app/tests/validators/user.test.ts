import { describe, expect, it } from "vitest";
import { getPublicUsersSchema } from "@/validators/user";

describe("getPublicUsersSchema", () => {
  it("accepts farming as a public-user leaderboard order", () => {
    const result = getPublicUsersSchema.parse({
      limit: 30,
      isAi: false,
      orderBy: "Farming",
    });

    expect(result.orderBy).toBe("Farming");
  });
});
