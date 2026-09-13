import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clerk from "@clerk/nextjs/server";
import * as nextServer from "next/server";
import * as processor from "../process";
import * as apple from "../apple";
import {
  stubDatabase,
  resetServerModuleStubs,
} from "../../../../../tests/setup/serverModules";
import type { z } from "zod";
import { accountDeletionRouter } from "@/server/api/routers/accountDeletion";
import { drizzleDB } from "@/server/db";
import type { accountDeletionSchema } from "@/validators/accountDeletion";
import { ACCOUNT_DELETION_REVERIFICATION } from "@/validators/accountDeletion";

const originalEnv = { ...process.env };


const mocks = {
  auth: vi.fn(),
  after: vi.fn(),
  process: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  prepare: vi.fn(),
};


afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

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
    vi.spyOn(clerk, "auth").mockImplementation(mocks.auth);
    vi.spyOn(nextServer, "after").mockImplementation(mocks.after);
    vi.spyOn(processor, "processAccountDeletions").mockImplementation(mocks.process);
    vi.spyOn(apple, "prepareAppleDeletion").mockImplementation(mocks.prepare);
    stubDatabase({
      insert: mocks.insert,
      query: { accountDeletion: { findFirst: mocks.find } },
    });
    process.env["CRON_SECRET"] = "test-worker-secret";
    process.env["NATIVE_ACCOUNT_DELETION_ENABLED"] = "true";
    mocks.find.mockResolvedValue(undefined);
    mocks.process.mockResolvedValue({ processed: 1, failed: 0 });
    mocks.prepare.mockResolvedValue({ subject: null });
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
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects ordinary web requests", async () => {
    expect(await request(body, "Mozilla/5.0")).toEqual({
      success: false,
      message: "Use the native app to request account deletion.",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not mistake a forged shell marker for authentication", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(request(body, undefined, null)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
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
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("returns a recoverable response for switched-account confirmation", async () => {
    expect(await request({ ...body, expectedUserId: "user_other" })).toEqual({
      success: false,
      message: "Your signed-in account changed. Close this dialog and start again.",
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("returns a recoverable response when the Clerk session changes", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: "user_other" });
    expect(await request()).toMatchObject({
      success: false,
      message: "Your session changed. Sign in again to continue.",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, confirmation: "delete" },
    { ...body, understandsSubscriptions: false },
    { ...body, understandsPermanentLoss: false },
  ])("rejects malformed confirmation", async (input) => {
    await expect(request(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("refuses to enqueue when cleanup is not configured", async () => {
    process.env["CRON_SECRET"] = "";
    expect(await request()).toMatchObject({ success: false });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("queues only after reverification succeeds on retry", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: "user_test", has: () => false });
    expect(await request()).toHaveProperty("clerk_error");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });
  it("starts only the saved account after returning acceptance", async () => {
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.process).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]?.[0]();
    expect(mocks.process).toHaveBeenCalledWith("user_test");
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
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("reuses a saved request without re-consuming an Apple authorization code", async () => {
    mocks.find.mockResolvedValueOnce({ userId: "user_test" });
    expect(await request()).toMatchObject({ success: true });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
  });
  it("does not enqueue when Apple ownership/revocation cannot be verified", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Apple unavailable"));
    expect(await request()).toMatchObject({ success: false });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each([
    "Please use the latest iPhone app and verify with Apple to delete this Apple-linked account.",
    "Verify with the Apple account linked to this game account.",
    "Apple verification expired. Please try again and approve the Apple sign-in sheet.",
  ])("shows the expected Apple recovery message: %s", async (message) => {
    mocks.prepare.mockResolvedValueOnce({ error: message });
    expect(await request()).toEqual({ success: false, message });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not expose unexpected provider errors", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("private provider details"));
    expect(await request()).toEqual({
      success: false,
      message:
        "We could not save your request. Nothing has been confirmed; please try again.",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
