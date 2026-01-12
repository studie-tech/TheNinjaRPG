# Raids Feature Implementation Plan

## Overview

This document outlines the implementation plan for the Raids feature as described in Issue #668. The Raids system will allow players to queue as teams of 3 (regardless of village) to fight PvE raid bosses at shrine locations. The system will track damage dealt and reward players based on tiered damage thresholds.

**Note**: This feature is on hold until shrine MPVP is completed (per @MathiasGruber's comment), as it will expand on the MPVP framework. This plan is designed to leverage the expanded MPVP framework once available.

---

## Feature Requirements Summary

1. **Raid Option in Shrines** - New raid mode reusing shrine systems
2. **Cross-Village 3-Player Queue** - Any village, team of 3, PvE only
3. **Content-Managed Raid Bosses** - AI placement at shrines in sectors
4. **Damage Tracking & Tiered Rewards** - Track damage dealt, reward at thresholds (e.g., 100k, 300k)
5. **Open vs Exclusive Raids** - Open (anyone) vs Exclusive (sector-owning village/faction only)
6. **Sector Capture Mechanics** - Exclusive raids tied to sector ownership with time limits
7. **Global Boss HP** - All players collectively damage the same boss HP pool
8. **Time Limits** - Raids must be completed within time limits
9. **In-Combat Rewards** - Temporary stat buffs for set number of days

---

## Architecture Analysis

### Existing Systems to Leverage

1. **MPVP Battle Queue** (`mpvpBattleQueue`, `mpvpBattleUser`)
   - Already supports multi-player matchmaking with sides and slots
   - Battle types: `CLAN_BATTLE`, `SHRINE_BATTLE`
   - Can add new type: `RAID_BATTLE`

2. **Shrine System**
   - Sectors with shrine ownership
   - Shrine levels and HP
   - Village token economy

3. **Combat System**
   - `initiateBattle()` supports multiple users vs multiple AI
   - Action tracking and effect application
   - Reward calculation in `calcBattleResult()`

4. **Quest/Reward System**
   - `ObjectiveRewardType` supports all reward types
   - Tier system for progressive rewards
   - Event quest type for limited-time events

5. **AI System**
   - Rule-based AI with configurable behavior
   - Can create challenging raid boss AI profiles

---

## Database Schema Changes

### New Tables

```sql
-- Raid Boss Definition (Content-managed)
CREATE TABLE RaidBoss (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  description TEXT,
  image VARCHAR(191) NOT NULL,
  aiUserId VARCHAR(191) NOT NULL,  -- Links to userData for AI
  baseHp BIGINT NOT NULL,          -- Base global HP pool
  difficultyTier TINYINT NOT NULL, -- 1-5 difficulty rating
  isActive BOOLEAN DEFAULT false,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

-- Active Raid Instance
CREATE TABLE Raid (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,
  sectorId INT,                     -- Which sector (null for open raids)
  raidType ENUM('OPEN', 'EXCLUSIVE') NOT NULL,
  currentHp BIGINT NOT NULL,        -- Remaining global HP
  maxHp BIGINT NOT NULL,            -- Starting HP (may include modifiers)
  status ENUM('ACTIVE', 'COMPLETED', 'FAILED', 'EXPIRED') DEFAULT 'ACTIVE',
  startsAt DATETIME(3) NOT NULL,
  endsAt DATETIME(3) NOT NULL,      -- Time limit for the raid
  sectorCaptureDeadline DATETIME(3),-- For exclusive raids: deadline to complete
  villageId VARCHAR(191),           -- For exclusive raids: owning village
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  completedAt DATETIME(3)
);

-- Raid Damage Tracking (per user)
CREATE TABLE RaidDamageLog (
  id VARCHAR(191) PRIMARY KEY,
  raidId VARCHAR(191) NOT NULL,
  odId VARCHAR(191) NOT NULL,
  totalDamage BIGINT DEFAULT 0,     -- Cumulative damage dealt
  battleCount INT DEFAULT 0,        -- Number of battles participated
  lastBattleAt DATETIME(3),
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

-- Raid Reward Tiers (Content-managed)
CREATE TABLE RaidRewardTier (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,
  damageThreshold BIGINT NOT NULL,  -- e.g., 100000, 300000
  tierOrder TINYINT NOT NULL,       -- Order of tiers
  rewards JSON NOT NULL,            -- ObjectiveRewardType
  description VARCHAR(191)
);

-- Raid Reward Claims (Track what users have claimed)
CREATE TABLE RaidRewardClaim (
  id VARCHAR(191) PRIMARY KEY,
  raidId VARCHAR(191) NOT NULL,
  userId VARCHAR(191) NOT NULL,
  tierId VARCHAR(191) NOT NULL,
  claimedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY (raidId, userId, tierId)
);

-- In-Combat Buff Rewards
CREATE TABLE UserCombatBuff (
  id VARCHAR(191) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  buffType VARCHAR(50) NOT NULL,    -- e.g., 'STRENGTH_BOOST', 'DEFENSE_BOOST'
  buffValue FLOAT NOT NULL,         -- Percentage or flat value
  expiresAt DATETIME(3) NOT NULL,
  sourceType VARCHAR(50) NOT NULL,  -- 'RAID', 'EVENT', etc.
  sourceId VARCHAR(191),
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);
```

### Schema Modifications

```typescript
// Add to MPVP_BATTLE_TYPES
export const MPVP_BATTLE_TYPES = ["CLAN_BATTLE", "SHRINE_BATTLE", "RAID_BATTLE"] as const;

// Add to BattleTypes
export const BattleTypes = [...existing, "RAID"] as const;
```

---

## Implementation Phases

### Phase 1: Database & Core Infrastructure

**Tasks:**
1. Create new database tables (RaidBoss, Raid, RaidDamageLog, RaidRewardTier, RaidRewardClaim, UserCombatBuff)
2. Add `RAID_BATTLE` to MPVP battle types
3. Add `RAID` to battle types
4. Create Zod validators for raid-related types
5. Generate database migrations

**Files to Create/Modify:**
- `app/drizzle/schema.ts` - Add new tables
- `app/drizzle/constants.ts` - Add raid constants
- `app/src/validators/raid.ts` - New validator file

### Phase 2: Raid Management Router

**Tasks:**
1. Create raid router with CRUD operations
2. Implement raid boss management (content team)
3. Implement active raid management
4. Implement damage logging
5. Implement reward tier configuration

**Endpoints:**
```typescript
// Content Management
createRaidBoss      // Create new raid boss (content)
updateRaidBoss      // Update raid boss (content)
deleteRaidBoss      // Delete raid boss (content)
listRaidBosses      // List all raid bosses

// Raid Instance Management
createRaid          // Create new active raid (content/system)
getRaid             // Get raid details
listActiveRaids     // List all active raids
updateRaidStatus    // Update raid status

// Player Endpoints
getAvailableRaids   // Get raids player can join
getRaidProgress     // Get player's damage and claimable rewards
claimRaidReward     // Claim a tier reward
getUserCombatBuffs  // Get active combat buffs

// Damage Logging (internal)
logRaidDamage       // Called after raid battle completes
```

**Files to Create:**
- `app/src/server/api/routers/raid.ts` - Main raid router

### Phase 3: Raid Queue System

**Tasks:**
1. Extend MPVP queue for raid battles
2. Implement cross-village queue (any 3 players)
3. Implement raid battle initiation
4. Handle AI boss setup in battle

**Key Differences from Shrine MPVP:**
- No PvP - all players on same team vs AI
- Cross-village grouping allowed
- Links to active Raid instance for damage tracking

**Endpoints:**
```typescript
createRaidParty     // Create a raid party (queue)
joinRaidParty       // Join existing party
leaveRaidParty      // Leave party
initiateRaidBattle  // Start the raid battle (3 players required)
getRaidQueue        // Get current queue status
```

### Phase 4: Combat Integration

**Tasks:**
1. Modify `initiateBattle()` to support RAID battle type
2. Implement damage tracking during combat
3. Apply global HP reduction after battle
4. Handle battle rewards with raid-specific logic
5. Implement in-combat buff application

**Key Modifications:**
- `app/src/server/api/routers/combat.ts` - Add RAID battle handling
- `app/src/libs/combat/util.ts` - Modify `calcBattleResult()` for raids
- `app/src/libs/combat/process.ts` - Apply combat buffs

### Phase 5: Shrine Integration & UI

**Tasks:**
1. Add Raid tab/option to shrine page
2. Create raid lobby UI component
3. Create raid progress/rewards UI
4. Create raid boss detail view
5. Integrate with existing shrine navigation

**Files to Create/Modify:**
- `app/src/app/shrine/page.tsx` - Add raid tab
- `app/src/layout/RaidLobby.tsx` - New lobby component
- `app/src/layout/RaidProgress.tsx` - Progress tracking component
- `app/src/layout/RaidBossCard.tsx` - Boss display component

### Phase 6: Exclusive Raids & Sector Integration

**Tasks:**
1. Implement village/faction restriction for exclusive raids
2. Implement sector capture deadline mechanics
3. Handle sector neutralization on raid completion
4. Add exclusive raid indicators on map

**Special Logic:**
- Exclusive raids don't count toward sector count
- Sector becomes neutral after raid completion
- Different time limit for sector capture vs raid completion

### Phase 7: Content Management Interface

**Tasks:**
1. Create raid boss management in admin panel
2. Create raid creation/scheduling interface
3. Create reward tier configuration UI
4. Add raid analytics/monitoring

**Files to Create:**
- `app/src/app/manual/raid/page.tsx` - Raid management page
- `app/src/app/manual/raid/[raidBossId]/page.tsx` - Edit raid boss

### Phase 8: Scheduled Jobs & Cleanup

**Tasks:**
1. Create raid expiration job
2. Create sector neutralization job (for exclusive raids)
3. Create raid status update job
4. Handle failed raids and cleanup

**Files to Create/Modify:**
- `app/src/app/api/raid-maintenance/route.ts` - Scheduled maintenance

---

## Key Implementation Details

### Global HP Mechanism

```typescript
// After each raid battle completes:
const damageDealt = calculateTotalDamage(battle);

// Atomic update to prevent race conditions
await db.update(raid)
  .set({
    currentHp: sql`GREATEST(0, currentHp - ${damageDealt})`
  })
  .where(eq(raid.id, raidId));

// Log individual user damage
await db.insert(raidDamageLog)
  .values({
    raidId,
    odId: odId,
    totalDamage: damageDealt
  })
  .onDuplicateKeyUpdate({
    set: {
      totalDamage: sql`totalDamage + ${damageDealt}`,
      battleCount: sql`battleCount + 1`
    }
  });
```

### Cross-Village Queue

```typescript
// Raid queue doesn't check village restrictions
const canJoinRaid = (user, raid) => {
  if (raid.raidType === 'EXCLUSIVE') {
    // Must be from owning village/faction
    return user.villageId === raid.villageId;
  }
  // Open raids: anyone can join
  return true;
};
```

### Tiered Reward Claims

```typescript
// Check claimable rewards
const getClaimableRewards = async (raidId, userId) => {
  const userDamage = await getUserRaidDamage(raidId, userId);
  const tiers = await getRaidTiers(raidId);
  const claimed = await getClaimedTiers(raidId, userId);

  return tiers.filter(tier =>
    userDamage.totalDamage >= tier.damageThreshold &&
    !claimed.includes(tier.id)
  );
};
```

### In-Combat Buffs

```typescript
// Apply buffs during battle initialization
const applyUserCombatBuffs = (userState, buffs) => {
  for (const buff of buffs) {
    if (new Date() < buff.expiresAt) {
      switch (buff.buffType) {
        case 'STRENGTH_BOOST':
          userState.strength *= (1 + buff.buffValue);
          break;
        case 'DEFENSE_BOOST':
          userState.defense *= (1 + buff.buffValue);
          break;
        // ... other buff types
      }
    }
  }
};
```

---

## Follow-Up Questions for Clarity

### Gameplay Questions

1. **Raid Boss Scaling**: Should raid boss stats/HP scale based on the number of players or remain fixed? Should difficulty tiers affect HP multipliers?

2. **Battle Instance**: When 3 players fight the raid boss, do they all fight in the same battle instance together, or do they fight separately with damage aggregated? (Current shrine MPVP is team vs team in one battle)

3. **Respawn/Re-entry**: If a player dies in the raid battle, can they immediately re-queue and fight again? Is there a cooldown?

4. **Queue Requirements**: Must players form a full party of 3 before starting, or can solo/duo players queue and be matched with others?

5. **Raid Frequency**: How often can players participate in the same raid? Per-day limit? Per-raid limit?

### Exclusive Raid Questions

6. **Sector Capture Time vs Raid Time**: Can you clarify the two time limits?
   - Sector capture deadline: Time limit for the village to complete the raid after capturing the sector?
   - Raid time limit: Time limit for a single battle instance?

7. **Failure Consequence**: If an exclusive raid fails (time expires), does the sector go neutral immediately, or is there a grace period?

8. **Faction Raids**: The issue mentions both villages and factions for exclusive raids. Should factions (clans with towns) have the same mechanics as villages?

### Reward Questions

9. **Damage Threshold Scope**: Are damage thresholds:
   - Per-raid instance (reset each time a new raid starts)?
   - Per-raid boss (cumulative across all instances)?
   - Global (across all raids)?

10. **In-Combat Buff Types**: What stat types should in-combat buffs support? Examples:
    - Offensive: Strength, Ninjutsu Power, Taijutsu Power
    - Defensive: Defense, Resistance
    - Utility: Speed, HP Regen, Chakra Regen
    - What percentage ranges? (e.g., 5-20%?)

11. **Buff Duration**: How many days should combat buffs last? Fixed or configurable per reward tier?

### Technical Questions

12. **Wake Island Reference**: The issue mentions raids showing up like "Wake Island where players accept the Raid." Is there an existing Wake Island event system to reference, or is this a new pattern to implement?

13. **Notification System**: Should players be notified when:
    - A new raid becomes available?
    - Their village's exclusive raid is about to expire?
    - They've unlocked a new reward tier?

14. **Leaderboard**: Should there be a damage leaderboard for each raid showing top contributors?

---

## Dependencies

This feature depends on:
1. **Shrine MPVP completion** - The expanded MPVP framework will inform the raid queue implementation
2. **AI Profile system** - For configurable raid boss AI behavior

## Estimated Scope

- **New files**: ~15-20 files
- **Modified files**: ~10-15 files
- **New database tables**: 6 tables
- **New API endpoints**: ~20 endpoints
- **New UI components**: ~5-8 components

---

## Notes

- This plan follows the existing patterns in the codebase
- Uses the established MPVP queue system as a foundation
- Leverages the existing reward system (ObjectiveRewardType)
- Designed to be content-manageable (raid bosses, rewards, timing)
- Sector mechanics integrate with existing war/shrine systems
