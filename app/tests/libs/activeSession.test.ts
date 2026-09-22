import { describe, expect, it } from "vitest";
import { activeSessionKey } from "@/libs/activeSession";

describe("activeSessionKey", () => {
  it("keeps the hydrated tree for the session clerk-js reports first", () => {
    expect(activeSessionKey({ sessionId: "sess_a", firstSessionId: "sess_a" })).toBe(
      "initial",
    );
    expect(activeSessionKey({ sessionId: null, firstSessionId: null })).toBe("initial");
  });

  it("rebuilds on a switch to another account, and back", () => {
    expect(activeSessionKey({ sessionId: "sess_b", firstSessionId: "sess_a" })).toBe(
      "sess_b",
    );
    expect(activeSessionKey({ sessionId: "sess_a", firstSessionId: "sess_a" })).toBe(
      "initial",
    );
  });

  it("rebuilds on sign-out and on a sign-in after loading signed out", () => {
    expect(activeSessionKey({ sessionId: null, firstSessionId: "sess_a" })).toBe(
      "signed-out",
    );
    expect(activeSessionKey({ sessionId: "sess_a", firstSessionId: null })).toBe(
      "sess_a",
    );
  });
});
