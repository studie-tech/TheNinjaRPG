# Raids Feature Implementation Plan

**Issue**: #668
**Status**: Planning Phase (On Hold pending Shrine MPVP completion)
**Last Updated**: 2026-01-13

---

## Overview

The Raids feature allows players to queue as teams of up to 3 (regardless of village) to fight PvE raid bosses at shrine locations, with global HP tracking and tiered damage-based rewards. This leverages existing systems including the MPVP framework, Shrine system, and Combat system.

**Note**: Per @MathiasGruber's comment, this is on hold until shrine MPVP is completed, which will expand the MPVP framework.

---

## Clarified Requirements

Based on follow-up answers from @theeneon (2026-01-13):

### Battle Mechanics
| Question | Answer |
|----------|--------|
| Raid Boss HP Scaling | **Fixed** - HP is decided by what was set in AI creation, no scaling |
| Battle Instance | **Same instance** - All players (1-3) fight in the same battle together, using existing Shrine War MPVP structure |
| Re-queuing | **Unlimited** - Players can keep re-queuing as long as the raid boss exists |
| Queue Requirements | **Flexible** - Players can enter as solo, duo, or full 3-man party |
| Raid Frequency | **Configurable** - Set per raid creation |

### Time Limits
| Question | Answer |
|----------|--------|
| Sector Capture Deadline | **Yes** - After a village captures a sector, there's a time limit to complete the exclusive raid |
| Battle Time Limit | **None** - No time limit for individual battle instances |
| Grace Period on Failure | **1 hour** - If exclusive raid fails, 1 hour grace period before sector becomes available again |

### Factions & Villages
| Question | Answer |
|----------|--------|
| Faction Mechanics | **Same as villages** - Factions (clans with towns) have the same exclusive raid mechanics |

### Rewards
| Question | Answer |
|----------|--------|
| Damage Threshold Scope | **Per raid boss** - Thresholds are tracked per raid boss (not per instance) |
| In-Combat Buff Types | **Offense and Defense** - Buffs affect player offense and defense stats |
| Buff Duration | **Configurable** - Set per raid creation |

### UI & Notifications
| Question | Answer |
|----------|--------|
| Raid Location | **Global Anbu HQ** - Raids show up in Wake Island's Global Anbu building, similar to Story event type |
| Notifications | **Yes** - Players notified when raids are available and when expiring |
| Leaderboard | **Yes** - Track damage dealt per raid |

---

## Existing Systems to Leverage

| System | Location | Purpose for Raids |
|--------|----------|-------------------|
| **MPVP Battle Queue** | `app/drizzle/schema.ts:676-761` | Multi-player matchmaking with sides/slots - add `RAID_BATTLE` type |
| **Shrine Router** | `app/src/server/api/routers/shrine.ts` | Sector ownership, shrine levels - reference for raid-shrine integration |
| **Combat System** | `app/src/libs/combat/` | `initiateBattle()` supports multiple users vs AI |
| **Quest/Reward System** | Quest tables + `ObjectiveRewardType` | For tiered damage rewards |
| **AI System** | `userData.isAi`, `aiProfile` | Rule-based AI for raid boss behavior |
| **Global Anbu HQ** | `app/src/app/globalanbuhq/page.tsx` | Shows story quests - add raids similarly |
| **QuestPicker** | `app/src/layout/QuestPicker.tsx` | Reusable component for displaying available quests/raids |

---

## Database Schema Changes

### New Tables

