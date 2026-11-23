import { afterEach, expect, it } from "bun:test";
import {
  characterStorageKey,
  resetCharacterPresentation,
} from "@/hooks/useActivityDock";

afterEach(() => localStorage.clear());

it("clears every presentation key of the account and keeps other accounts' keys", () => {
  const names = [
    "activityDockOpen",
    "activityDockTab",
    "activityDockAttention",
    "activityPinnedQuests",
    "expressTrialsDeclined",
  ] as const;
  for (const name of names) {
    localStorage.setItem(characterStorageKey(name, "u1"), "true");
    localStorage.setItem(characterStorageKey(name, "u2"), "true");
  }
  resetCharacterPresentation("u1");
  for (const name of names) {
    expect(localStorage.getItem(characterStorageKey(name, "u1"))).toBeNull();
    expect(localStorage.getItem(characterStorageKey(name, "u2"))).toBe("true");
  }
});
