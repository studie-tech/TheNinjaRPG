# Stealth and Sensory Feature Implementation Plan

## Overview

This document outlines the implementation plan for adding Stealth and Sensory as trainable player stats that enable covert operations and detection mechanics in TheNinja-RPG.

## Feature Requirements Summary

### Stealth Stat
- **Default Value**: 1,000
- **Cap**: 20,000
- **Base Benefits**:
  - Stay stealthed for 1 minute
  - 5% chance to perform actions without breaking stealth
- **Scaling (per 1,000 points)**:
  - +1 minute stealth duration
  - +2.75% chance to keep stealth when acting (caps at ~57.25% at 20,000)

### Sensory Stat
- **Default Value**: 1,000
- **Cap**: 20,000
- **Base Benefits**:
  - 5% chance to find stealthed players
  - 2 minute cooldown between sensory uses
- **Scaling (per 1,000 points)**:
  - +2.75% detection chance (caps at 60% at 20,000)
  - -5 seconds cooldown (from 120s down to 25s at 20,000)

### UI Locations
- **Stats Display**: User profile menu under stats with "Train" buttons
- **Stealth Toggle**: Travel page
- **Sensory Button**: Scouting view

---

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Add New Fields to `userData` Table

**File**: `/app/drizzle/schema.ts` (around line 1947)

Add after `bukijutsuOffence`:
```typescript
stealth: double("stealth").default(1000).notNull(),
sensory: double("sensory").default(1000).notNull(),
stealthActive: boolean("stealthActive").default(false).notNull(),
stealthActivatedAt: datetime("stealthActivatedAt", { mode: "date", fsp: 3 }),
lastSensoryAt: datetime("lastSensoryAt", { mode: "date", fsp: 3 }),
```

#### 1.2 Add Constants

**File**: `/app/drizzle/constants.ts`

Add new constants:
```typescript
// Stealth & Sensory Stat System
export const STEALTH_SENSORY_CAP = 20000;
export const STEALTH_SENSORY_DEFAULT = 1000;

// Stealth mechanics
export const STEALTH_BASE_DURATION_SECONDS = 60; // 1 minute
export const STEALTH_DURATION_PER_1000_POINTS = 60; // +1 minute per 1000 points
export const STEALTH_BASE_KEEP_CHANCE_PERC = 5; // 5% base
export const STEALTH_KEEP_CHANCE_PER_1000_POINTS = 2.75; // +2.75% per 1000 points

// Sensory mechanics
export const SENSORY_BASE_DETECT_CHANCE_PERC = 5; // 5% base
export const SENSORY_DETECT_CHANCE_PER_1000_POINTS = 2.75; // +2.75% per 1000 points
export const SENSORY_MAX_DETECT_CHANCE_PERC = 60; // 60% cap
export const SENSORY_BASE_COOLDOWN_SECONDS = 120; // 2 minutes
export const SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS = 5; // -5 seconds per 1000 points
```

#### 1.3 Add to `UserStatNames` Enum

**File**: `/app/drizzle/constants.ts` (line 405-418)

Add to the array:
```typescript
export const UserStatNames = [
  // ... existing stats ...
  "stealth",
  "sensory",
] as const;
```

#### 1.4 Generate Migration

Run: `make makemigrations`

---

### Phase 2: Backend API Endpoints

#### 2.1 Create New Router: `stealth.ts`

**File**: `/app/src/server/api/routers/stealth.ts`

Endpoints:
1. `activateStealth` - Mutation to toggle stealth on
2. `deactivateStealth` - Mutation to toggle stealth off
3. `useSensory` - Mutation to scan for stealthed players in current sector
4. `getStealthStatus` - Query to get current stealth state

```typescript
// Key logic functions:

// Calculate stealth duration based on stat
const calcStealthDuration = (stealthStat: number) => {
  const points = Math.min(stealthStat, STEALTH_SENSORY_CAP);
  const intervals = Math.floor(points / 1000);
  return STEALTH_BASE_DURATION_SECONDS + (intervals * STEALTH_DURATION_PER_1000_POINTS);
};

// Calculate chance to keep stealth when performing action
const calcStealthKeepChance = (stealthStat: number) => {
  const points = Math.min(stealthStat, STEALTH_SENSORY_CAP);
  const intervals = Math.floor(points / 1000);
  return STEALTH_BASE_KEEP_CHANCE_PERC + (intervals * STEALTH_KEEP_CHANCE_PER_1000_POINTS);
};

// Calculate sensory detection chance
const calcSensoryDetectChance = (sensoryStat: number) => {
  const points = Math.min(sensoryStat, STEALTH_SENSORY_CAP);
  const intervals = Math.floor(points / 1000);
  const chance = SENSORY_BASE_DETECT_CHANCE_PERC + (intervals * SENSORY_DETECT_CHANCE_PER_1000_POINTS);
  return Math.min(chance, SENSORY_MAX_DETECT_CHANCE_PERC);
};

// Calculate sensory cooldown
const calcSensoryCooldown = (sensoryStat: number) => {
  const points = Math.min(sensoryStat, STEALTH_SENSORY_CAP);
  const intervals = Math.floor(points / 1000);
  return Math.max(25, SENSORY_BASE_COOLDOWN_SECONDS - (intervals * SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS));
};
```

