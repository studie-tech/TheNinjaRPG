import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { abEvent, userData } from "@/drizzle/schema";
import { WALLPAPER_EXPERIMENT } from "@/libs/wallpaperExperiment";
import { dataRouter } from "@/routers/data";
import { WEEK_S } from "@/utils/time";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const now = new Date("2026-10-25T12:00:00.000Z");
const visit = {
  experiment: WALLPAPER_EXPERIMENT,
  variant: "control",
  event: "loaded",
  source: "campaign",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
};

describeWithDatabase("experiment analytics activity and first-visit cohorts", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(abEvent, userData);
    await insertUsers([{ userId: "analyst", role: "OWNER" }]);
  });

  afterEach(() => {
    setSystemTime();
  });

  it("includes all historical variants, visits and completions of active tests", async () => {
    const database = await getTestDatabase();
    await database.insert(abEvent).values([
      { ...visit, id: "old-control", ipHash: "control" },
      {
        ...visit,
        id: "later-completion",
        ipHash: "control",
        event: "success",
        createdAt: now,
      },
      { ...visit, id: "old-summer", ipHash: "summer", variant: "summer" },
      {
        ...visit,
        id: "old-summer-completion",
        ipHash: "summer",
        variant: "summer",
        event: "success",
      },
      { ...visit, id: "recent-control", ipHash: "recent", createdAt: now },
    ]);

    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({});
    const arms = result[0]?.variants;
    expect(result).toHaveLength(1);
    expect(arms?.find((arm) => arm.variant === "control")).toEqual({
      variant: "control",
      loaded: 2,
      register: 1,
    });
    expect(arms?.find((arm) => arm.variant === "summer")).toEqual({
      variant: "summer",
      loaded: 1,
      register: 1,
    });
  });

  it("uses any event within the last seven days to select tests, including the cutoff", async () => {
    const database = await getTestDatabase();
    const cutoff = new Date(now.getTime() - WEEK_S * 1000);
    await database.insert(abEvent).values([
      {
        ...visit,
        id: "boundary",
        ipHash: "boundary",
        experiment: "boundary-test",
        createdAt: cutoff,
      },
      {
        ...visit,
        id: "expired",
        ipHash: "expired",
        experiment: "expired-test",
        createdAt: new Date(cutoff.getTime() - 1),
      },
      { ...visit, id: "old", ipHash: "old", experiment: "completed-test" },
      {
        ...visit,
        id: "recent-success",
        ipHash: "old",
        experiment: "completed-test",
        event: "success",
        createdAt: now,
      },
    ]);

    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({});
    expect(result.map((test) => test.experiment).sort()).toEqual([
      "boundary-test",
      "completed-test",
    ]);
    expect(
      result.find((test) => test.experiment === "completed-test")?.variants,
    ).toEqual([{ variant: "control", loaded: 1, register: 1 }]);
  });

  it("preserves source, variant and exposure-device cohorts across the full test history", async () => {
    const database = await getTestDatabase();
    await database.insert(abEvent).values([
      { ...visit, id: "visit", ipHash: "matched" },
      {
        ...visit,
        id: "completion",
        ipHash: "matched",
        event: "success",
        source: "other",
        userAgent: "iPhone",
        createdAt: now,
      },
      { ...visit, id: "outside-source", ipHash: "other-source", source: "other" },
      {
        ...visit,
        id: "outside-source-success",
        ipHash: "other-source",
        source: "other",
        event: "success",
      },
      { ...visit, id: "other-variant", ipHash: "mismatch", variant: "summer" },
      {
        ...visit,
        id: "wrong-variant-success",
        ipHash: "mismatch",
        variant: "winter",
        event: "success",
      },
    ]);

    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({
      utmSource: "campaign",
      deviceType: ["desktop"],
    });
    const arms = result[0]?.variants;
    expect(arms?.find((arm) => arm.variant === "control")).toEqual({
      variant: "control",
      loaded: 1,
      register: 1,
    });
    expect(arms?.find((arm) => arm.variant === "summer")).toEqual({
      variant: "summer",
      loaded: 1,
      register: 0,
    });
    expect(arms?.find((arm) => arm.variant === "winter")).toEqual({
      variant: "winter",
      loaded: 0,
      register: 0,
    });
    expect(await caller.getAbTests({ deviceType: ["mobile"] })).toEqual([]);
  });

  it("returns no tests when all activity is older than a week", async () => {
    const database = await getTestDatabase();
    await database.insert(abEvent).values({ ...visit, id: "old-visit", ipHash: "old" });

    const caller = await callerFor(dataRouter, "analyst");
    expect(await caller.getAbTests({})).toEqual([]);
  });

  it("weights repeated user-agent cohorts and preserves case-sensitive device classification", async () => {
    const database = await getTestDatabase();
    const cohorts = [
      { userAgent: visit.userAgent, loaded: 3, register: 2 },
      { userAgent: "Macintosh", loaded: 2, register: 1 },
      { userAgent: "iPhone", loaded: 4, register: 3 },
      { userAgent: "iphone", loaded: 2, register: 1 },
      { userAgent: null, loaded: 1, register: 0 },
      { userAgent: "", loaded: 1, register: 1 },
    ];
    for (const [index, cohort] of cohorts.entries()) {
      const exposures = Array.from({ length: cohort.loaded }, (_, visitor) => ({
        ...visit,
        id: `cohort-${index}-${visitor}`,
        ipHash: `cohort-${index}-${visitor}`,
        userAgent: cohort.userAgent,
        createdAt: now,
      }));
      await database.insert(abEvent).values([
        ...exposures,
        ...exposures.slice(0, cohort.register).map((row) => ({
          ...row,
          id: `${row.id}-success`,
          event: "success",
          userAgent: "completion on another device",
        })),
      ]);
    }

    const caller = await callerFor(dataRouter, "analyst");
    for (const [deviceType, loaded, register] of [
      [[], 13, 8],
      [["desktop"], 5, 3],
      [["mobile"], 4, 3],
      [["unknown"], 4, 2],
      [["mobile", "desktop"], 9, 6],
    ] as const) {
      const result = await caller.getAbTests({ deviceType: [...deviceType] });
      expect(result[0]?.variants.find((arm) => arm.variant === "control")).toEqual({
        variant: "control",
        loaded,
        register,
      });
    }
  });

  it("keeps experiment and variant names distinct by case", async () => {
    const database = await getTestDatabase();
    await database.insert(abEvent).values([
      {
        ...visit,
        id: "uppercase-visit",
        ipHash: "uppercase",
        experiment: "Case-test",
        variant: "Arm",
        createdAt: now,
      },
      {
        ...visit,
        id: "uppercase-success",
        ipHash: "uppercase",
        experiment: "Case-test",
        variant: "Arm",
        event: "success",
        createdAt: now,
      },
      {
        ...visit,
        id: "lowercase-arm",
        ipHash: "lowercase-arm",
        experiment: "Case-test",
        variant: "arm",
        createdAt: now,
      },
      {
        ...visit,
        id: "lowercase-test",
        ipHash: "lowercase-test",
        experiment: "case-test",
        variant: "Arm",
        createdAt: now,
      },
    ]);

    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({});
    expect(result).toHaveLength(2);
    expect(result.find((test) => test.experiment === "Case-test")?.variants).toEqual(
      expect.arrayContaining([
        { variant: "Arm", loaded: 1, register: 1 },
        { variant: "arm", loaded: 1, register: 0 },
      ]),
    );
    expect(
      result.find((test) => test.experiment === "Case-test")?.variants,
    ).toHaveLength(2);
    expect(result.find((test) => test.experiment === "case-test")?.variants).toEqual([
      { variant: "Arm", loaded: 1, register: 0 },
    ]);
  });

  it("counts anonymous exposures without attributing null or empty IP completions or empty completion IDs", async () => {
    const database = await getTestDatabase();
    await database.insert(abEvent).values([
      { ...visit, id: "null-visit-1", ipHash: null, createdAt: now },
      { ...visit, id: "null-visit-2", ipHash: null, createdAt: now },
      { ...visit, id: "null-success", ipHash: null, event: "success" },
      { ...visit, id: "empty-ip-visit", ipHash: "", createdAt: now },
      { ...visit, id: "empty-ip-success", ipHash: "", event: "success" },
      { ...visit, id: "empty-id-visit", ipHash: "empty-id", createdAt: now },
      { ...visit, id: "", ipHash: "empty-id", event: "success" },
      { ...visit, id: "truthy-visit", ipHash: "0", createdAt: now },
      { ...visit, id: "0", ipHash: "0", event: "success" },
    ]);

    const caller = await callerFor(dataRouter, "analyst");
    const result = await caller.getAbTests({});
    expect(result[0]?.variants.find((arm) => arm.variant === "control")).toEqual({
      variant: "control",
      loaded: 5,
      register: 1,
    });
  });
});
