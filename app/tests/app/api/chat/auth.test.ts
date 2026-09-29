import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as clerk from "@clerk/nextjs/server";
import * as ai from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetServerModuleStubs,
  stubDatabase,
  stubProfile,
} from "../../../setup/serverModules";

const chatDir = resolve(import.meta.dirname, "../../../../src/app/api/chat");
const routes = readdirSync(chatDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
// Support is open to every signed-in player and capped by its own daily counter; every
// other chat route drafts game content, so it is reserved for content staff.
const contentRoutes = routes.filter((name) => name !== "support");

const mocks = { auth: vi.fn(), fetchUser: vi.fn(), streamText: vi.fn() };

const post = async (name: string) => {
  const { POST } = (await import(resolve(chatDir, name, "route.ts"))) as {
    POST: (request: Request) => Promise<Response>;
  };
  return POST(
    new Request(`https://example.test/api/chat/${name}`, {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    }),
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(clerk, "auth").mockImplementation(mocks.auth);
  // A caller who slips through fails an assertion instead of starting a billed model
  // call or touching a real database.
  vi.spyOn(ai, "streamText").mockImplementation(mocks.streamText);
  stubProfile("fetchUser", mocks.fetchUser);
  stubDatabase({});
  mocks.streamText.mockReturnValue({
    toUIMessageStreamResponse: () => new Response("streamed"),
  });
});

describe("chat routes", () => {
  it.each(routes)("/api/chat/%s rejects a caller without a session", async (name) => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect((await post(name)).status).toBe(401);
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
});

describe("content chat routes", () => {
  it.each(contentRoutes)(
    "/api/chat/%s rejects a signed-in player without a content role",
    async (name) => {
      mocks.auth.mockResolvedValue({ userId: "user_player" });
      mocks.fetchUser.mockResolvedValue({ role: "USER" });

      expect((await post(name)).status).toBe(403);
      expect(mocks.streamText).not.toHaveBeenCalled();
    },
  );

  it.each(contentRoutes)("/api/chat/%s streams for content staff", async (name) => {
    mocks.auth.mockResolvedValue({ userId: "user_staff" });
    mocks.fetchUser.mockResolvedValue({ role: "CONTENT" });

    expect((await post(name)).status).toBe(200);
    expect(mocks.streamText).toHaveBeenCalledOnce();
  });
});