#### 2.2 Register Router in Root

**File**: `/app/src/server/api/root.ts`

Add import and register the new router.

#### 2.3 Modify `travel.ts` Router

**File**: `/app/src/server/api/routers/travel.ts`

Modifications needed:
1. `getSectorData` - Filter out stealthed players from other villages (unless sensed)
2. `robPlayer` - Check if attacker breaks stealth
3. `moveInSector` - Handle stealth visibility for village protector encounters

#### 2.4 Modify `train.ts` Router

**File**: `/app/src/server/api/routers/train.ts`

The training system already uses the `UserStatNames` enum, so adding "stealth" and "sensory" to the enum should automatically enable training. However, we need to update the `stopTraining` mutation to handle the new stats:

```typescript
// Add in the SQL update section:
stealth:
  user.currentlyTraining === "stealth"
    ? sql`stealth + ${trainingAmount}`
    : sql`stealth`,
sensory:
  user.currentlyTraining === "sensory"
    ? sql`sensory + ${trainingAmount}`
    : sql`sensory`,
```

---

### Phase 3: Frontend Components

#### 3.1 Update `StrengthWeaknesses.tsx`

**File**: `/app/src/layout/StrengthWeaknesses.tsx`

Add Stealth and Sensory stats to the `StatsTab` component:
```tsx
<div className="pt-2">
  <b>Covert Operations</b>
  <div className="flex flex-row items-center">
    <ElementImage element="Stealth" className="w-6 h-6 mr-1 mb-1" />
    Stealth: {Number(userData.stealth.toFixed(2)).toLocaleString()} / 20,000
    <TrainButton stat="stealth" />
  </div>
  <div className="flex flex-row items-center">
    <ElementImage element="Sensory" className="w-6 h-6 mr-1 mb-1" />
    Sensory: {Number(userData.sensory.toFixed(2)).toLocaleString()} / 20,000
    <TrainButton stat="sensory" />
  </div>
</div>
```

Update the info popover to explain Stealth and Sensory stats.

#### 3.2 Update Travel Page

**File**: `/app/src/app/travel/page.tsx`

Add stealth toggle button in the top right content area:
```tsx
{/* Stealth Toggle */}
{activeTab === sectorLink && (
  <TooltipProvider delayDuration={50}>
    <Tooltip>
      <TooltipTrigger asChild>
        {userData.stealthActive ? (
          <EyeOff
            className="h-7 w-7 mr-2 text-purple-500 cursor-pointer"
            onClick={() => deactivateStealth()}
          />
        ) : (
          <Eye
            className="h-7 w-7 mr-2 hover:text-purple-500 cursor-pointer"
            onClick={() => activateStealth()}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {userData.stealthActive
          ? `Stealth Active - ${remainingTime} remaining`
          : "Activate Stealth Mode"}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

Show stealth countdown timer when active.

#### 3.3 Update Scouting View (Sector Component)

**File**: `/app/src/layout/Sector.tsx`

Add sensory button:
```tsx
<Button
  variant="outline"
  onClick={() => useSensory()}
  disabled={sensoryCooldownRemaining > 0}
>
  <Search className="h-4 w-4 mr-2" />
  Sense Enemies
  {sensoryCooldownRemaining > 0 && ` (${sensoryCooldownRemaining}s)`}
