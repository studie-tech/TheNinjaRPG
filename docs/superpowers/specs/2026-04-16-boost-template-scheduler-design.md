# Boost Template Scheduler Design

**Date:** 2026-04-16  
**Status:** Approved for implementation planning

---

## Overview

Replace the current manual per-occurrence boost scheduling flow with a weekly template system. Elders and the Kage set a weekly grid of boost slots once; the system fires those boosts automatically on a rolling basis. No need to reschedule every week.

---

## Goals

- Elders set a weekly boost template using an intuitive 7-day × 12-slot grid
- Boosts activate automatically every week from the template without manual action
- Tokens are charged at activation time (not upfront)
- Template persists until explicitly changed
- Zero new DB tables; zero schema migrations required
- No increase in cron DB query count

## Non-Goals

- Replacing the existing manual one-off `ShrineBoostSchedule` flow — it stays unchanged
- Per-activation audit log (only last-modified-by is tracked)
- Fractional or arbitrary time slots (slots are fixed 2-hour UTC windows only)

---

## Slot System

A day is divided into **12 fixed 2-hour UTC slots**:

| Slot Index | UTC Window        |
|------------|-------------------|
| 0          | 00:00 – 02:00     |
| 1          | 02:00 – 04:00     |
| 2          | 04:00 – 06:00     |
| 3          | 06:00 – 08:00     |
| 4          | 08:00 – 10:00     |
| 5          | 10:00 – 12:00     |
| 6          | 12:00 – 14:00     |
| 7          | 14:00 – 16:00     |
| 8          | 16:00 – 18:00     |
| 9          | 18:00 – 20:00     |
| 10         | 20:00 – 22:00     |
| 11         | 22:00 – 00:00     |

`dayOfWeek` follows JavaScript convention: 0 = Sunday, 1 = Monday … 6 = Saturday (UTC).

Each slot entry in the template is: `{ boostType, dayOfWeek, slotIndex }`.

All 5 boost types (Training, PVP, Mission, Errands, Crafting) can run simultaneously within the same slot — they are independent.

---

## Data Model

No new tables. No migrations. The `village.shrineSettings` JSON column is extended with three optional fields:

```typescript
// schema.ts — extend .$type<>() on shrineSettings
{
  unlockedAiIds: string[];
  activeBoosts: Record<string, string>;      // unchanged
  activeAiIds: string[];                     // unchanged
  boostTemplate?: Array<{
    boostType: string;
    dayOfWeek: number;   // 0–6, UTC
    slotIndex: number;   // 0–11
  }>;
  boostTemplateUpdatedBy?: string;           // userId of last editor
  boostTemplateUpdatedAt?: string;           // ISO timestamp of last edit
}
```

MySQL JSON columns are schema-less — adding new optional fields requires no migration file.

### Constraints stored in the template

- Max **168 entries** per template (2 fully-loaded boost types across all 84 weekly slots, covers typical heavy usage without allowing the full 420-entry theoretical max)
- One entry per `(boostType, dayOfWeek, slotIndex)` combination — duplicates rejected server-side
- Template may be empty (all slots cleared)
- `dayOfWeek` follows JS/UTC convention: **0 = Sunday, 6 = Saturday** — pinned in Zod schema and shown as "Sun–Sat" in the grid UI header

---

## Activation Logic (Cron)

The `shrine-maintenance` cron already runs every minute and already fetches `village.shrineSettings` for all villages. The template check adds **zero extra queries**.

### How a template slot fires

Each cron tick:

1. Compute current UTC `dayOfWeek` and `slotIndex` from `new Date()`
2. For each village with a non-empty `boostTemplate`:
   - Find all template entries where `entry.dayOfWeek === currentDayOfWeek && entry.slotIndex === currentSlotIndex`
   - For each matching entry (boost type):
     - **Skip** if the boost type is already active in `activeBoosts` with an expiry in the future
     - **Skip** if village has no Level 3 shrine (checked against pre-fetched sector data)
     - **Skip** if village tokens < `SHRINE_BOOST_COST`
     - Otherwise: deduct tokens, set `activeBoosts[boostType]` expiry to `now + SHRINE_BOOST_DURATION_HOURS`

### Only fires at slot boundaries — robust window detection

A slot boundary is detected by comparing the **previous cron timestamp** (`prevTime` returned by `lockWithMinuteTimer`) against `now`. A slot fires if any slot boundary falls in the half-open window `(prevTime, now]`:

```typescript
function getSlotKey(d: Date): string {
  // "dayOfWeek:slotIndex" — uniquely identifies a 2-hour window
  return `${d.getUTCDay()}:${Math.floor(d.getUTCHours() / 2)}`;
}
// Slot is due if the boundary minute (slotIndex * 2 hours, minute 0)
// falls inside (prevTime, now]
const slotBoundary = new Date(now);
slotBoundary.setUTCMinutes(0, 0, 0);
const isDue = slotBoundary > prevTime && slotBoundary <= now;
```

This means a slightly late cron (cold-start, Vercel delay) still fires the slot correctly rather than silently losing it.

### Deduplication guard

`activeBoosts[boostType]` already holds the expiry ISO string. The "skip if already active" check is the deduplication guard — if a cron tick fires twice near a boundary, the second tick sees the boost active and skips, no double-charge.

### Merged into existing per-village cron pass

