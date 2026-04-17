# Boost Template Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly boost template system that automatically activates shrine boosts at fixed 2-hour UTC slots every week without manual rescheduling.

**Architecture:** The template is stored as three optional fields in the existing `village.shrineSettings` JSON column (no new tables, no migrations). The existing per-minute shrine-maintenance cron is extended to detect slot boundaries using `prevTime` and activate template slots merged with one-off schedule activations into a single per-village DB write. Two new tRPC endpoints expose get/set of the template. A `BoostTemplateGrid` sub-component in `ShrineHall.tsx` renders a 7×12 interactive grid.

**Tech Stack:** Next.js 15, tRPC, Drizzle ORM, MySQL (PlanetScale), Zod, Tailwind CSS, shadcn/ui (Badge, ToggleGroup, Popover, Button), Vitest

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `app/drizzle/schema.ts` | Extend `shrineSettings.$type<>()` with template fields |
| Create | `app/src/validators/shrine.ts` | Zod schemas for template entry and full template input |
| Modify | `app/src/utils/time.ts` | Add `getSlotIndex`, `getCurrentSlotBoundary`, `isNewSlotDue` |
| Create | `app/tests/utils/shrine-slot.test.ts` | Unit tests for slot utility functions |
| Modify | `app/src/app/api/shrine-maintenance/route.ts` | Fix `withUpdatedBoosts`, extend `runShrineBoostTick` with template activation |
| Create | `app/tests/app/api/shrine-maintenance/boost-template.test.ts` | Unit tests for template activation logic |
| Modify | `app/src/server/api/routers/shrine.ts` | Add `getBoostTemplate` and `setBoostTemplate` tRPC endpoints |
| Modify | `app/src/layout/ShrineHall.tsx` | Add `BoostTemplateGrid` sub-component and wire into `BoostsTab` |

---

## Task 1: Create Feature Branch

**Files:** none

- [ ] **Step 1: Create and switch to branch**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
git checkout -b feature/boost-template-scheduler
```

Expected: `Switched to a new branch 'feature/boost-template-scheduler'`

---

## Task 2: Extend Schema Type

**Files:**
- Modify: `app/drizzle/schema.ts:2870-2876`

No migration needed — MySQL JSON columns are schema-less. This is a TypeScript-only change.

- [ ] **Step 1: Update the `.$type<>()` on `shrineSettings`**

In `app/drizzle/schema.ts`, find the `shrineSettings` column definition (around line 2870) and replace:

```typescript
    shrineSettings: json("shrineSettings")
      .$type<{
        unlockedAiIds: string[];
        activeBoosts: Record<string, string>; // boost type -> expiry ISO string
        activeAiIds: string[];
      }>()
      .default({ unlockedAiIds: [], activeBoosts: {}, activeAiIds: [] })
      .notNull(),
```

With:

```typescript
    shrineSettings: json("shrineSettings")
      .$type<{
        unlockedAiIds: string[];
        activeBoosts: Record<string, string>; // boost type -> expiry ISO string
        activeAiIds: string[];
        boostTemplate?: Array<{
          boostType: string;
          dayOfWeek: number; // 0 = Sunday, 6 = Saturday (UTC)
          slotIndex: number; // 0–11, maps to hours 0–22 in steps of 2
        }>;
        boostTemplateUpdatedBy?: string; // userId of last editor
        boostTemplateUpdatedAt?: string; // ISO timestamp of last edit
      }>()
      .default({ unlockedAiIds: [], activeBoosts: {}, activeAiIds: [] })
      .notNull(),
```

- [ ] **Step 2: Run typecheck to confirm no regressions**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck
```

Expected: zero type errors.

- [ ] **Step 3: Commit**

```bash
git add app/drizzle/schema.ts
git commit -m "feat(shrine): extend shrineSettings type with boostTemplate fields"
```

---

## Task 3: Add Zod Validators

**Files:**
- Create: `app/src/validators/shrine.ts`

- [ ] **Step 1: Create the validator file**

Create `app/src/validators/shrine.ts`:

```typescript
import { z } from "zod";
import { SHRINE_BOOST_TYPES } from "@/drizzle/constants";

export const boostTemplateEntrySchema = z.object({
  boostType: z.enum(SHRINE_BOOST_TYPES),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday (UTC)
  slotIndex: z.number().int().min(0).max(11), // 0 = 00:00 UTC
});

export type BoostTemplateEntry = z.infer<typeof boostTemplateEntrySchema>;

export const boostTemplateSchema = z
  .array(boostTemplateEntrySchema)
  .max(168, "Template cannot exceed 168 entries")
  .refine(
    (entries) => {
      const keys = entries.map(
        (e) => `${e.boostType}:${e.dayOfWeek}:${e.slotIndex}`,
      );
      return keys.length === new Set(keys).size;
    },
    { message: "Duplicate (boostType, dayOfWeek, slotIndex) combinations are not allowed" },
  );
```

