import { describe, expect, it } from "vitest";
import { isMysqlTransactionRetryableError } from "@/server/utils/mysqlErrors";

describe("transaction retry classification", () => {
  it("retries deadlocks and PlanetScale transaction deadlines through cause chains", () => {
    expect(
      isMysqlTransactionRetryableError(
        new Error("query failed", {
          cause: new Error("Deadlock found when trying to get lock (errno 1213)"),
        }),
      ),
    ).toBe(true);
    expect(
      isMysqlTransactionRetryableError(
        new Error("transaction deadline exceeded after 20s"),
      ),
    ).toBe(true);
    expect(isMysqlTransactionRetryableError(new Error("duplicate entry"))).toBe(false);
  });
});
