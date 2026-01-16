# Implementation Plan: Shrine HP Display During Wars and Raids

## Issue Summary
Issue #874: Shrine HP is not displayed during Wars and Raids, and shrines take no damage during these war types.

## Requirements from Issue
1. **Shrine HPs not displaying during Wars and Raids** - Display shrine HP during Village Wars and Raids
2. **Shrine takes no damage during Wars/Raids** - Enable shrine damage during Village Wars and Raids
3. **Fixed HP for Wars and Raids** - Add specific HP of 1000 for Wars and Raids regardless of shrine level
4. **Sector Wars maintain level-based HP** - Keep existing shrine HP based on level (3000/4000/5000) for Sector Wars
5. **Townhall damage on shrine capture** - Check that capturing a shrine damages townhall, recapturing heals it
6. **Shrine AI Protector** - Ensure shrine AI Protector must be the one set by the Kage

---

## Current System Analysis

### War Types in System
The system has 3 war types (`WAR_TYPES` in constants.ts):
- `SECTOR_WAR` - Wars to capture specific sectors (has shrine HP)
- `VILLAGE_WAR` - Direct village-to-village wars (uses War Health system, no shrine HP)
- `WAR_RAID` - Raids against specific village structures (uses War Health system, no shrine HP)

### Current Shrine HP Implementation
- **Database Schema** (`schema.ts:3510-3513`): War table has `shrineHp` and `shrineMaxHp` fields
- **Shrine HP by Level** (`constants.ts:1267`): `{ 1: 3000, 2: 4000, 3: 5000 }`
- **Only used for SECTOR_WAR**: Shrine HP is only initialized and updated for SECTOR_WAR type

### Current War Health System (VILLAGE_WAR/WAR_RAID)
- `attackerWarHealth` and `defenderWarHealth` fields on War table
- Default: 10,000 HP per side (`WAR_INSTANCE_HEALTH`)
- Damage/recovery per PvP kill based on rank

### Where Shrine Damage Occurs
- **`combat/util.ts:1319-1350`**: Shrine damage calculation only for `SECTOR_WAR` type
- **`combat/database.ts:411-419`**: Shrine HP update only for `SECTOR_WAR` type

### Current UI Display
- **`WarSystem.tsx:593-603`**: SectorWar component shows shrine HP when `war.shrineHp > 0`
- **`shrine/page.tsx:433-444`**: WarCard shows shrine HP StatusBar when `war.shrineHp > 0`

### Townhall Damage Logic
- **`constants.ts:1207-1209`**:
  - `WAR_SECTOR_LOSS_TOWNHALL_DAMAGE = 300` (damage on sector loss)
  - `WAR_SECTOR_RECAPTURE_TOWNHALL_HEAL = 150` (heal on recapture within 7 days)
- **`war.ts:314-325`**: Townhall damage applied only in `handleWarEnd` for SECTOR_WAR

### Shrine AI Defenders
- **`shrine.ts:1262-1286`**: AI defenders fetched from `village.shrineSettings.activeAiIds`
- Falls back to global shrine AIs if village has none configured

---

## Implementation Plan

### Task 1: Add New Constants for War/Raid Shrine HP
**File:** `app/drizzle/constants.ts`

Add new constant:
```typescript
export const WAR_RAID_SHRINE_HP = 1000; // Fixed shrine HP for Village Wars and Raids
```

### Task 2: Initialize Shrine HP for VILLAGE_WAR and WAR_RAID
**File:** `app/src/server/api/routers/war.ts`

Modify `declareVillageWarOrRaid` mutation (around line 575):
- Set `shrineHp` and `shrineMaxHp` to `WAR_RAID_SHRINE_HP` (1000) when creating war

**Current code (line 575-582):**
```typescript
ctx.drizzle.insert(war).values({
  id: warId,
  attackerVillageId: user.villageId,
  defenderVillageId: input.targetVillageId,
  status: "ACTIVE",
  type: warType,
  targetStructureRoute: structure.route,
}),
```

**Modified code:**
```typescript
ctx.drizzle.insert(war).values({
  id: warId,
  attackerVillageId: user.villageId,
  defenderVillageId: input.targetVillageId,
  status: "ACTIVE",
  type: warType,
  targetStructureRoute: structure.route,
  shrineHp: WAR_RAID_SHRINE_HP,
  shrineMaxHp: WAR_RAID_SHRINE_HP,
}),
```

### Task 3: Enable Shrine Damage for VILLAGE_WAR and WAR_RAID
**File:** `app/src/libs/combat/util.ts`

Modify the shrine damage calculation section (around lines 1319-1350):
- Currently only applies shrine damage for `SECTOR_WAR`
- Add shrine damage logic for `VILLAGE_WAR` and `WAR_RAID` types

**Current logic:** Only updates shrine HP for `SECTOR_WAR` type battles
**New logic:** Also update shrine HP for `VILLAGE_WAR` and `WAR_RAID` types