- [ ] **Step 2: Run typecheck**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/validators/shrine.ts
git commit -m "feat(shrine): add Zod validators for boost template"
```

---

## Task 4: Add Slot Utility Functions + Tests

**Files:**
- Modify: `app/src/utils/time.ts`
- Create: `app/tests/utils/shrine-slot.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `app/tests/utils/shrine-slot.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  getCurrentSlotBoundary,
  getSlotIndex,
  isNewSlotDue,
} from "@/utils/time";

describe("getSlotIndex", () => {
  it("maps hour 0 to slot 0", () => expect(getSlotIndex(0)).toBe(0));
  it("maps hour 1 to slot 0", () => expect(getSlotIndex(1)).toBe(0));
  it("maps hour 2 to slot 1", () => expect(getSlotIndex(2)).toBe(1));
  it("maps hour 3 to slot 1", () => expect(getSlotIndex(3)).toBe(1));
  it("maps hour 22 to slot 11", () => expect(getSlotIndex(22)).toBe(11));
  it("maps hour 23 to slot 11", () => expect(getSlotIndex(23)).toBe(11));
});

describe("getCurrentSlotBoundary", () => {
  it("returns start of current 2-hour slot", () => {
    const d = new Date("2026-04-16T05:30:00.000Z"); // 5:30 UTC = slot 2 boundary = 04:00
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T04:00:00.000Z");
  });

  it("returns same time when called exactly at a slot boundary", () => {
    const d = new Date("2026-04-16T04:00:00.000Z");
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T04:00:00.000Z");
  });

  it("handles midnight correctly (slot 0)", () => {
    const d = new Date("2026-04-16T00:45:00.000Z");
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T00:00:00.000Z");
  });
});

describe("isNewSlotDue", () => {
  it("returns true when slot boundary falls within (prevTime, now]", () => {
    const now = new Date("2026-04-16T04:00:30.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });

  it("returns true when cron fires exactly on the boundary", () => {
    const now = new Date("2026-04-16T04:00:00.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });

  it("returns false mid-slot (boundary is before prevTime)", () => {
    const now = new Date("2026-04-16T04:30:00.000Z");
    const prevTime = new Date("2026-04-16T04:05:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(false);
  });

  it("returns false when prevTime equals boundary (exclusive lower bound)", () => {
    const now = new Date("2026-04-16T04:01:00.000Z");
    const prevTime = new Date("2026-04-16T04:00:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(false);
  });

  it("returns true for a late cron that crossed the boundary", () => {
    // Cron was supposed to run at 04:00 but ran at 04:02
    const now = new Date("2026-04-16T04:02:00.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failures (functions don't exist yet)**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make test 2>&1 | grep -E "shrine-slot|FAIL|PASS"
```

Expected: test file fails with "getSlotIndex is not a function" or similar.

- [ ] **Step 3: Add the utility functions to `app/src/utils/time.ts`**

Append to the end of `app/src/utils/time.ts`:

```typescript
/**
 * Returns the slot index (0–11) for a given UTC hour.
 * Each slot covers a 2-hour window: slot 0 = 00:00–02:00, slot 11 = 22:00–00:00.
 */
export const getSlotIndex = (utcHour: number): number => Math.floor(utcHour / 2);

/**
 * Returns a Date set to the start of the 2-hour UTC slot containing `d`.
 * Minutes, seconds, and milliseconds are zeroed.
 */
export const getCurrentSlotBoundary = (d: Date = new Date()): Date => {
  const boundary = new Date(d);
  boundary.setUTCHours(Math.floor(d.getUTCHours() / 2) * 2, 0, 0, 0);
  return boundary;
};

/**
 * Returns true if a slot boundary falls in the half-open window (prevTime, now].
 * Use this in the cron to determine whether a new slot just started,
 * even if the cron fired slightly late.
 */
export const isNewSlotDue = (now: Date, prevTime: Date): boolean => {
  const boundary = getCurrentSlotBoundary(now);
  return boundary > prevTime && boundary <= now;
};
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make test 2>&1 | grep -E "shrine-slot|FAIL|PASS"
```

Expected: all 9 tests in `shrine-slot.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/time.ts app/tests/utils/shrine-slot.test.ts
git commit -m "feat(shrine): add slot boundary utility functions with tests"
```

---

## Task 5: Fix `withUpdatedBoosts` and Local Types in Cron

**Files:**
- Modify: `app/src/app/api/shrine-maintenance/route.ts:117-127, 336-345`

The current helper drops `boostTemplate`, `boostTemplateUpdatedBy`, and `boostTemplateUpdatedAt` on every cron write. Fix this before adding template activation.

- [ ] **Step 1: Update the local `ShrineSettings` type (line ~117)**

Find and replace:

```typescript
type ShrineSettings = {
  unlockedAiIds?: string[];
  activeBoosts?: Record<string, string>;
  activeAiIds?: string[];
};

type RequiredShrineSettings = {
  unlockedAiIds: string[];
  activeBoosts: Record<string, string>;
  activeAiIds: string[];
};
```

