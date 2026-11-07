import { describe, expect, it } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { errorText } from "@/server/utils/discord/sync";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";

describe("discord sync errorText", () => {
  it("keeps a Discord failure's text, capped for storage", () => {
    expect(errorText(new Error("Missing Permissions"))).toBe("Missing Permissions");
    expect(errorText(new Error("x".repeat(300)))).toHaveLength(200);
    expect(errorText("rate limited")).toBe("rate limited");
  });

  it("keeps a failed statement out of the sync errors", () => {
    const failure = new DrizzleQueryError("select 1", ["secret"], new TypeError("fetch failed"));
    expect(errorText(failure)).toBe(DATABASE_FAILURE_MESSAGE);
  });
});
