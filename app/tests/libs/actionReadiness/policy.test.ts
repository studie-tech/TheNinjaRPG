import { describe, expect, it } from "bun:test";
import { UserStatuses } from "@/drizzle/constants";
import { actionStatusMessage, canAttemptAwakeAction } from "@/libs/actionReadiness";

describe("character action readiness", () => {
  it("names the actual status and keeps other players distinct", () => {
    expect(actionStatusMessage("HOSPITALIZED")).toBe(
      "You are in the hospital. Check out before taking this action.",
    );
    expect(actionStatusMessage("ASLEEP")).toContain("asleep");
    expect(actionStatusMessage("BATTLE")).toContain("in battle");
    expect(actionStatusMessage("TRAVEL")).toContain("traveling");
    expect(actionStatusMessage("QUEUED")).toContain("queued");
    expect(actionStatusMessage("HOSPITALIZED", "Opponent")).toStartWith(
      "Opponent is in the hospital",
    );
  });
  it("lets recovery-capable clicks reach the server without allowing other activities", () => {
    for (const status of UserStatuses) {
      expect(canAttemptAwakeAction({ status, autoWakeUp: true })).toBe(
        ["AWAKE", "ASLEEP", "HOSPITALIZED"].includes(status),
      );
    }
    expect(canAttemptAwakeAction({ status: "ASLEEP", autoWakeUp: false })).toBe(false);
    expect(canAttemptAwakeAction({ status: "HOSPITALIZED", autoWakeUp: false })).toBe(
      true,
    );
    expect(canAttemptAwakeAction(undefined)).toBe(false);
  });
});