With:

```typescript
type BoostTemplateEntry = {
  boostType: string;
  dayOfWeek: number;
  slotIndex: number;
};

type ShrineSettings = {
  unlockedAiIds?: string[];
  activeBoosts?: Record<string, string>;
  activeAiIds?: string[];
  boostTemplate?: BoostTemplateEntry[];
  boostTemplateUpdatedBy?: string;
  boostTemplateUpdatedAt?: string;
};

type RequiredShrineSettings = {
  unlockedAiIds: string[];
  activeBoosts: Record<string, string>;
  activeAiIds: string[];
  boostTemplate: BoostTemplateEntry[];
  boostTemplateUpdatedBy?: string;
  boostTemplateUpdatedAt?: string;
};
```

- [ ] **Step 2: Update `withUpdatedBoosts` helper (line ~336)**

Find and replace:

```typescript
function withUpdatedBoosts(
  settings: ShrineSettings | null,
  activeBoosts: Record<string, string>,
): RequiredShrineSettings {
  return {
    unlockedAiIds: settings?.unlockedAiIds ?? [],
    activeBoosts,
    activeAiIds: settings?.activeAiIds ?? [],
  };
}
```

With:

```typescript
function withUpdatedBoosts(
  settings: ShrineSettings | null,
  activeBoosts: Record<string, string>,
): RequiredShrineSettings {
  return {
    unlockedAiIds: settings?.unlockedAiIds ?? [],
    activeBoosts,
    activeAiIds: settings?.activeAiIds ?? [],
    boostTemplate: settings?.boostTemplate ?? [],
    boostTemplateUpdatedBy: settings?.boostTemplateUpdatedBy,
    boostTemplateUpdatedAt: settings?.boostTemplateUpdatedAt,
  };
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/shrine-maintenance/route.ts
git commit -m "fix(shrine): preserve boostTemplate fields in withUpdatedBoosts helper"
```

---

## Task 6: Extend `runShrineBoostTick` with Template Activation + Tests

**Files:**
- Modify: `app/src/app/api/shrine-maintenance/route.ts`
- Create: `app/tests/app/api/shrine-maintenance/boost-template.test.ts`

This is the core cron extension. Template activations are merged into the existing per-village pass so each village gets exactly one `UPDATE` write per tick.

- [ ] **Step 1: Write failing tests**

Create `app/tests/app/api/shrine-maintenance/boost-template.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  computeTemplateActivations,
  type TemplateActivationInput,
} from "@/app/api/shrine-maintenance/route";

const makeVillage = (
  id: string,
  tokens: number,
  template: Array<{ boostType: string; dayOfWeek: number; slotIndex: number }>,
  activeBoosts: Record<string, string> = {},
): TemplateActivationInput => ({
  id,
  tokens,
  shrineSettings: {
    unlockedAiIds: [],
    activeBoosts,
    activeAiIds: [],
    boostTemplate: template,
  },
});

describe("computeTemplateActivations", () => {
  const COST = 15_000;
  // Wednesday 2026-04-16 04:00:00 UTC → dayOfWeek=3, slotIndex=2
  const now = new Date("2026-04-16T04:00:30.000Z");
  const prevTime = new Date("2026-04-16T03:59:00.000Z");

  it("activates a matching template entry", () => {
    const villages = [makeVillage("v1", 100_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 2 }])];
    const level3VillageIds = new Set(["v1"]);
    const result = computeTemplateActivations(villages, level3VillageIds, now, prevTime, COST, 2);
    expect(result.get("v1")).toEqual({ Training: expect.stringContaining("Z") });
  });

  it("skips when boost is already active", () => {
    const future = new Date(now.getTime() + 3_600_000).toISOString();
    const villages = [makeVillage("v1", 100_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 2 }], { Training: future })];
    const level3VillageIds = new Set(["v1"]);
    const result = computeTemplateActivations(villages, level3VillageIds, now, prevTime, COST, 2);
    expect(result.get("v1")).toBeUndefined();
  });

  it("skips when no Level 3 shrine", () => {
    const villages = [makeVillage("v1", 100_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 2 }])];
    const result = computeTemplateActivations(villages, new Set(), now, prevTime, COST, 2);
    expect(result.get("v1")).toBeUndefined();
  });

  it("skips when insufficient tokens for any boost", () => {
    const villages = [makeVillage("v1", 5_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 2 }])];
    const level3VillageIds = new Set(["v1"]);
    const result = computeTemplateActivations(villages, level3VillageIds, now, prevTime, COST, 2);
    expect(result.get("v1")).toBeUndefined();
  });

  it("activates boosts in alphabetical order when partially affordable", () => {
    // Tokens for exactly 1 boost; 2 types match this slot
    const villages = [
      makeVillage("v1", 15_000, [
        { boostType: "Training", dayOfWeek: 3, slotIndex: 2 },
        { boostType: "PVP", dayOfWeek: 3, slotIndex: 2 },
      ]),
    ];
    const level3VillageIds = new Set(["v1"]);
    const result = computeTemplateActivations(villages, level3VillageIds, now, prevTime, COST, 2);
    const activated = result.get("v1");
    // Alphabetically PVP < Training; PVP should be activated, Training skipped
    expect(activated).toBeDefined();
    expect(Object.keys(activated!)).toEqual(["PVP"]);
    expect(activated!["Training"]).toBeUndefined();
  });

  it("returns empty map when not at a slot boundary", () => {
    const midSlotNow = new Date("2026-04-16T04:30:00.000Z");
    const midSlotPrev = new Date("2026-04-16T04:25:00.000Z");
    const villages = [makeVillage("v1", 100_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 2 }])];
    const result = computeTemplateActivations(villages, new Set(["v1"]), midSlotNow, midSlotPrev, COST, 2);
    expect(result.size).toBe(0);
  });

  it("does not activate entries for a different day or slot", () => {
    const villages = [makeVillage("v1", 100_000, [{ boostType: "Training", dayOfWeek: 3, slotIndex: 5 }])];
    const level3VillageIds = new Set(["v1"]);
    const result = computeTemplateActivations(villages, level3VillageIds, now, prevTime, COST, 2);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make test 2>&1 | grep -E "boost-template|FAIL|PASS"
```

