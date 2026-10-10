
import { beforeEach, expect, it } from "bun:test";
import { abEvent, userData } from "@/drizzle/schema";
import { WALLPAPER_EXPERIMENT } from "@/libs/wallpaperExperiment";
import { dataRouter } from "@/routers/data";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("wallpaper analytics first-visit cohorts", () => {
  beforeEach(async () => {
    await resetTables(abEvent, userData);
    await insertUsers([{ userId: "analyst", role: "OWNER" }]);
  });

  it("joins later completions to the selected date, source, variant and exposure device", async () => {
    const database = await getTestDatabase();
    const event = {
      experiment: WALLPAPER_EXPERIMENT, variant: "control", event: "loaded",
      source: "campaign", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
      createdAt: new Date("2026-10-02T23:59:59.000Z"),
    };
    await database.insert(abEvent).values([
      { ...event, id: "visit", ipHash: "matched" },
      { ...event, id: "completion", ipHash: "matched", event: "success", userAgent: "iPhone", createdAt: new Date("2026-10-03T12:00:00.000Z") },
      { ...event, id: "outside-date", ipHash: "old", createdAt: new Date("2026-10-01T12:00:00.000Z") },
      { ...event, id: "outside-date-success", ipHash: "old", event: "success" },
      { ...event, id: "outside-source", ipHash: "other-source", source: "other" },
      { ...event, id: "outside-source-success", ipHash: "other-source", source: "other", event: "success" },
      { ...event, id: "other-variant", ipHash: "mismatch", variant: "summer" },
      { ...event, id: "wrong-variant-success", ipHash: "mismatch", variant: "winter", event: "success" },
    ]);
    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({ startDate: "2026-10-02", endDate: "2026-10-02", utmSource: "campaign", deviceType: ["desktop"] });
    const arms = result.find((experiment) => experiment.experiment === WALLPAPER_EXPERIMENT)?.variants;
    expect(arms?.find((arm) => arm.variant === "control")).toEqual({ variant: "control", loaded: 1, register: 1 });
    expect(arms?.find((arm) => arm.variant === "summer")).toEqual({ variant: "summer", loaded: 1, register: 0 });
    expect(arms?.find((arm) => arm.variant === "winter")).toEqual({ variant: "winter", loaded: 0, register: 0 });
    expect(await caller.getAbTests({ startDate: "2026-10-02", endDate: "2026-10-02", deviceType: ["mobile"] })).toEqual([]);
  });
});
