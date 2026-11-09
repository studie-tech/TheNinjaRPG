import { afterEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { DrizzleQueryError } from "drizzle-orm";
import { errorText } from "@/server/utils/discord/sync";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";

describe("discord sync errorText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a Discord failure's text, capped for storage", () => {
    const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    expect(errorText(new Error("Missing Permissions"))).toBe("Missing Permissions");
    expect(errorText(new Error("x".repeat(300)))).toHaveLength(200);
    expect(errorText("rate limited")).toBe("rate limited");
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed statement to Sentry and keeps it out of the sync errors", () => {
    const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new DrizzleQueryError(
      "select 1",
      ["secret"],
      new TypeError("fetch failed"),
    );
    expect(errorText(failure)).toBe(DATABASE_FAILURE_MESSAGE);
    expect(report).toHaveBeenCalledWith(failure, expect.anything());
  });
});