Expected: FAIL — `computeTemplateActivations` not exported.

- [ ] **Step 3: Add imports and types to `route.ts`**

At the top of `app/src/app/api/shrine-maintenance/route.ts`, add these imports:

```typescript
import { gte, isNotNull } from "drizzle-orm";
import { getCurrentSlotBoundary, isNewSlotDue, secondsFromDate } from "@/utils/time";
import { SHRINE_BOOST_COST, SHRINE_BOOST_DURATION_HOURS } from "@/drizzle/constants";
```

Note: `gte` and `isNotNull` may already be imported — check the existing import line and add only what's missing.

Also add the export type near the top of the file (after the `ShrineMaintenanceDb` type):

```typescript
export type TemplateActivationInput = {
  id: string;
  tokens: number;
  shrineSettings: ShrineSettings | null;
};
```

- [ ] **Step 4: Add the pure `computeTemplateActivations` function**

Add this function to `route.ts` (before `runShrineBoostTick`):

```typescript
/**
 * Pure function — computes which template boost types should be activated this tick.
 * Returns a Map<villageId, Record<boostType, expiryISOString>> for villages with
 * at least one activation due. Villages with no activations are absent from the map.
 *
 * Activation criteria (all must hold):
 * - A slot boundary fell in (prevTime, now]
 * - The template entry matches current UTC dayOfWeek + slotIndex
 * - The village has a Level 3 shrine
 * - The boost type is not already active
 * - Partial affordability: boost types sorted alphabetically, activated in order
 *   until tokens run out
 */
export function computeTemplateActivations(
  villages: TemplateActivationInput[],
  level3VillageIds: Set<string>,
  now: Date,
  prevTime: Date,
  boostCost: number,
  boostDurationHours: number,
): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();

  if (!isNewSlotDue(now, prevTime)) return result;

  const slotBoundary = getCurrentSlotBoundary(now);
  const currentDayOfWeek = slotBoundary.getUTCDay();
  const currentSlotIndex = Math.floor(slotBoundary.getUTCHours() / 2);
  const boostExpiry = secondsFromDate(boostDurationHours * 60 * 60, now).toISOString();

  for (const village of villages) {
    const template = village.shrineSettings?.boostTemplate;
    if (!template || template.length === 0) continue;
    if (!level3VillageIds.has(village.id)) continue;

    const matchingEntries = template
      .filter(
        (e) => e.dayOfWeek === currentDayOfWeek && e.slotIndex === currentSlotIndex,
      )
      .sort((a, b) => a.boostType.localeCompare(b.boostType)); // alphabetical for partial funding

    if (matchingEntries.length === 0) continue;

    const activeBoosts = village.shrineSettings?.activeBoosts ?? {};
    let remainingTokens = village.tokens;
    const toActivate: Record<string, string> = {};

    for (const entry of matchingEntries) {
      const currentExpiry = activeBoosts[entry.boostType];
      if (currentExpiry && new Date(currentExpiry) > now) continue; // already active
      if (remainingTokens < boostCost) break; // can't afford any more
      toActivate[entry.boostType] = boostExpiry;
      remainingTokens -= boostCost;
    }

    if (Object.keys(toActivate).length > 0) {
      result.set(village.id, toActivate);
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests — expect passing**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make test 2>&1 | grep -E "boost-template|FAIL|PASS"
```

Expected: all 7 tests pass.

- [ ] **Step 6: Extend `runShrineBoostTick` to use template activations**

In `route.ts`, update `runShrineBoostTick` to:
1. Accept `prevTime` as a parameter
2. Fetch village `tokens` alongside `shrineSettings`
3. Fetch `level3VillageIds` in the existing `Promise.all`
4. Merge template activations into the existing per-village loop
5. Include token deduction in the village UPDATE when template boosts are activated