```sql
-- Raid Boss Definition (Content-managed)
CREATE TABLE RaidBoss (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  description TEXT NOT NULL,
  image VARCHAR(191) NOT NULL,
  aiUserId VARCHAR(191) NOT NULL,        -- Links to userData for AI configuration (HP from AI)
  difficultyTier TINYINT DEFAULT 1,      -- 1-5 difficulty rating for display
  raidType ENUM('OPEN', 'EXCLUSIVE') DEFAULT 'OPEN',
  maxAttemptsPerDay INT DEFAULT NULL,    -- Raid frequency limit (NULL = unlimited)
  inCombatBuffType VARCHAR(50),          -- e.g., 'OFFENSE', 'DEFENSE', 'BOTH'
  inCombatBuffValue INT,                 -- Percentage boost
  inCombatBuffDurationDays INT,          -- Duration of buff after raid completion
  isActive BOOLEAN DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Active Raid Instance
CREATE TABLE Raid (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,
  sectorId INT,                          -- Sector where raid is located (NULL for global)
  raidType ENUM('OPEN', 'EXCLUSIVE') NOT NULL,
  currentHp BIGINT NOT NULL,             -- Global HP pool (can be very large)
  maxHp BIGINT NOT NULL,                 -- Starting HP (copied from AI userData.maxHealth)
  status ENUM('ACTIVE', 'COMPLETED', 'FAILED', 'EXPIRED') DEFAULT 'ACTIVE',
  startsAt DATETIME(3) NOT NULL,
  endsAt DATETIME(3),                    -- When raid expires (NULL = no expiration)
  sectorCaptureDeadline DATETIME(3),     -- For exclusive raids: deadline to complete
  villageId VARCHAR(191),                -- For exclusive raids: which village can participate
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (raidBossId) REFERENCES RaidBoss(id),
  INDEX (raidBossId),
  INDEX (status),
  INDEX (villageId)
);

-- Raid Damage Tracking (per user per raid boss)
-- Note: Thresholds are per raid boss, not per instance
CREATE TABLE RaidDamageLog (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,      -- Track per boss, not per instance
  raidId VARCHAR(191) NOT NULL,          -- Current raid instance
  userId VARCHAR(191) NOT NULL,
  totalDamage BIGINT DEFAULT 0,          -- Cumulative damage dealt to this boss
  battleCount INT DEFAULT 0,             -- Number of battles participated
  lastBattleAt DATETIME(3),
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY (raidBossId, userId),       -- One record per user per boss
  FOREIGN KEY (raidBossId) REFERENCES RaidBoss(id),
  FOREIGN KEY (raidId) REFERENCES Raid(id),
  FOREIGN KEY (userId) REFERENCES UserData(userId),
  INDEX (userId),
  INDEX (raidId)
);

-- Raid Reward Tiers (Content-managed)
CREATE TABLE RaidRewardTier (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,
  damageThreshold BIGINT NOT NULL,       -- e.g., 100000, 300000
  tierOrder TINYINT NOT NULL,            -- 1, 2, 3, etc.
  rewards JSON NOT NULL,                 -- ObjectiveRewardType JSON
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (raidBossId) REFERENCES RaidBoss(id),
  UNIQUE KEY (raidBossId, tierOrder),
  INDEX (raidBossId)
);

-- Raid Reward Claims
CREATE TABLE RaidRewardClaim (
  id VARCHAR(191) PRIMARY KEY,
  raidBossId VARCHAR(191) NOT NULL,      -- Per boss (not per instance)
  userId VARCHAR(191) NOT NULL,
  tierId VARCHAR(191) NOT NULL,
  claimedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY (raidBossId, userId, tierId),
  FOREIGN KEY (raidBossId) REFERENCES RaidBoss(id),
  FOREIGN KEY (userId) REFERENCES UserData(userId),
  FOREIGN KEY (tierId) REFERENCES RaidRewardTier(id)
);

-- In-Combat Buff Rewards (applied to players after raid participation)
CREATE TABLE UserCombatBuff (
  id VARCHAR(191) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  buffType ENUM('OFFENSE', 'DEFENSE', 'BOTH') NOT NULL,
  buffValue INT NOT NULL,                -- Percentage boost
  expiresAt DATETIME(3) NOT NULL,
  sourceType VARCHAR(50) NOT NULL,       -- 'RAID'
  sourceId VARCHAR(191),                 -- raidBossId
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (userId) REFERENCES UserData(userId),
  INDEX (userId),
  INDEX (expiresAt)
);

-- Raid Leaderboard View (optional - can be computed from RaidDamageLog)
-- For performance, may want a materialized view or scheduled aggregation
```

### Schema Modifications

```typescript
// In app/drizzle/constants.ts
export const MPVP_BATTLE_TYPES = ["CLAN_BATTLE", "SHRINE_BATTLE", "RAID_BATTLE"] as const;

// Add raid-related constants
export const RAID_TYPES = ["OPEN", "EXCLUSIVE"] as const;
export type RaidType = (typeof RAID_TYPES)[number];

export const RAID_STATUSES = ["ACTIVE", "COMPLETED", "FAILED", "EXPIRED"] as const;
export type RaidStatus = (typeof RAID_STATUSES)[number];

export const COMBAT_BUFF_TYPES = ["OFFENSE", "DEFENSE", "BOTH"] as const;
export type CombatBuffType = (typeof COMBAT_BUFF_TYPES)[number];

export const RAID_BATTLE_MAX_USERS = 3;  // Max players per raid battle
export const EXCLUSIVE_RAID_GRACE_PERIOD_HOURS = 1;  // Grace period after failure
```

---

## Implementation Phases

### Phase 1: Database & Core Infrastructure
**Files to create/modify:**
- `app/drizzle/schema.ts` - Add new tables
- `app/drizzle/constants.ts` - Add raid constants and MPVP battle type
- `app/src/validators/raid.ts` - Create Zod validators
- Migration file via `make makemigrations`

