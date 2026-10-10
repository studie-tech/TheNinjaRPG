import { describe, expect, it } from "bun:test";
import { BOTID_BLOCKED_MESSAGE, BOTID_RELOAD_REQUIRED_MESSAGE } from "@/libs/botid";
import { isExpectedTrpcRouteError } from "@/server/utils/sentry";

const base = { message: "", userId: "user-1", method: "GET" };

describe("isExpectedTrpcRouteError", () => {
  it("ignores a POST to a query procedure, signed in or not", () => {
    // httpBatchLink GETs every query, so no first-party client sends this.
    for (const userId of ["user-1", null]) {
      expect(
        isExpectedTrpcRouteError({
          ...base,
          code: "METHOD_NOT_SUPPORTED",
          message: "Unsupported POST-request to query procedure at path \"profile.getUser\"",
          userId,
          method: "POST",
        }),
      ).toBe(true);
    }
  });

  it("ignores an anonymous GET against a mutation but reports a signed-in one", () => {
    const getMutation = { ...base, code: "METHOD_NOT_SUPPORTED", method: "GET" };
    expect(isExpectedTrpcRouteError({ ...getMutation, userId: null })).toBe(true);
    expect(isExpectedTrpcRouteError(getMutation)).toBe(false);
  });

  it("ignores only the session's own missing registration", () => {
    const notFound = { ...base, code: "NOT_FOUND" };
    expect(
      isExpectedTrpcRouteError({
        ...notFound,
        message: "User not found: user-1. Please complete registration.",
      }),
    ).toBe(true);
    expect(
      isExpectedTrpcRouteError({
        ...notFound,
        message: "User not found: user-2. Please complete registration.",
      }),
    ).toBe(false);
  });

  it("ignores auth and rate-limit rejections and reports everything else", () => {
    expect(isExpectedTrpcRouteError({ ...base, code: "UNAUTHORIZED" })).toBe(true);
    expect(isExpectedTrpcRouteError({ ...base, code: "TOO_MANY_REQUESTS" })).toBe(true);
    expect(isExpectedTrpcRouteError({ ...base, code: "INTERNAL_SERVER_ERROR" })).toBe(false);
    expect(isExpectedTrpcRouteError({ ...base, code: "BAD_REQUEST", method: "POST" })).toBe(
      false,
    );
  });

  it("ignores a BotID block, which is recorded with its verdict, but no other FORBIDDEN", () => {
    const forbidden = { ...base, code: "FORBIDDEN", method: "POST" };
    expect(isExpectedTrpcRouteError({ ...forbidden, message: BOTID_BLOCKED_MESSAGE })).toBe(
      true,
    );
    expect(isExpectedTrpcRouteError({ ...forbidden, message: "Not your clan" })).toBe(false);
  });

  it("ignores a protected mutation without a BotID challenge, but no other precondition", () => {
    const precondition = { ...base, code: "PRECONDITION_FAILED", method: "POST" };
    expect(
      isExpectedTrpcRouteError({ ...precondition, message: BOTID_RELOAD_REQUIRED_MESSAGE }),
    ).toBe(true);
    expect(isExpectedTrpcRouteError({ ...precondition, message: "Quest changed" })).toBe(
      false,
    );
  });
});