Replace the entire `runShrineBoostTick` function with:

```typescript
async function runShrineBoostTick(now: Date = new Date(), prevTime: Date = new Date(0)) {
  // Fetch all data in parallel — template check adds level3Sectors, no extra round-trip
  const [activeSchedules, expiredSchedules, allVillages, level3Sectors] = await Promise.all([
    drizzleDB
      .select()
      .from(shrineBoostSchedule)
      .where(
        and(lte(shrineBoostSchedule.startAt, now), gt(shrineBoostSchedule.endAt, now)),
      ),
    drizzleDB
      .select()
      .from(shrineBoostSchedule)
      .where(lte(shrineBoostSchedule.endAt, now)),
    drizzleDB.query.village.findMany({
      columns: { id: true, tokens: true, shrineSettings: true },
    }),
    drizzleDB
      .selectDistinct({ villageId: sector.villageId })
      .from(sector)
      .where(and(eq(sector.shrineLevel, 3), isNotNull(sector.villageId))),
  ]);

  const level3VillageIds = new Set(
    level3Sectors.map((s) => s.villageId).filter((id): id is string => id !== null),
  );

  const villageMap = new Map(
    allVillages.map((v) => [v.id, v.shrineSettings as ShrineSettings | null]),
  );
  const villageTokenMap = new Map(allVillages.map((v) => [v.id, v.tokens]));

  // --- One-off scheduled boosts (existing logic) ---
  const latestActiveByKey = new Map<
    string,
    { villageId: string; boostType: string; endAt: Date }
  >();
  for (const schedule of activeSchedules) {
    const key = `${schedule.villageId}:${schedule.boostType}`;
    const existing = latestActiveByKey.get(key);
    if (!existing || schedule.endAt > existing.endAt) {
      latestActiveByKey.set(key, {
        villageId: schedule.villageId,
        boostType: schedule.boostType,
        endAt: schedule.endAt,
      });
    }
  }

  const expiredByVillage = new Map<string, Set<string>>();
  for (const schedule of expiredSchedules) {
    const settings = villageMap.get(schedule.villageId);
    const storedEndAt = settings?.activeBoosts?.[schedule.boostType];
    if (!storedEndAt) continue;
    const storedEndAtMs = Date.parse(storedEndAt);
    if (!Number.isFinite(storedEndAtMs) || storedEndAtMs > now.getTime()) continue;
    if (!expiredByVillage.has(schedule.villageId)) {
      expiredByVillage.set(schedule.villageId, new Set());
    }
    expiredByVillage.get(schedule.villageId)?.add(schedule.boostType);
  }

  // --- Template activations (new logic) ---
  const templateActivations = computeTemplateActivations(
    allVillages as TemplateActivationInput[],
    level3VillageIds,
    now,
    prevTime,
    SHRINE_BOOST_COST,
    SHRINE_BOOST_DURATION_HOURS,
  );

  // --- Merge all affected village IDs ---
  const allAffectedVillageIds = new Set([
    ...[...latestActiveByKey.values()].map((v) => v.villageId),
    ...expiredByVillage.keys(),
    ...templateActivations.keys(),
  ]);

  let activeUpdated = 0;
  let templateActivated = 0;
  const villageUpdates: Promise<unknown>[] = [];

  for (const villageId of allAffectedVillageIds) {
    const settings = villageMap.get(villageId);
    const currentBoosts = { ...(settings?.activeBoosts ?? {}) };
    let hasChanges = false;

    // Remove expired boosts
    const expired = expiredByVillage.get(villageId);
    if (expired) {
      for (const boostType of expired) {
        if (boostType in currentBoosts) {
          delete currentBoosts[boostType];
          hasChanges = true;
        }
      }
    }

    // Apply one-off scheduled boosts
    for (const { villageId: vid, boostType, endAt } of latestActiveByKey.values()) {
      if (vid !== villageId) continue;
      const newEndAt = endAt.toISOString();
      if (currentBoosts[boostType] !== newEndAt) {
        currentBoosts[boostType] = newEndAt;
        hasChanges = true;
        activeUpdated++;
      }
    }

    // Apply template activations — merged into the same write
    const templateBoosts = templateActivations.get(villageId);
    if (templateBoosts) {
      const templateTokenCost = Object.keys(templateBoosts).length * SHRINE_BOOST_COST;
      for (const [boostType, expiry] of Object.entries(templateBoosts)) {
        currentBoosts[boostType] = expiry;
        hasChanges = true;
        templateActivated++;
      }

      if (hasChanges) {
        // Single UPDATE with token deduction guard for template activations
        villageUpdates.push(
          drizzleDB
            .update(village)
            .set({
              tokens: sql`${village.tokens} - ${templateTokenCost}`,
              shrineSettings: withUpdatedBoosts(settings ?? null, currentBoosts),
            })
            .where(
              and(
                eq(village.id, villageId),
                gte(village.tokens, templateTokenCost),
              ),
            ),
        );
        continue; // skip the no-token update below
      }
    }

    if (hasChanges) {
      villageUpdates.push(
        drizzleDB
          .update(village)
          .set({
            shrineSettings: withUpdatedBoosts(settings ?? null, currentBoosts),
          })
          .where(eq(village.id, villageId)),
      );
    }
  }

  // Delete expired schedule records
  type ScheduleType = (typeof expiredSchedules)[number];
  const expiredScheduleIds = expiredSchedules.map((s: ScheduleType) => s.id);
  const deleteExpired =
    expiredScheduleIds.length > 0
      ? drizzleDB
          .delete(shrineBoostSchedule)
          .where(inArray(shrineBoostSchedule.id, expiredScheduleIds))
      : Promise.resolve();

  await Promise.all([...villageUpdates, deleteExpired]);

  return { activeUpdated, expiredDeleted: expiredScheduleIds.length, templateActivated };
}
```