**Tasks:**
- [ ] Add `RAID_BATTLE` to `MPVP_BATTLE_TYPES`
- [ ] Create raid-related constants
- [ ] Define RaidBoss, Raid, RaidDamageLog, RaidRewardTier, RaidRewardClaim, UserCombatBuff tables
- [ ] Create Zod validators for raid inputs/outputs
- [ ] Generate and run migration

### Phase 2: Raid Management Router
**Files to create:**
- `app/src/server/api/routers/raid.ts` - Main raid router

**Content Management Endpoints:**
- [ ] `createRaidBoss` - Create new raid boss definition
- [ ] `updateRaidBoss` - Update raid boss settings
- [ ] `listRaidBosses` - List all raid bosses for admin
- [ ] `createRaid` - Start a new raid instance
- [ ] `endRaid` - Manually end/expire a raid

**Raid Instance Endpoints:**
- [ ] `getRaid` - Get specific raid details
- [ ] `listActiveRaids` - List all active raids

**Player Endpoints:**
- [ ] `getAvailableRaids` - Get raids player can join (respects OPEN vs EXCLUSIVE)
- [ ] `getRaidProgress` - Get user's damage progress on a raid boss
- [ ] `getRaidLeaderboard` - Get damage leaderboard for a raid
- [ ] `claimRaidReward` - Claim tier reward based on damage dealt
- [ ] `getUserCombatBuffs` - Get active combat buffs for user

### Phase 3: Raid Queue System (Extends MPVP)
**Files to modify:**
- `app/src/server/api/routers/raid.ts` - Add queue endpoints

**Queue Endpoints (similar to shrine.ts pattern):**
- [ ] `joinRaidQueue` - Join a raid battle queue (solo, duo, or trio)
- [ ] `leaveRaidQueue` - Leave raid queue before battle starts
- [ ] `getRaidQueue` - Get current queue status for a raid
- [ ] `getUserQueuedRaid` - Check if user is in a raid queue
- [ ] `initiateRaidBattle` - Start battle when ready (no minimum player requirement)

**Key Differences from Shrine Battles:**
- Cross-village queue (any players can join OPEN raids)
- Village/faction restricted for EXCLUSIVE raids
- No attackers/defenders - all players on same side vs AI boss
- Solo/duo/trio allowed (no minimum party size)

### Phase 4: Combat Integration
**Files to modify:**
- `app/src/server/api/routers/combat.ts` - Add RAID battle type handling
- `app/src/libs/combat/process.ts` - Track damage dealt for raids
- `app/src/libs/combat/database.ts` - Log raid damage after battle

**Tasks:**
- [ ] Add `RAID` to battle types
- [ ] Modify `initiateBattle()` to handle RAID_BATTLE type
- [ ] Implement damage tracking during combat (sum all damage to boss)
- [ ] After battle: update global HP, log user damage
- [ ] Apply in-combat buffs if configured on raid boss

**Damage Tracking Logic:**
```typescript
// After each raid battle ends
const damageDealtToBoss = calculateDamageDealtToBoss(battleResult);

// Atomic global HP update
await db.update(raid)
  .set({ currentHp: sql`GREATEST(0, currentHp - ${damageDealtToBoss})` })
  .where(eq(raid.id, raidId));

// Upsert user damage (per raid boss, not per instance)
await db.insert(raidDamageLog)
  .values({
    raidBossId,
    raidId,
    userId,
    totalDamage: damageDealtToBoss,
    battleCount: 1,
    lastBattleAt: new Date()
  })
  .onDuplicateKeyUpdate({
    set: {
      totalDamage: sql`totalDamage + ${damageDealtToBoss}`,
      battleCount: sql`battleCount + 1`,
      lastBattleAt: new Date(),
      raidId  // Update to current instance
    }
  });

// Check if boss defeated
const updatedRaid = await db.query.raid.findFirst({ where: eq(raid.id, raidId) });
if (updatedRaid.currentHp <= 0) {
  await db.update(raid)
    .set({ status: 'COMPLETED' })
    .where(eq(raid.id, raidId));
  // Trigger completion notifications
}
```

### Phase 5: Global Anbu HQ Integration & UI
**Files to modify:**
- `app/src/app/globalanbuhq/page.tsx` - Add raids section

**Files to create:**
- `app/src/layout/RaidPicker.tsx` - Similar to QuestPicker for raids
- `app/src/layout/RaidProgress.tsx` - Show user's damage progress and tiers
- `app/src/layout/RaidLeaderboard.tsx` - Display damage leaderboard
- `app/src/layout/RaidBattleLobby.tsx` - Queue/party management UI

**UI Flow:**
1. User visits Global Anbu HQ → Sees "Raids" section (like Story Missions)
2. Clicks on a raid → Shows RaidProgress with boss info, HP bar, reward tiers
3. Clicks "Join Raid" → Opens RaidBattleLobby
4. In lobby: can queue solo or wait for others
5. Battle starts → Normal combat flow
6. After battle → Shows damage contribution, checks tier unlocks

