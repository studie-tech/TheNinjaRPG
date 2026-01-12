# Implementation Plan: New Quest Objective Trackers (Issue #825)

## Overview

This plan outlines the implementation of 7 new quest objective tracker types for TheNinja-RPG's quest system. The objective system uses a pattern where:

1. Objective types are defined in `/app/src/validators/objectives.ts`
2. Objective tracking logic is implemented in `/app/src/libs/quest.ts` via `getNewTrackers()`
3. Quest validation and schemas handle the admin interface

---

## Requested Objective Types

| # | Type | Description |
|---|------|-------------|
| 1 | Craft Specific Item | Completed when player crafts a specific item |
| 2 | Number of Items Crafted | Tracks total number of items crafted |
| 3 | Creatures Hunted | Tracks creatures hunted for hunting job |
| 4 | Herbs Gathered | Tracks herbs gathered for gatherer job |
| 5 | Train Specific Jutsu | Completed when player trains a specific jutsu |
| 6 | Jutsus Trained | Completed once X jutsus are trained to level 1 |
| 7 | Complete Specific Quest | Completed when player completes a specific quest |

---

## Current Architecture Analysis

### How Objective Trackers Work

**SimpleTasks Pattern (Statistics-based)**: These auto-complete when a user statistic reaches a threshold. The `getNewTrackers()` function in `quest.ts` updates `status.value` based on user data, and the objective completes when `status.value >= objective.value`.

Example existing implementations:
- `user_level` - reads `user.level`
- `jutsus_mastered` - incremented when user learns new jutsu
- `crafting_experience_gained` - incremented when crafting completes

**LocationTasks Pattern**: These require user to be at a specific location and perform an action.

**Special Objectives Pattern**: Some objectives like `collect_item` and `deliver_item` track specific content IDs.

### Key Files to Modify

1. `/app/src/validators/objectives.ts` - Define new task types
2. `/app/src/libs/quest.ts` - Implement tracking logic in `getNewTrackers()`
3. `/app/src/server/api/routers/occupation.ts` - Hook crafting events
4. `/app/src/server/api/routers/jutsu.ts` - Hook jutsu training events
5. `/app/src/server/api/routers/quests.ts` - Hook quest completion events
6. `/app/drizzle/schema.ts` - Add tracking fields to userData if needed
7. `/app/src/hooks/quest.ts` - Update admin form for new objective types

---

## Detailed Implementation Plan

### 1. Craft Specific Item (`craft_specific_item`)

**Type**: Special objective requiring specific item ID

**Changes Required**:

1. **objectives.ts**: Add `craft_specific_item` to task types and create schema:
```typescript
export const CraftSpecificItemObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("craft_specific_item").default("craft_specific_item"),
  craftItemId: z.string().min(1, "Item ID required"),
  ...rewardFields,
});
```

2. **quest.ts** (`getNewTrackers`): Check if the objective's `craftItemId` matches the `contentId` passed in the task update.

3. **occupation.ts** (`craftItem`): After successful craft, call:
```typescript
const { trackers } = getNewTrackers(user, [
  { task: "craft_specific_item", contentId: input.itemId },
]);
```

**Tracking Method**: Event-based (triggered when craft completes)

---

### 2. Number of Items Crafted (`items_crafted`)

**Type**: Simple counter task

**Changes Required**:

1. **objectives.ts**: Add `"items_crafted"` to `SimpleTasks` array

2. **schema.ts** (userData): Add `itemsCrafted: int("itemsCrafted").default(0).notNull()` field to track total items crafted

3. **occupation.ts** (`craftItem`): Increment counter when crafting completes:
```typescript
await ctx.drizzle
  .update(userData)
  .set({ itemsCrafted: sql`${userData.itemsCrafted} + 1` })
```

4. **quest.ts** (`getNewTrackers`): Add handler:
```typescript
else if (task === "items_crafted") {
  status.value = user.itemsCrafted;
}
```

**Tracking Method**: Statistics-based (reads from user.itemsCrafted)

---

### 3. Creatures Hunted (`creatures_hunted`)

**Type**: Simple counter task for hunting job

**Changes Required**:

1. **objectives.ts**: Add `"creatures_hunted"` to `SimpleTasks` array

2. **schema.ts** (userData): Add `creaturesHunted: int("creaturesHunted").default(0).notNull()` field

