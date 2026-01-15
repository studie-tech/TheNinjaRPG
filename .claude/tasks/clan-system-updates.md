# Clan System Updates - Implementation Plan

## Overview
This task implements updates to the clan system including:
1. Elder Selection System - Top 3 most active clans per village can nominate elders
2. Clan Boost System Overhaul - Change from clan points to Ryo-based system with new boost types

## Part 1: Elder Selection System

### Current State
- Elders are manually appointed by the Kage
- Elder qualification requires 100 days in village
- Maximum 3 elders per village
- No monthly reset system exists for clan points

### Proposed Implementation

#### Database Changes
1. **New Table: `clanElderNomination`**
   - Tracks elder nominations from clans per month/year
   - Fields: `id`, `clanId`, `villageId`, `nominatedUserId`, `month`, `year`, `createdAt`

2. **Modify `clan` Table**
   - Add `monthlyPoints` (int) - Resets at month start
   - Add `pointsLastResetAt` (datetime) - Track last reset

#### Elder Selection Timeline
- **1st of month**: Monthly points reset, previous elders removed, new elders selected
- **25th of month**: Cutoff - Top 3 clans per village become eligible to nominate
- **26th-28th**: Nomination window for eligible clans
- **28th (deadline)**: Nominations close
- **End of month**: System processes nominations, selects elders for next month

#### Rules
- If a clan doesn't nominate, clan leader becomes elder by default
- Tie-breaker: Total all-time clan points

---

## Part 2: Clan Boost System Overhaul

### Current State
- 3 boost types: `trainingBoost`, `ryoBoost`, `regenBoost`
- Use Clan Points as currency
- Each level = 1% boost, max 15 levels

### New Boost Configuration

| Boost Type | Base Cost (Ryo) | Per Level (Ryo) | Max Level | Max Effect |
|------------|-----------------|-----------------|-----------|------------|
| Training | 100,000 | 30,000 | 10 | 20% |
| Ryo | 50,000 | 30,000 | 10 | 20% |
| Regen | 50,000 | 20,000 | 10 | 20% |
| Mission Rewards | 100,000 | 30,000 | 10 | 20% |
| Crafting Time Reduction | 200,000 | 30,000 | 10 | 20% |
| Hunter Experience | 200,000 | 40,000 | 10 | 20% |
| Gatherer Experience | 200,000 | 40,000 | 10 | 20% |
| **Clan Experience** | **200,000** | **40,000** | **10** | **20%** |

**Cost Formula**: `baseCost + (currentLevel * perLevelCost)`

### New Constants to Add

```typescript
// Clan boost system
export const CLAN_BOOST_MAX_LEVEL = 10;
export const CLAN_BOOST_PERCENT_PER_LEVEL = 2;

// Training boost
export const CLAN_TRAINING_BOOST_BASE_COST = 100000;
export const CLAN_TRAINING_BOOST_PER_LEVEL_COST = 30000;

// Ryo boost
export const CLAN_RYO_BOOST_BASE_COST = 50000;
export const CLAN_RYO_BOOST_PER_LEVEL_COST = 30000;

// Regen boost
export const CLAN_REGEN_BOOST_BASE_COST = 50000;
export const CLAN_REGEN_BOOST_PER_LEVEL_COST = 20000;

// Mission boost
export const CLAN_MISSION_BOOST_BASE_COST = 100000;
export const CLAN_MISSION_BOOST_PER_LEVEL_COST = 30000;

// Crafting boost
export const CLAN_CRAFTING_BOOST_BASE_COST = 200000;
export const CLAN_CRAFTING_BOOST_PER_LEVEL_COST = 30000;

// Hunter boost
export const CLAN_HUNTER_BOOST_BASE_COST = 200000;
export const CLAN_HUNTER_BOOST_PER_LEVEL_COST = 40000;

// Gatherer boost
export const CLAN_GATHERER_BOOST_BASE_COST = 200000;
export const CLAN_GATHERER_BOOST_PER_LEVEL_COST = 40000;

// Clan Experience boost
export const CLAN_EXPERIENCE_BOOST_BASE_COST = 200000;
export const CLAN_EXPERIENCE_BOOST_PER_LEVEL_COST = 40000;
```

### Database Changes Required
Add to `clan` table:
- `missionBoost` (double, default 0)
- `craftingBoost` (double, default 0)
- `hunterBoost` (double, default 0)
- `gathererBoost` (double, default 0)
- `clanExpBoost` (double, default 0)

Note: `bank` field already exists for clan Ryo donations.

---

## Implementation Phases

### Phase 1: Database Schema Updates
1. Add new fields to `clan` table:
   - `missionBoost`, `craftingBoost`, `hunterBoost`, `gathererBoost`, `clanExpBoost`
   - `monthlyPoints`, `pointsLastResetAt`
2. Create `clanElderNomination` table
3. Run migration

### Phase 2: Clan Boost System
1. Update constants in `constants.ts`
2. Modify existing boost mutations (training, ryo, regen) to use Ryo
3. Add new boost mutations (mission, crafting, hunter, gatherer, clanExp)
4. Integrate boost effects into game systems
5. Update frontend UI

### Phase 3: Elder Selection System
1. Create `nominateElder` mutation with eligibility checks
2. Create queries for top clans and nominations
3. Create monthly cron job for elder selection
4. Update frontend for nomination UI

---

## Files to Modify

### Backend
- `app/drizzle/schema.ts` - Add new tables/fields
- `app/drizzle/constants.ts` - Add new boost constants
- `app/src/server/api/routers/clan.ts` - Boost mutations, donations, nominations
- `app/src/server/api/routers/kage.ts` - Elder system updates
- `app/src/server/api/routers/quests.ts` - Apply mission boost, clan experience boost

### Frontend
- `app/src/layout/Clan.tsx` - Boost UI updates
- `app/src/app/clanhall/page.tsx` - Elder nomination UI

---

## Clarifications Applied (from @theeneon)

### Elder Selection
| Question | Answer |
|----------|--------|
| Eligibility cutoff | Clans must be in top 3 by 25th of month |
| Nomination deadline | 28th of month |
| Elder selection | End of month for upcoming month |
| Tie-breaker | Total all-time clan points |
| Default nomination | Clan leader becomes elder |
| Notifications | Not needed |

### Clan Boosts
| Question | Answer |
|----------|--------|
| Max level | 10 levels (20% max) |
| Refunds | Not needed |
| Donation limits | None |
| Withdrawals | Not allowed - deposit only |
| Regen boost | Added: 50,000 base, 20,000 per level |

---

## Update Log

- 2026-01-15: Added **Clan Experience Boost** to the boost list
  - Base cost: 200,000 Ryo
  - Per level cost: 40,000 Ryo
  - Max level: 10 (20% max boost)
  - This boost increases clan points/experience earned by clan members