### Phase 6: Exclusive Raids & Sector Integration
**Files to modify:**
- `app/src/server/api/routers/raid.ts` - Exclusive raid logic
- `app/src/server/api/routers/shrine.ts` - Sector capture triggers

**Tasks:**
- [ ] Add village/faction restriction checks for EXCLUSIVE raids
- [ ] Implement sector capture deadline mechanics
- [ ] Implement 1-hour grace period on exclusive raid failure
- [ ] Sector neutralization on exclusive raid completion/failure
- [ ] Don't count exclusive raid sectors toward village sector count

**Exclusive Raid Flow:**
1. Content places exclusive raid on a sector
2. Village captures sector → Timer starts (sectorCaptureDeadline)
3. Only that village/faction can attempt the raid
4. If completed before deadline → Rewards given, sector goes neutral
5. If deadline passes → Raid fails, 1-hour grace period, then sector available again

### Phase 7: Content Management Interface
**Files to create:**
- `app/src/app/manual/raid/page.tsx` - Raid boss list
- `app/src/app/manual/raid/[raidBossId]/page.tsx` - Edit raid boss
- `app/src/app/manual/raid/create/page.tsx` - Create new raid boss

**Admin Features:**
- [ ] Create/edit raid bosses (link to AI, set difficulty, configure buffs)
- [ ] Create/manage active raid instances
- [ ] Configure reward tiers per boss
- [ ] View raid statistics and leaderboards
- [ ] End/expire raids manually

### Phase 8: Notifications & Scheduled Jobs
**Files to create:**
- `app/src/app/api/raid-maintenance/route.ts` - Cron job for raid maintenance

**Scheduled Tasks:**
- [ ] Check for expired raids → Update status to EXPIRED
- [ ] Check exclusive raid deadlines → Apply grace period or neutralize sector
- [ ] Clean up old combat buffs (expired)

**Notification Triggers:**
- [ ] New raid available (via Global Anbu HQ)
- [ ] Raid expiring soon (24h, 1h warnings)
- [ ] Raid boss defeated
- [ ] New tier unlocked for user
- [ ] Exclusive raid captured/available

---

## Key Implementation Details

### Cross-Village Queue for Open Raids
```typescript
const canJoinRaid = (user: User, raid: Raid) => {
  if (raid.raidType === 'EXCLUSIVE') {
    // Check if user's village/faction matches
    return user.villageId === raid.villageId ||
           (user.clan?.villageId === raid.villageId);
  }
  return true; // Open raids: anyone can join
};
```

### Damage Threshold Tracking (Per Boss)
```typescript
// When checking reward eligibility
const userDamage = await db.query.raidDamageLog.findFirst({
  where: and(
    eq(raidDamageLog.raidBossId, raidBossId),
    eq(raidDamageLog.userId, userId)
  )
});

const eligibleTiers = await db.query.raidRewardTier.findMany({
  where: and(
    eq(raidRewardTier.raidBossId, raidBossId),
    lte(raidRewardTier.damageThreshold, userDamage.totalDamage)
  ),
  orderBy: asc(raidRewardTier.tierOrder)
});
```

### In-Combat Buff Application
```typescript
// After raid battle, if boss has buff configured
if (raidBoss.inCombatBuffType && raidBoss.inCombatBuffValue) {
  const expiresAt = secondsFromNow(raidBoss.inCombatBuffDurationDays * 24 * 60 * 60);
  await db.insert(userCombatBuff).values({
    id: nanoid(),
    userId,
    buffType: raidBoss.inCombatBuffType,
    buffValue: raidBoss.inCombatBuffValue,
    expiresAt,
    sourceType: 'RAID',
    sourceId: raidBoss.id
  });
}

// In combat system, apply active buffs
const activeBuffs = await db.query.userCombatBuff.findMany({
  where: and(
    eq(userCombatBuff.userId, userId),
    gt(userCombatBuff.expiresAt, new Date())
  )
});
// Apply buff percentages to offense/defense stats
```

---

## Estimated Scope

| Category | Count |
|----------|-------|
| New files | ~15-20 |
| Modified files | ~10-15 |
| New database tables | 6 |
| New API endpoints | ~20 |
| New UI components | ~5-8 |

---

## Dependencies

1. **Shrine MPVP completion** - The expanded MPVP framework will inform the raid queue implementation
2. **AI Profile system** - Raid boss AI behavior comes from linked AI user configuration

---

## Questions Resolved ✓

All follow-up questions from the original plan have been answered by @theeneon and incorporated into this updated plan.

---

## Next Steps

1. Wait for Shrine MPVP to be completed
2. Review this plan with stakeholders
3. Begin Phase 1 implementation
