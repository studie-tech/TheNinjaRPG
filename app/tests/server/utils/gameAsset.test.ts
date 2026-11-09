import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { env } from "@/env/server.mjs";
import {
  createSpriteAsset,
  downloadSpriteFile,
  GameAssetError,
  gameAssetEnabled,
  getGameAssetAccount,
} from "@/server/utils/gameAsset";

const key = env.GAMEASSET_API_KEY;
const respond = (body: unknown, status = 200) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      (async () => new Response(JSON.stringify(body), { status })) as never,
    );
const asset = {
  id: "ast",
  status: "queued",
  stage: "Queued",
  error: null,
  credits: { paid: 0.4 },
  files: null,
  sprite: null,
};
const input = {
  imageId: "img",
  prompt: "walks",
  motion: "move",
  facing: "left",
  frames: 33,
} as const;

beforeEach(() => {
  env.GAMEASSET_API_KEY = "ga_live_test";
});
afterEach(() => {
  env.GAMEASSET_API_KEY = key;
  vi.restoreAllMocks();
});

describe("gameasset.dev client", () => {
  it("disables itself without a key and never calls out", async () => {
    env.GAMEASSET_API_KEY = undefined;
    const fetched = respond({});
    expect(gameAssetEnabled()).toBe(false);
    await expect(getGameAssetAccount()).rejects.toBeInstanceOf(GameAssetError);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("authenticates, refuses redirects and sends the idempotency key", async () => {
    const fetched = respond(asset, 202);
    await createSpriteAsset(input, "request-1");
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://gameasset.dev/api/v1/assets");
    expect(init.redirect).toBe("error");
    expect(headers.Authorization).toBe("Bearer ga_live_test");
    expect(headers["Idempotency-Key"]).toBe("request-1");
    expect(JSON.parse(init.body as string).motion).toEqual({
      prompt: "walks",
      action: "move",
      facing: "left",
      frames: 33,
    });
  });

  it("surfaces the API's own message", async () => {
    respond(
      { error: { code: "insufficient_credits", message: "Top up your balance" } },
      402,
    );
    await expect(createSpriteAsset(input, "request-2")).rejects.toThrow(
      "Top up your balance",
    );
  });

  it("rejects a reply it cannot read", async () => {
    respond({ id: "ast" });
    await expect(createSpriteAsset(input, "request-3")).rejects.toThrow(
      "unexpected reply",
    );
  });

  it("downloads only from our CDN and gameasset.dev storage", async () => {
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((async () => new Response("ok")) as never);
    await expect(downloadSpriteFile("http://169.254.169.254/latest")).rejects.toThrow(
      "CDN",
    );
    await expect(
      downloadSpriteFile("https://me6hopahd7.ufs.sh.evil.test/f/a"),
    ).rejects.toThrow("CDN");
    expect(fetched).not.toHaveBeenCalled();
    await downloadSpriteFile("https://me6hopahd7.ufs.sh/f/a");
    await downloadSpriteFile("https://utfs.io/f/b");
    expect(fetched.mock.calls.map((call) => call[0])).toEqual([
      "https://me6hopahd7.ufs.sh/f/a",
      "https://uploadthing.b-cdn.net/f/b",
    ]);
  });
});