Template activation is **not** a separate cron pass. It runs inside the existing `runShrineBoostTick` per-village loop (`allAffectedVillageIds`), so:
- One village fetch per tick (already in place)
- All `activeBoosts` mutations (from one-off schedules AND template slots) for a village are **collapsed into a single `UPDATE village` write** — preventing the second write from clobbering the first
- Both writers always see fresh state from the same snapshot taken at tick start

### Token deduction

Uses the existing atomic DB-guard pattern:
```typescript
await drizzle.update(village)
  .set({
    tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
    shrineSettings: { ...settings, activeBoosts: updatedBoosts }
  })
  .where(and(
    eq(village.id, villageId),
    gte(village.tokens, SHRINE_BOOST_COST)
  ));
```
`rowsAffected === 0` means insufficient tokens — slot silently skips.

---

## `withUpdatedBoosts` Helper — Must Preserve Template Fields

The existing `withUpdatedBoosts()` helper in `shrine-maintenance/route.ts` reconstructs `shrineSettings` as `{ unlockedAiIds, activeBoosts, activeAiIds }` only. It **must** be updated to pass through the new template fields:

```typescript
function withUpdatedBoosts(
  settings: ShrineSettings | null,
  activeBoosts: Record<string, string>,
): RequiredShrineSettings {
  return {
    unlockedAiIds: settings?.unlockedAiIds ?? [],
    activeBoosts,
    activeAiIds: settings?.activeAiIds ?? [],
    // preserve template fields — do not drop them on every cron write
    boostTemplate: settings?.boostTemplate ?? [],
    boostTemplateUpdatedBy: settings?.boostTemplateUpdatedBy,
    boostTemplateUpdatedAt: settings?.boostTemplateUpdatedAt,
  };
}
```

The `ShrineSettings` and `RequiredShrineSettings` local types in `route.ts` must also include these three fields.

---

## tRPC Endpoints

Two new endpoints in `shrine.ts`:

### `shrine.setBoostTemplate` (mutation)

- **Auth:** Kage or Elder only, must belong to the village
- **Input:** `{ villageId: string, template: Array<{ boostType, dayOfWeek, slotIndex }> }`
- **Validation:**
  - Max 60 entries
  - No duplicate `(boostType, dayOfWeek, slotIndex)` combinations
  - `boostType` must be in `SHRINE_BOOST_TYPES`
  - `dayOfWeek` 0–6, `slotIndex` 0–11
  - Village must have at least one Level 3 shrine
- **Action:** Overwrites `shrineSettings.boostTemplate`, sets `boostTemplateUpdatedBy` and `boostTemplateUpdatedAt`
- **Returns:** `baseServerResponse`

### `shrine.getBoostTemplate` (query)

- **Auth:** Village members only (same guard as `getScheduledBoosts`)
- **Input:** `{ villageId: string }`
- **Returns:** Current `boostTemplate` array + `boostTemplateUpdatedBy` + `boostTemplateUpdatedAt`

---

## UI Design

Located in `ShrineHall.tsx` → **Boosts tab**, new sub-section below the existing "Activate or Schedule a Boost" card.

### Weekly Grid

A 7-column (Sun–Sat) × 12-row (00:00–22:00) grid. Each cell represents one `(dayOfWeek, slotIndex)` pair and can hold up to 5 boost types simultaneously.

**Cell states:**
- Empty: muted background, click to open boost type selector
- Filled: shows colored Badges for assigned boost types (one color per type), click to remove or change

**Boost type colors (Tailwind):**

| Boost Type | Color class               |
|------------|---------------------------|
| Training   | `bg-blue-500`             |
| PVP        | `bg-red-500`              |
| Mission    | `bg-yellow-500`           |
| Errands    | `bg-green-500`            |
| Crafting   | `bg-purple-500`           |

**Interaction:** Clicking an empty cell opens a small popover with ToggleGroup of boost types to add. Clicking a filled badge removes that boost type from that cell.

### Template Controls

- **Save Template** button — calls `setBoostTemplate` with current grid state
- **Clear All** button — empties the grid (requires confirmation)
- Last modified line: "Last updated by [username] on [date]"

### Current Slot Highlight

The cell matching the current UTC day + slot is highlighted with a ring so Elders can orient themselves.

---

## Edge Cases & Guardrails

| Scenario | Behaviour |
|---|---|
| Boost already active when slot fires | Skip, no charge — existing expiry takes precedence |
| Village has no Level 3 shrine at fire time | Skip silently |
| Insufficient tokens at fire time | Skip silently — no retry. If village has tokens for only some matching boost types, activate in alphabetical order by `boostType` until tokens run out |
| Template changed while a slot is mid-window | New template takes effect on next slot boundary only |
| Manual one-off schedule overlaps a template slot | Both are independent; first to activate wins, second sees boost already active and skips |
| Village disbands / loses shrine between template save and fire | Cron eligibility check at fire time, not at save time |
| Two template entries for same (boostType, dayOfWeek, slotIndex) | Rejected server-side with validation error |
| Template entry count > 60 | Rejected server-side |
| Cron fires twice in boundary minute | Second tick skips — deduplication via `activeBoosts` expiry check |

---

## What Is NOT Changing

- `ShrineBoostSchedule` table — untouched
- Manual `activateBoost`, `scheduleBoost`, `cancelScheduledBoost` endpoints — untouched
- Existing `runShrineBoostTick` function — extended, not replaced
- `MAX_BOOSTS_PER_SHRINE` constant — applies to manual schedules only, not the template
- Token refund logic — not applicable to template activations (pay-on-trigger only)
