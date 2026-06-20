import { describe, expect, it } from "vitest";
import { buildClerkAuthHeaders } from "@/app/_trpc/authHeaders";

describe("buildClerkAuthHeaders", () => {
  it("returns a Bearer Authorization header when a token is present", () => {
    expect(buildClerkAuthHeaders("jwt-123")).toEqual({
      Authorization: "Bearer jwt-123",
    });
  });

  it("omits the Authorization header when there is no token (never sends 'Bearer null')", () => {
    expect(buildClerkAuthHeaders(null)).toEqual({});
    expect(buildClerkAuthHeaders(undefined)).toEqual({});
    expect(buildClerkAuthHeaders("")).toEqual({});
  });
});