- [ ] **Step 7: Update the `GET` handler to pass `prevTime` to `runShrineBoostTick`**

In the `GET` function, find:

```typescript
    const [boostResult, staleLobbyResult] = await Promise.all([
      runShrineBoostTick(now),
      runStaleShrineLobbyCleanup(now),
    ]);
```

Replace with:

```typescript
    const [boostResult, staleLobbyResult] = await Promise.all([
      runShrineBoostTick(now, minuteCheck.prevTime),
      runStaleShrineLobbyCleanup(now),
    ]);
```

- [ ] **Step 8: Update the response message to include `templateActivated`**

Find:

```typescript
      : `Shrine boost tick completed: ${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired; stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset)`;
```

Replace with:

```typescript
      : `Shrine boost tick completed: ${boostResult.activeUpdated} scheduled activated, ${boostResult.templateActivated} template activated, ${boostResult.expiredDeleted} expired; stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset)`;
```

- [ ] **Step 9: Run typecheck + tests**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck && make test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add app/src/app/api/shrine-maintenance/route.ts app/tests/app/api/shrine-maintenance/boost-template.test.ts
git commit -m "feat(shrine): extend boost tick cron with weekly template activation"
```

---

## Task 7: Add tRPC Endpoints

**Files:**
- Modify: `app/src/server/api/routers/shrine.ts`

Two new endpoints: `getBoostTemplate` (query) and `setBoostTemplate` (mutation).

- [ ] **Step 1: Add import for the new validator**

At the top of `app/src/server/api/routers/shrine.ts`, add:

```typescript
import { boostTemplateSchema } from "@/validators/shrine";
```

- [ ] **Step 2: Add `getBoostTemplate` query**

After the `getScheduledBoosts` query (around line 127), insert:

```typescript
  // Get the boost template for a village
  getBoostTemplate: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get the weekly boost template for a village" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      if (user.villageId !== input.villageId && !canSeeSecretData(user.role)) {
        throw serverError("FORBIDDEN", "You can only view the boost template for your own village");
      }

      const result = await ctx.drizzle.query.village.findFirst({
        where: eq(village.id, input.villageId),
        columns: { shrineSettings: true },
      });

      const settings = result?.shrineSettings;
      return {
        template: settings?.boostTemplate ?? [],
        updatedBy: settings?.boostTemplateUpdatedBy ?? null,
        updatedAt: settings?.boostTemplateUpdatedAt ?? null,
      };
    }),
```

- [ ] **Step 3: Add `setBoostTemplate` mutation**

After `getBoostTemplate`, insert:

```typescript
  // Save the weekly boost template for a village (Kage or Elder only)
  setBoostTemplate: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Save the weekly boost template for a village" } })
    .input(
      z.object({
        villageId: z.string(),
        template: boostTemplateSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, level3Shrines] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.sector.findMany({
          where: and(eq(sector.villageId, input.villageId), eq(sector.shrineLevel, 3)),
        }),
      ]);

      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only set the boost template for your own village");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId && user.rank !== "ELDER") {
        return errorResponse("Only the Kage or Elders can set the boost template");
      }
      if (level3Shrines.length === 0) {
        return errorResponse("Need at least one Level 3 shrine to use the boost template");
      }

      await ctx.drizzle
        .update(village)
        .set({
          shrineSettings: {
            ...user.village.shrineSettings,
            boostTemplate: input.template,
            boostTemplateUpdatedBy: ctx.userId,
            boostTemplateUpdatedAt: new Date().toISOString(),
          },
        })
        .where(eq(village.id, input.villageId));

      return {
        success: true,
        message:
          input.template.length === 0
            ? "Boost template cleared"
            : `Boost template saved with ${input.template.length} slot${input.template.length === 1 ? "" : "s"}`,
      };
    }),
```

- [ ] **Step 4: Run typecheck**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/server/api/routers/shrine.ts app/src/validators/shrine.ts
git commit -m "feat(shrine): add getBoostTemplate and setBoostTemplate tRPC endpoints"
```

---

## Task 8: Build the `BoostTemplateGrid` UI