3. **combat.ts** or relevant hunting router: Increment when a creature is defeated during hunting job:
```typescript
if (user.occupation === "HUNTER" && battleType === "HUNTING") {
  await ctx.drizzle
    .update(userData)
    .set({ creaturesHunted: sql`${userData.creaturesHunted} + 1` })
}
```

4. **quest.ts** (`getNewTrackers`): Add handler:
```typescript
else if (task === "creatures_hunted") {
  status.value = user.creaturesHunted;
}
```

**Note**: Need to verify how hunting battles are tracked/processed. The system may use random encounters for hunting.

**Tracking Method**: Statistics-based

---

### 4. Herbs Gathered (`herbs_gathered`)

**Type**: Simple counter task for gathering job

**Changes Required**:

1. **objectives.ts**: Add `"herbs_gathered"` to `SimpleTasks` array

2. **schema.ts** (userData): Add `herbsGathered: int("herbsGathered").default(0).notNull()` field

3. **Relevant gathering router/function**: Increment when herb is gathered:
```typescript
if (user.occupation === "GATHERING") {
  await ctx.drizzle
    .update(userData)
    .set({ herbsGathered: sql`${userData.herbsGathered} + ${quantity}` })
}
```

4. **quest.ts** (`getNewTrackers`): Add handler:
```typescript
else if (task === "herbs_gathered") {
  status.value = user.herbsGathered;
}
```

**Note**: Need to verify gathering mechanics implementation location.

**Tracking Method**: Statistics-based

---

### 5. Train Specific Jutsu (`train_specific_jutsu`)

**Type**: Special objective requiring specific jutsu ID

**Changes Required**:

1. **objectives.ts**: Add schema:
```typescript
export const TrainSpecificJutsuObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("train_specific_jutsu").default("train_specific_jutsu"),
  jutsuId: z.string().min(1, "Jutsu ID required"),
  minLevel: z.coerce.number().min(1).default(1), // Optional: require specific level
  ...rewardFields,
});
```

2. **quest.ts** (`getNewTrackers`): Check if user has trained the specified jutsu:
```typescript
else if (task === "train_specific_jutsu" && "jutsuId" in objective) {
  const userJutsu = user.userJutsus?.find(
    (uj) => uj.jutsuId === objective.jutsuId &&
    uj.level >= (objective.minLevel || 1)
  );
  if (userJutsu) {
    status.done = true;
  }
}
```

3. **jutsu.ts** (`startTraining`): After training completes, update trackers:
```typescript
const { trackers } = getNewTrackers(user, [
  { task: "train_specific_jutsu", contentId: input.jutsuId },
]);
```

**Tracking Method**: Combination of state check and event-based update

---

### 6. Jutsus Trained (`jutsus_trained_count`)

**Type**: Simple counter task

**Changes Required**:

1. **objectives.ts**: Add `"jutsus_trained_count"` to `SimpleTasks` array

2. **Note**: The system already has `jutsus_mastered` which tracks similar data. We may reuse existing logic or add a distinct counter.

3. **quest.ts** (`getNewTrackers`): Add handler that counts user jutsus at level >= 1:
```typescript
else if (task === "jutsus_trained_count") {
  const trainedJutsus = user.userJutsus?.filter((uj) => uj.level >= 1);
  status.value = trainedJutsus?.length || 0;
}
```

**Tracking Method**: Statistics-based (computed from user.userJutsus)

---

### 7. Complete Specific Quest (`complete_specific_quest`)

**Type**: Special objective requiring specific quest ID

**Changes Required**:

1. **objectives.ts**: Add schema:
```typescript
export const CompleteSpecificQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("complete_specific_quest").default("complete_specific_quest"),
  questId: z.string().min(1, "Quest ID required"),
  ...rewardFields,
});
```

2. **quest.ts** (`getNewTrackers`): Check if user has completed the specified quest:
```typescript
else if (task === "complete_specific_quest" && "questId" in objective) {
  const completedQuest = user.completedQuests?.find(
    (cq) => cq.questId === objective.questId && cq.completed === 1
  );
  if (completedQuest) {
    status.done = true;
  }
}
```

3. **quests.ts** (`checkRewards`): After quest completion, update trackers:
```typescript
const { trackers } = getNewTrackers(user, [
  { task: "complete_specific_quest", contentId: input.questId },
]);
```

**Tracking Method**: Combination of state check and event-based update

---

## Follow-Up Questions for Clarity

Before implementation, I need clarification on several points:

