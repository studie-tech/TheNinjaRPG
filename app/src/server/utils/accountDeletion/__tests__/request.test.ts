import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/nextjs/server")>()),
  auth: mocks.auth,
}));
vi.mock("@/server/db", () => ({
  drizzleDB: {
    insert: mocks.insert,
    query: { accountDeletion: { findFirst: mocks.find } },
  },
}));
vi.mock("@/server/utils/accountDeletion/apple", () => ({
  prepareAppleDeletion: mocks.prepare,
}));

vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => ({}) } }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(vi.fn(), { slidingWindow: () => ({}) }),
}));

import type { z } from "zod";
import { accountDeletionRouter } from "@/server/api/routers/accountDeletion";
import { drizzleDB } from "@/server/db";
import type { accountDeletionSchema } from "@/validators/accountDeletion";
import { ACCOUNT_DELETION_REVERIFICATION } from "@/validators/accountDeletion";

afterEach(() => vi.unstubAllEnvs());

const body = {
  expectedUserId: "user_test",
  confirmation: "DELETE MY ACCOUNT",
  understandsPermanentLoss: true,
  understandsSubscriptions: true,
};
const context = (ua = "TNR-Native/1.0 (ios)", userId: string | null = "user_test") => ({
  drizzle: drizzleDB,
  userId,
  userAgent: ua,
  userIp: "127.0.0.1",
  abLemuReplacementVariant: undefined,
  abPixelLayoutVariant: undefined,
});
const request = (
  input: unknown = body,
  ua?: string,
  userId: string | null = "user_test",
) =>
  accountDeletionRouter
    .createCaller(context(ua, userId))
    .request(input as z.infer<typeof accountDeletionSchema>);
const transport = (method: "GET" | "POST") =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: accountDeletionRouter,
    createContext: () => context(),
    req: new Request("https://example.com/api/trpc/request", {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(superjson.serialize(body)) } : {}),
    }),
  });

describe("native account deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-worker-secret");
    vi.stubEnv("NATIVE_ACCOUNT_DELETION_ENABLED", "true");
    mocks.find.mockResolvedValue(undefined);
    mocks.prepare.mockResolvedValue(null);
    mocks.auth.mockResolvedValue({ userId: "user_test", has: () => true });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ onDuplicateKeyUpdate: mocks.save });
    mocks.save.mockResolvedValue({ rowsAffected: 1 });
  });
  it("preserves Clerk's verification hint through tRPC serialization", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_test", has: () => false });
    const response = await transport("POST");
    expect(response.status).toBe(200);
    const envelope = await response.json();
    expect(superjson.deserialize(envelope.result.data)).toMatchObject({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: ACCOUNT_DELETION_REVERIFICATION },
      },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects GET requests to the deletion mutation", async () => {
    expect((await transport("GET")).status).toBe(405);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects ordinary web requests", async () => {
    await expect(request(body, "Mozilla/5.0")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not mistake a forged shell marker for authentication", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(request(body, undefined, null)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("requires recent server-verified identity", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_test", has: () => false });
    expect(await request()).toMatchObject({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: ACCOUNT_DELETION_REVERIFICATION },
      },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, expectedUserId: "user_other" },
    { ...body, confirmation: "delete" },
    { ...body, understandsSubscriptions: false },
    { ...body, understandsPermanentLoss: false },
  ])("rejects incomplete or switched-account confirmation", async (input) => {
    await expect(request(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("refuses to enqueue when cleanup is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await request()).toMatchObject({ success: false });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("queues only after reverification succeeds on retry", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: "user_test", has: () => false });
    expect(await request()).toHaveProperty("clerk_error");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });
  it("only queues the authenticated identity, idempotently", async () => {
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.values).toHaveBeenCalledWith({
      userId: "user_test",
      appleRevokedSubject: null,
    });
    expect(mocks.save).toHaveBeenCalledWith({ set: { userId: "user_test" } });
  });
  it("does not report success after an enqueue failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await request()).toMatchObject({ success: false });
  });
  it("reuses a saved request without re-consuming an Apple authorization code", async () => {
    mocks.find.mockResolvedValueOnce({ userId: "user_test" });
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not enqueue when Apple ownership/revocation cannot be verified", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Apple unavailable"));
    expect(await request()).toMatchObject({ success: false });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