**Files:**
- Modify: `app/src/layout/ShrineHall.tsx`

Add a `BoostTemplateGrid` sub-component at the bottom of the file (below the main exported component and all existing sub-components, per codebase convention). Wire it into `BoostsTab`.

- [ ] **Step 1: Add import for new tRPC mutation**

In `ShrineHall.tsx`, `api.shrine.setBoostTemplate` and `api.shrine.getBoostTemplate` are called via the existing `api` import — no new import needed.

Add `RepeatClock` or `CalendarDays` to the lucide imports at the top:

```typescript
import { AlertTriangle, CalendarClock, CalendarDays, Clock, Coins, Shield, X } from "lucide-react";
```

Also add `BoostTemplateEntry` type import from validators:

```typescript
import type { BoostTemplateEntry } from "@/validators/shrine";
```

- [ ] **Step 2: Add template query + mutation to `BoostsTab`**

Inside `BoostsTab` (the component starting around line 302), add these hooks **before** the existing early return (after `isElder`):

```typescript
  const { data: templateData, isLoading: isTemplateLoading } =
    api.shrine.getBoostTemplate.useQuery(
      { villageId: user.villageId || "" },
      { enabled: isActive && !!user.villageId },
    );

  const { mutate: saveTemplate, isPending: isSavingTemplate } =
    api.shrine.setBoostTemplate.useMutation({
      onSuccess: (res) => {
        showMutationToast(res);
        if (res.success) void utils.shrine.getBoostTemplate.invalidate();
      },
    });

  const [localTemplate, setLocalTemplate] = useState<BoostTemplateEntry[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Sync server template into local state when loaded
  useEffect(() => {
    if (templateData?.template) {
      setLocalTemplate(templateData.template);
    }
  }, [templateData?.template]);
```

- [ ] **Step 3: Add template grid card at bottom of `BoostsTab` JSX**

Inside the return of `BoostsTab`, after the existing "Activate or Schedule a Boost" card closing `</Card>` tag, add:

```tsx
      {user.villageId && (isKage || isElder) && (
        <BoostTemplateGrid
          villageId={user.villageId}
          localTemplate={localTemplate}
          setLocalTemplate={setLocalTemplate}
          onSave={() =>
            saveTemplate({ villageId: user.villageId!, template: localTemplate })
          }
          onClear={() => setShowClearConfirm(true)}
          isSaving={isSavingTemplate}
          isLoading={isTemplateLoading}
          updatedBy={templateData?.updatedBy ?? null}
          updatedAt={templateData?.updatedAt ?? null}
          showClearConfirm={showClearConfirm}
          setShowClearConfirm={setShowClearConfirm}
          onConfirmClear={() => {
            setLocalTemplate([]);
            setShowClearConfirm(false);
            saveTemplate({ villageId: user.villageId!, template: [] });
          }}
        />
      )}
```

- [ ] **Step 4: Add `BoostTemplateGrid` sub-component at bottom of file**

Append at the end of `app/src/layout/ShrineHall.tsx` (after all existing sub-components):