### 1. Creatures Hunted - Scope Definition
- **Question**: What constitutes a "creature" for hunting? Is it:
  - Any AI defeated during a hunting quest?
  - AI with specific tags/properties (e.g., marked as `isHuntingCreature`)?
  - Only defeats that award hunting experience?
- **Impact**: Determines where to hook the counter increment

### 2. Herbs Gathered - Scope Definition
- **Question**: What counts as a "herb" for gathering? Is it:
  - Any item with `canBeGathered = true`?
  - Items of a specific type (e.g., `itemType = "HERB"`)?
  - Only items gathered via gathering occupation mechanics?
- **Impact**: Determines filtering logic and where to hook the counter

### 3. Items Crafted - Count Method
- **Question**: Should this count:
  - Number of crafting operations completed?
  - Total quantity of items crafted (if crafting produces multiple)?
  - Both options configurable in the objective?
- **Impact**: Determines counter increment logic

### 4. Train Specific Jutsu - Level Requirement
- **Question**: Should this objective:
  - Complete when jutsu reaches level 1?
  - Allow staff to set a minimum level requirement (e.g., train jutsu X to level 5)?
  - Track progress toward the level (showing X/Y in tracker)?
- **Impact**: Schema design and tracking logic

### 5. Complete Specific Quest - Quest Types
- **Question**: Should this work with:
  - All quest types (missions, events, achievements, etc.)?
  - Only specific quest types (e.g., story quests)?
  - Require the quest to be newly completed (not previously)?
- **Impact**: Validation and completion detection logic

### 6. User Data Tracking Fields
- **Question**: For statistics-based objectives, do you prefer:
  - Adding new fields to `userData` table (requires migration)?
  - Computing values on-the-fly from related tables (slower but no schema change)?
  - Using the existing `questData` JSON field for per-quest counters?
- **Impact**: Database schema and migration requirements

### 7. Admin Interface Updates
- **Question**: Should the quest admin interface include:
  - Autocomplete/search for item/jutsu/quest selection?
  - Validation to ensure selected items/jutsus/quests exist?
  - Preview of the selected content?
- **Impact**: Frontend development scope

---

## Implementation Order (Suggested)

1. **Phase 1 - Statistics-Based (Simpler)**
   - Items Crafted (`items_crafted`)
   - Jutsus Trained (`jutsus_trained_count`)
   - Creatures Hunted (`creatures_hunted`)
   - Herbs Gathered (`herbs_gathered`)

2. **Phase 2 - Content-Specific (More Complex)**
   - Craft Specific Item (`craft_specific_item`)
   - Train Specific Jutsu (`train_specific_jutsu`)
   - Complete Specific Quest (`complete_specific_quest`)

3. **Phase 3 - Admin Interface Updates**
   - Add dropdowns/selectors for item, jutsu, quest selection
   - Add validation rules
   - Update documentation

---

## Database Migration Required

New fields to add to `userData` table:
```sql
ALTER TABLE userData
ADD COLUMN itemsCrafted INT DEFAULT 0 NOT NULL,
ADD COLUMN creaturesHunted INT DEFAULT 0 NOT NULL,
ADD COLUMN herbsGathered INT DEFAULT 0 NOT NULL;
```

---

## Testing Checklist

- [ ] Each new objective type can be created in admin interface
- [ ] Objective validation works correctly
- [ ] Tracker updates when relevant action is performed
- [ ] Objective completes when threshold/condition is met
- [ ] Rewards are granted on objective completion
- [ ] Edge cases handled (e.g., already completed before starting quest)
- [ ] Quest save/load with new objective types works
- [ ] No performance regression with new tracking logic

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration complexity | Medium | Medium | Test migration on staging first |
| Performance impact | Low | Medium | Use indexed fields, batch updates |
| Missing hook points | Medium | High | Thorough code review of all relevant routers |
| UI complexity | Low | Low | Reuse existing component patterns |

---

## Estimated Files Changed

- `/app/src/validators/objectives.ts` (new types)
- `/app/src/libs/quest.ts` (tracking logic)
- `/app/src/server/api/routers/occupation.ts` (crafting hooks)
- `/app/src/server/api/routers/jutsu.ts` (jutsu hooks)
- `/app/src/server/api/routers/quests.ts` (quest completion hooks)
- `/app/drizzle/schema.ts` (new userData fields)
- `/app/drizzle/migrations/*.sql` (migration file)
- `/app/src/hooks/quest.ts` (admin form updates)
