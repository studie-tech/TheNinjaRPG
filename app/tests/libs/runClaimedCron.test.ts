import { describe, expect, it, vi } from "bun:test";
import { runClaimedCron } from "@/libs/gamesettings";

const claim = (isClaimed = true) => ({
  isClaimed,
  response: Response.json("Wait"),
  release: vi.fn(async () => true),
});

const failing = async (): Promise<Response> => {
  throw new Error("work failed");
};

describe("runClaimedCron", () => {
  it("answers with the wait response when the period is taken", async () => {
    const timer = claim(false);
    const work = vi.fn(async () => Response.json("OK"));
    expect(await runClaimedCron(timer, "/api/test", work)).toBe(timer.response);
    expect(work).not.toHaveBeenCalled();
    expect(timer.release).not.toHaveBeenCalled();
  });

  it("keeps the period when the work succeeds", async () => {
    const timer = claim();
    const response = await runClaimedCron(timer, "/api/test", async () =>
      Response.json("OK"),
    );
    expect(await response.json()).toBe("OK");
    expect(timer.release).not.toHaveBeenCalled();
  });

  it("releases the period and reports a failure", async () => {
    const timer = claim();
    const response = await runClaimedCron(timer, "/api/test", failing);
    expect(response.status).toBe(500);
    expect(timer.release).toHaveBeenCalledTimes(1);
  });

  it("still reports the failure when the release fails too", async () => {
    const timer = claim();
    timer.release.mockRejectedValue(new Error("release failed"));
    const response = await runClaimedCron(timer, "/api/test", failing);
    expect(response.status).toBe(500);
  });
});