</Button>
```

#### 3.4 Add Stealth/Sensory Icons

**File**: `/app/src/layout/ElementImage.tsx`

Add cases for "Stealth" and "Sensory" elements with appropriate icons.

---

### Phase 4: Game Logic Integration

#### 4.1 Stealth Breaking Mechanics

Create utility function in `/app/src/libs/stealth.ts`:

```typescript
export const checkStealthBreak = async (
  user: UserData,
  action: "attack" | "rob" | "heal",
  drizzle: DrizzleClient
) => {
  if (!user.stealthActive) return { wasStealthed: false, brokestealth: false };

  const keepChance = calcStealthKeepChance(user.stealth);
  const roll = Math.random() * 100;
  const keptStealth = roll < keepChance;

  if (!keptStealth) {
    // Break stealth
    await drizzle
      .update(userData)
      .set({ stealthActive: false, stealthActivatedAt: null })
      .where(eq(userData.userId, user.userId));
    return { wasStealthed: true, brokestealth: true };
  }

  return { wasStealthed: true, brokestealth: false };
};
```

#### 4.2 Stealth Expiration Check

Add to user regeneration/update cycle:
- Check if `stealthActivatedAt + duration < now`
- Auto-deactivate expired stealth

#### 4.3 Sensory Detection Results

When a player uses sensory:
- Query all stealthed players in the same sector
- For each, roll against detection chance
- Return list of detected players with positions
- Mark detected players as "sensed" (temporary visibility)

---

### Phase 5: Testing

#### 5.1 Unit Tests

Create test file: `/app/src/libs/__tests__/stealth.test.ts`

Test cases:
- Stealth duration calculation
- Stealth keep chance calculation
- Sensory detection chance calculation
- Sensory cooldown calculation
- Stealth break mechanics

#### 5.2 Integration Tests

- Test training stealth/sensory stats
- Test activating/deactivating stealth
- Test stealth visibility in sector data
- Test sensory detection
- Test stealth breaking on actions

---

## File Changes Summary

### New Files
1. `/app/src/server/api/routers/stealth.ts` - New tRPC router
2. `/app/src/libs/stealth.ts` - Stealth/Sensory utility functions
3. `/app/drizzle/migrations/XXXX_stealth_sensory.sql` - Migration file (auto-generated)

### Modified Files
1. `/app/drizzle/schema.ts` - Add new fields to userData
2. `/app/drizzle/constants.ts` - Add new constants and update UserStatNames
3. `/app/src/server/api/root.ts` - Register stealth router
4. `/app/src/server/api/routers/train.ts` - Handle new stats in training
5. `/app/src/server/api/routers/travel.ts` - Handle stealth in sector data
6. `/app/src/layout/StrengthWeaknesses.tsx` - Display new stats
7. `/app/src/app/travel/page.tsx` - Add stealth toggle
8. `/app/src/layout/Sector.tsx` - Add sensory button
9. `/app/src/layout/ElementImage.tsx` - Add stealth/sensory icons

---

## Follow-up Questions for Clarity

1. **Stealth Duration Cap**: The issue mentions "caps at" for stealth duration but doesn't specify the maximum. At 20,000 points (20 intervals), the duration would be 21 minutes (1 base + 20 minutes). Is this the intended cap, or should there be a lower maximum?

2. **Stealth Actions**: The issue mentions "attacking another player, robbing another player, or healing another player" as actions that can break stealth. Should other actions like:
   - Entering combat (being attacked)
   - Using items/consumables
   - Moving to different sectors
   also break stealth?

3. **Sensory Results Visibility**: When a player successfully senses a stealthed enemy:
   - Should the stealthed player be notified they were detected?
   - How long should the detected player remain visible to the sensor (permanent until stealth re-activates, or timed)?

4. **Training Location**: Can stealth and sensory be trained anywhere, or only in villages like other stats?

5. **ANBU Integration**: The existing ANBU squad system has stealth mechanics (`stealthLevel` on AnbuSquad). Should personal stealth/sensory stats:
   - Stack with ANBU stealth bonuses?
   - Replace ANBU stealth for individual members?
   - Work independently?

6. **Combat Interaction**: Should stealth provide any combat advantages? For example:
   - Surprise attack bonus if initiating combat while stealthed
   - Sensory helping detect invisible/hidden enemies in combat

7. **Village Territory**: Should stealth effectiveness be reduced in enemy village territory? The ANBU system currently uses stealth to avoid village protector attacks.

8. **UI Placement for Training**: Should the "Train" buttons be:
   - Inline with the stat display on the profile page?
   - In the existing training UI where players select which stat to train?
   - Both locations?

9. **Visual Indicators**: How should stealthed players appear to:
   - Allies (same village/faction)?
   - Enemies who haven't sensed them?
   - Players who have successfully sensed them?

10. **Cooldown Persistence**: Should the sensory cooldown persist across sessions (stored in database) or reset on page refresh (client-side only)?

---

## Implementation Order

1. Database changes (schema + migration)
2. Constants and utility functions
3. Backend API endpoints
4. Training system integration
5. Travel/Sector data modifications
6. Frontend UI components
7. Testing
8. Documentation updates

---

## Estimated Complexity

- **Database Changes**: Low complexity
- **Backend Logic**: Medium complexity (stealth state management, detection rolls)
- **Frontend UI**: Medium complexity (toggle buttons, cooldowns, visibility)
- **Testing**: Medium complexity
- **Integration with existing systems**: High complexity (travel, combat, ANBU)

Total estimated scope: Medium-Large feature implementation