```tsx
/* -------------------------------------------------------------------------- */
/* BoostTemplateGrid                                                           */
/* -------------------------------------------------------------------------- */

const BOOST_COLORS: Record<string, string> = {
  Training: "bg-blue-500 text-white",
  PVP: "bg-red-500 text-white",
  Mission: "bg-yellow-500 text-black",
  Errands: "bg-green-500 text-white",
  Crafting: "bg-purple-500 text-white",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOTS = Array.from({ length: 12 }, (_, i) => {
  const h = String(i * 2).padStart(2, "0");
  return `${h}:00`;
});

interface BoostTemplateGridProps {
  villageId: string;
  localTemplate: BoostTemplateEntry[];
  setLocalTemplate: (t: BoostTemplateEntry[]) => void;
  onSave: () => void;
  onClear: () => void;
  isSaving: boolean;
  isLoading: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  showClearConfirm: boolean;
  setShowClearConfirm: (v: boolean) => void;
  onConfirmClear: () => void;
}

const BoostTemplateGrid = ({
  localTemplate,
  setLocalTemplate,
  onSave,
  onClear,
  isSaving,
  isLoading,
  updatedBy,
  updatedAt,
  showClearConfirm,
  setShowClearConfirm,
  onConfirmClear,
}: BoostTemplateGridProps) => {
  const now = new Date();
  const currentDayOfWeek = now.getUTCDay();
  const currentSlotIndex = Math.floor(now.getUTCHours() / 2);

  const cellKey = (dayOfWeek: number, slotIndex: number) =>
    `${dayOfWeek}:${slotIndex}`;

  const templateMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of localTemplate) {
      const key = cellKey(entry.dayOfWeek, entry.slotIndex);
      const existing = map.get(key) ?? [];
      map.set(key, [...existing, entry.boostType]);
    }
    return map;
  }, [localTemplate]);

  const toggleBoostInCell = (dayOfWeek: number, slotIndex: number, boostType: string) => {
    const key = cellKey(dayOfWeek, slotIndex);
    const cellTypes = templateMap.get(key) ?? [];
    const exists = cellTypes.includes(boostType);
    if (exists) {
      setLocalTemplate(
        localTemplate.filter(
          (e) =>
            !(e.dayOfWeek === dayOfWeek && e.slotIndex === slotIndex && e.boostType === boostType),
        ),
      );
    } else {
      setLocalTemplate([...localTemplate, { boostType, dayOfWeek, slotIndex }]);
    }
  };

  if (isLoading) return <Loader explanation="Loading boost template" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          Weekly Boost Template
        </CardTitle>
        <CardDescription>
          Set which boosts auto-activate each week. Tokens are charged at activation
          time. All times are UTC.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Legend */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(BOOST_COLORS).map(([type, cls]) => (
            <Badge key={type} className={cn("text-xs", cls)}>
              {type}
            </Badge>
          ))}
        </div>

        {/* Grid — horizontally scrollable on small screens */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left text-muted-foreground">UTC</th>
                {DAYS.map((d) => (
                  <th key={d} className="p-1 text-center font-medium">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((label, slotIndex) => (
                <tr key={slotIndex} className="border-t">
                  <td className="w-12 p-1 text-muted-foreground">{label}</td>
                  {DAYS.map((_, dayOfWeek) => {
                    const key = cellKey(dayOfWeek, slotIndex);
                    const types = templateMap.get(key) ?? [];
                    const isCurrent =
                      dayOfWeek === currentDayOfWeek && slotIndex === currentSlotIndex;

                    return (
                      <td key={dayOfWeek} className="p-0.5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "min-h-8 w-full rounded p-1 text-left transition-colors hover:bg-muted/60",
                                types.length === 0 && "bg-muted/20",
                                isCurrent && "ring-2 ring-primary ring-offset-1",
                              )}
                            >
                              <div className="flex flex-wrap gap-0.5">
                                {types.map((t) => (
                                  <Badge
                                    key={t}
                                    className={cn("h-4 px-1 text-[10px]", BOOST_COLORS[t])}
                                  >
                                    {t.slice(0, 3)}
                                  </Badge>
                                ))}
                              </div>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-44 p-2" align="center">
                            <p className="mb-2 text-muted-foreground text-xs">
                              {DAYS[dayOfWeek]} {label} UTC
                            </p>
                            <div className="space-y-1">
                              {Object.keys(BOOST_COLORS).map((boostType) => {
                                const active = types.includes(boostType);
                                return (
                                  <button
                                    key={boostType}
                                    type="button"
                                    onClick={() =>
                                      toggleBoostInCell(dayOfWeek, slotIndex, boostType)
                                    }
                                    className={cn(
                                      "flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors",
                                      active
                                        ? cn(BOOST_COLORS[boostType], "opacity-90")
                                        : "bg-muted/30 hover:bg-muted/60",
                                    )}
                                  >
                                    {boostType}
                                    {active && <X className="h-3 w-3" />}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer: last modified + controls */}
        {(updatedBy ?? updatedAt) && (
          <p className="text-muted-foreground text-xs">
            Last updated by {updatedBy ?? "unknown"}{" "}
            {updatedAt ? `on ${formatDateTimeShort(new Date(updatedAt))}` : ""}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={isSaving} size="sm">
            {isSaving ? "Saving…" : "Save Template"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={isSaving || localTemplate.length === 0}
          >
            Clear All
          </Button>
        </div>

        {/* Inline clear confirmation */}
        {showClearConfirm && (
          <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="flex-1">Clear all template slots?</span>
            <Button size="sm" variant="destructive" onClick={onConfirmClear}>
              Yes, clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 5: Run typecheck**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck
```

Expected: zero errors.

- [ ] **Step 6: Run linter**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make lint
```

Fix any issues reported by biome, then re-run.

- [ ] **Step 7: Commit**

```bash
git add app/src/layout/ShrineHall.tsx
git commit -m "feat(shrine): add BoostTemplateGrid UI to ShrineHall boosts tab"
```

---

## Task 9: Final Validation

- [ ] **Step 1: Run all checks**

```bash
cd /c/Users/Midni/Documents/Work/TheNinjaRPG
make typecheck && make lint && make test
```

Expected: zero errors, zero lint warnings, all tests pass.

- [ ] **Step 2: Verify `computeTemplateActivations` is exported (needed by tests)**

```bash
grep -n "export function computeTemplateActivations" app/src/app/api/shrine-maintenance/route.ts
```

Expected: one match.

- [ ] **Step 3: Verify no `MAX_BOOSTS_PER_SHRINE` references were changed**

```bash
grep -n "MAX_BOOSTS_PER_SHRINE" app/src/server/api/routers/shrine.ts
```

Expected: only the existing manual scheduling guards reference it (lines referencing `scheduleBoost`) — not any new code.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(shrine): weekly boost template scheduler — complete implementation"
```
