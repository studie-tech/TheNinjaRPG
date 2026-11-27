import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { createHmac } from "node:crypto";
import { POST } from "@/app/api/webhooks/toprankingames/route";
import { env } from "@/env/server.mjs";
import { periodStart } from "@/utils/time";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";

const key = "test-toprankingames-secret";
const recordVote = vi.fn();
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = env.TOPRANKINGAMES_WEBHOOK_SECRET;
  env.TOPRANKINGAMES_WEBHOOK_SECRET = key;
  recordVote.mockReset().mockResolvedValue({ rowsAffected: 1 });
  stubProfile("updateUserVoteForTopRankinGames", recordVote);
});

afterEach(() => {
  env.TOPRANKINGAMES_WEBHOOK_SECRET = originalSecret;
  resetServerModuleStubs();
});

const payload = (changes: Record<string, unknown> = {}) => ({
  game: "theninja-rpg",
  vote_id: 123456,
  site_vote_id: "123456",
  token: "player-token",
  voted_at: Math.floor(Date.now() / 1000),
  nonce: "4f1c2a9e7b3d5a6c8e0f1a2b",
  sent_at: Math.floor(Date.now() / 1000),
  ...changes,
});

const request = (body: unknown = payload(), signature?: string) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://example.test/api/webhooks/toprankingames", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature":
        signature ?? `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`,
    },
    body: raw,
  });
};

describe("TopRankinGames callback", () => {
  it("records a signed vote using its opaque token", async () => {
    const body = payload();
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(recordVote).toHaveBeenCalledWith(
      expect.anything(),
      "player-token",
      "123456",
      new Date(body.voted_at * 1000),
    );
  });

  it("asks for a retry when the signing secret is not configured", async () => {
    env.TOPRANKINGAMES_WEBHOOK_SECRET = undefined;
    expect((await POST(request())).status).toBe(503);
    expect(recordVote).not.toHaveBeenCalled();
  });

  it.each(["", "sha256=bad", `sha256=${"0".repeat(64)}`, `sha256=${"é".repeat(64)}`])(
    "rejects an invalid signature %s before any write",
    async (signature) => {
      expect((await POST(request(payload(), signature))).status).toBe(401);
      expect(recordVote).not.toHaveBeenCalled();
    },
  );

  it("does not trust a signature from a different body", async () => {
    const original = request();
    const tampered = request(
      payload({ token: "another-player" }),
      original.headers.get("x-signature")!,
    );
    expect((await POST(tampered)).status).toBe(401);
    expect(recordVote).not.toHaveBeenCalled();
  });

  it.each([
    "{",
    payload({ game: "another-game" }),
    payload({ site_vote_id: "" }),
    payload({ token: "player@example.com" }),
    payload({ sent_at: "123" }),
    payload({ voted_at: null }),
  ])("rejects a malformed signed payload", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(recordVote).not.toHaveBeenCalled();
  });

  it.each([-301, 301])(
    "rejects a timestamp outside the five-minute window",
    async (offset) => {
      const body = payload({ sent_at: Math.floor(Date.now() / 1000) + offset });
      expect((await POST(request(body))).status).toBe(401);
      expect(recordVote).not.toHaveBeenCalled();
    },
  );

  it("acknowledges the dashboard test without recording a player vote", async () => {
    expect((await POST(request(payload({ token: "trg-test" })))).status).toBe(200);
    expect(recordVote).not.toHaveBeenCalled();
  });

  it("ignores a prior day's vote even when the retry has a fresh sent_at", async () => {
    const voted_at = periodStart("daily", new Date()).getTime() / 1000 - 1;
    const response = await POST(request(payload({ voted_at })));
    expect(response.status).toBe(200);
    expect(await response.json()).toBe("INVALID");
    expect(recordVote).not.toHaveBeenCalled();
  });

  it("ignores a vote with a future voted_at", async () => {
    const response = await POST(
      request(payload({ voted_at: Math.floor(Date.now() / 1000) + 600 })),
    );
    expect(response.status).toBe(200);
    expect(recordVote).not.toHaveBeenCalled();
  });
});