### Task 4: Update Database Write for Shrine HP Changes
**File:** `app/src/libs/combat/database.ts`

Modify the `updateWars` function (around lines 411-419):
- Currently only writes shrine HP changes for `SECTOR_WAR`
- Extend to also write for `VILLAGE_WAR` and `WAR_RAID`

**Current code:**
```typescript
...(result.shrineChangeHp !== 0 && w.type === "SECTOR_WAR"
```

**Modified code:**
```typescript
...(result.shrineChangeHp !== 0 && ["SECTOR_WAR", "VILLAGE_WAR", "WAR_RAID"].includes(w.type)
```

### Task 5: Display Shrine HP in Village War UI
**File:** `app/src/layout/WarSystem.tsx`

Update the `VillageWar` component to show shrine HP:
1. Add shrine HP StatusBar display for VILLAGE_WAR and WAR_RAID types
2. Display similar to how `SectorWar` component shows shrine HP

**Location:** Inside `VillageWar` component (around lines 858-1357)

Add shrine HP display after war type header, similar to:
```tsx
{war.shrineHp > 0 && ["VILLAGE_WAR", "WAR_RAID"].includes(war.type) && (
  <StatusBar
    title="Shrine HP"
    tooltip="Shrine Health - Depletes from PvP kills during war"
    color="bg-red-500"
    showText={true}
    status="AWAKE"
    current={war.shrineHp}
    total={war.shrineMaxHp}
  />
)}
```

### Task 6: Add Townhall Damage on Shrine Capture (for Wars/Raids)
**File:** `app/src/libs/war.ts`

Check `handleWarEnd` function to ensure townhall damage is applied:
- Currently, townhall damage only applies for `SECTOR_WAR` (lines 314-325)
- Add similar logic for `VILLAGE_WAR` and `WAR_RAID` when shrine HP reaches 0

**New logic to add in handleWarEnd (around line 329):**
```typescript
// Handle townhall damage for VILLAGE_WAR/WAR_RAID when shrine destroyed
...(["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type) && !isDraw
  ? [
      drizzleDB
        .update(villageStructure)
        .set({
          curSp: sql`GREATEST(curSp - ${WAR_SECTOR_LOSS_TOWNHALL_DAMAGE}, 0)`,
        })
        .where(
          and(
            eq(villageStructure.villageId, loserVillageId),
            eq(villageStructure.route, "/townhall"),
          ),
        ),
    ]
  : []),
```

### Task 7: Verify Shrine AI Protector Implementation
**File:** `app/src/server/api/routers/shrine.ts`

Verify existing implementation in `initiateShrineBattle` (lines 1262-1286):
- Confirms AI defenders come from `village.shrineSettings.activeAiIds`
- Only Kage can set these via `assignShrineAi` endpoint (lines 554-601)

**Status:** Already correctly implemented. No changes needed.

---

## Testing Checklist

1. **SECTOR_WAR shrine HP** - Verify still works with level-based HP (3000/4000/5000)
2. **VILLAGE_WAR shrine HP** - Verify shows 1000 HP, displays in UI, takes damage from PvP kills
3. **WAR_RAID shrine HP** - Verify shows 1000 HP, displays in UI, takes damage from PvP kills
4. **Townhall damage** - Verify townhall takes damage when war is lost
5. **Shrine AI** - Verify Kage-configured AI defenders are used

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/drizzle/constants.ts` | Add `WAR_RAID_SHRINE_HP = 1000` constant |
| `app/src/server/api/routers/war.ts` | Initialize shrine HP when declaring Village War or Raid |
| `app/src/libs/combat/util.ts` | Add shrine damage calculation for VILLAGE_WAR/WAR_RAID |
| `app/src/libs/combat/database.ts` | Enable shrine HP updates for VILLAGE_WAR/WAR_RAID |
| `app/src/layout/WarSystem.tsx` | Display shrine HP in VillageWar component |
| `app/src/libs/war.ts` | Add townhall damage on war loss for VILLAGE_WAR/WAR_RAID |

---

## Notes

- The existing war health system (`attackerWarHealth`/`defenderWarHealth`) will continue to function alongside shrine HP
- Shrine HP provides an additional visible progress indicator for wars
- The 1000 HP fixed value for Wars/Raids vs level-based HP for Sector Wars creates different strategic dynamics
- Townhall damage mechanism extends the consequences of war loss beyond tokens

---

## Status

- [ ] Task 1: Add constants
- [ ] Task 2: Initialize shrine HP for Village Wars/Raids
- [ ] Task 3: Enable shrine damage calculation
- [ ] Task 4: Update database writes
- [ ] Task 5: Display shrine HP in UI
- [ ] Task 6: Add townhall damage on war loss
- [ ] Task 7: Verify AI protector implementation
