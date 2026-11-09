import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as ai from "ai";
import { GET } from "@/app/api/staffreview/route";
import {
  conversation,
  conversationComment,
  gameSetting,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import * as pusher from "@/libs/pusher";
import * as social from "@/server/utils/push/social";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

const LAST_RUN = new Date(Date.now() - 40 * 24 * 3600 * 1000);
const request = () => new Request("https://example.com/api/staffreview");
const timer = {
  id: "staff-timer",
  name: "timer-720h",
  time: LAST_RUN,
  value: 0,
};
const rows = new Map<object, Record<string, unknown>[]>();
let storageFailure: "counter" | "all" | undefined;

beforeEach(() => {
  timer.time = LAST_RUN;
  storageFailure = undefined;
  rows.clear();
  for (const table of [conversation, conversationComment, user2conversation]) {
    rows.set(table, []);
  }
  // Keep createConvo's independent writes real while controlling their storage outcomes.
  stubDatabase({
    query: {
      gameSetting: { findFirst: async () => ({ ...timer }) },
      userData: {
        findMany: async () => [{ userId: "reviewed", username: "Reviewed" }],
      },
      userReview: {
        findMany: async () => [{ review: "Helpful and quick to respond" }],
      },
    },
    insert: (table: object) => ({
      values: async (data: Record<string, unknown> | Record<string, unknown>[]) => {
        if (storageFailure === "all") throw new Error("Storage unavailable");
        rows.get(table)?.push(...(Array.isArray(data) ? data : [data]));
        return { rowsAffected: 1 };
      },
    }),
    update: (table: object) => ({
      set: (data: object) => ({
        where: async () => {
          if (table === gameSetting) {
            Object.assign(timer, data);
            return { rowsAffected: 1 };
          }
          expect(table).toBe(userData);
          if (storageFailure) throw new Error("Inbox counter unavailable");
          return { rowsAffected: 1 };
        },
      }),
    }),
  });
  stubCronAuth(() => null);
  vi.spyOn(ai, "generateText").mockResolvedValue({ text: "Helpful" } as never);
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(pusher, "getServerPusher").mockReturnValue({
    trigger: async () => {},
  } as never);
  vi.spyOn(social, "notifyPrivateConversation").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("retains the month when the summary is readable despite a failed inbox counter", async () => {
  storageFailure = "counter";
  expect((await GET(request())).status).toBe(500);
  expect(timer.time.getTime()).not.toBe(LAST_RUN.getTime());
  expect(rows.get(conversation)).toHaveLength(1);
  expect(rows.get(conversationComment)).toHaveLength(1);
  expect(
    rows.get(user2conversation)?.filter((row) => row.userId === "reviewed"),
  ).toHaveLength(1);

  storageFailure = undefined;
  expect((await GET(request())).status).toBe(200);
  expect(ai.generateText).toHaveBeenCalledTimes(1);
  expect(rows.get(conversation)).toHaveLength(1);
  expect(rows.get(conversationComment)).toHaveLength(1);
});

it("retains the month when attempted conversation writes have an unknown outcome", async () => {
  storageFailure = "all";
  expect((await GET(request())).status).toBe(500);
  expect(timer.time.getTime()).not.toBe(LAST_RUN.getTime());
  expect(rows.get(conversation)).toHaveLength(0);

  storageFailure = undefined;
  expect((await GET(request())).status).toBe(200);
  expect(ai.generateText).toHaveBeenCalledTimes(1);
  expect(rows.get(conversation)).toHaveLength(0);
});

it("releases the month for a successful retry after a model failure", async () => {
  vi.spyOn(ai, "generateText").mockRejectedValueOnce(new Error("Model unavailable"));
  expect((await GET(request())).status).toBe(500);
  expect(timer.time.getTime()).toBe(LAST_RUN.getTime());
  expect(rows.get(conversation)).toHaveLength(0);

  expect((await GET(request())).status).toBe(200);
  expect(ai.generateText).toHaveBeenCalledTimes(2);
  expect(rows.get(conversation)).toHaveLength(1);
});
