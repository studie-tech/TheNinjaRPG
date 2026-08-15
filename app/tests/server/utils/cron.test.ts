import { afterEach, describe, expect, it } from "vitest";
import { authenticateCronRequest } from "@/server/utils/cron";

const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

/** Creates a cron request with an optional Authorization header. */
const request = (authorization?: string) =>
  new Request("https://example.com/api/cron", {
    headers: authorization ? { authorization } : undefined,
  });

describe("authenticateCronRequest", () => {
  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = authenticateCronRequest(request());

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      error: "CRON_SECRET not configured",
    });
  });

  it.each([undefined, "cron-secret", "Bearer wrong-secret"])(
    "rejects an invalid authorization header: %s",
    async (authorization) => {
      process.env.CRON_SECRET = "cron-secret";

      const response = authenticateCronRequest(request(authorization));

      expect(response?.status).toBe(401);
      await expect(response?.json()).resolves.toEqual({
        error: "Unauthorized - Invalid or missing authorization header",
      });
    },
  );

  it("accepts the exact Bearer token", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(authenticateCronRequest(request("Bearer cron-secret"))).toBeNull();
  });
});
