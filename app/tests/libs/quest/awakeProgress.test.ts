import { describe, expect, it } from "bun:test";
import { UserStatuses } from "@/drizzle/constants";
import {
  missionHallStartBlockedMessage,
  questProgressBlockedMessage,
} from "@/libs/quest/missionHall";

describe("awake-only quest actions", () => {
  it("explains every non-awake status that hides dialog and reward actions", () => {
    expect(questProgressBlockedMessage("AWAKE")).toBeNull();
    expect(questProgressBlockedMessage(undefined)).toBeNull();
    for (const status of UserStatuses.filter((entry) => entry !== "AWAKE")) {
      expect(questProgressBlockedMessage(status)).toEqual(
        expect.stringContaining("continue this quest"),
      );
    }
    expect(questProgressBlockedMessage("ASLEEP")).toContain("Wake up");
  });

  it("blocks only daily Mission Hall assignments while not awake", () => {
    for (const type of [
      "mission",
      "crime",
      "errand",
      "medical",
      "pvp",
      "war",
    ] as const) {
      expect(missionHallStartBlockedMessage(type, "AWAKE")).toBeNull();
      expect(missionHallStartBlockedMessage(type, "ASLEEP")).toContain("asleep");
    }
    for (const type of ["story", "event", "achievement", "hunting"] as const) {
      expect(missionHallStartBlockedMessage(type, "ASLEEP")).toBeNull();
    }
  });
});
