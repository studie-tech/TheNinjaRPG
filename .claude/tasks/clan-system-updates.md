# Clan System Updates - Implementation Plan

## Overview

This document outlines the implementation plan for updating the clan system based on issue #866.

## Changes Summary

### Elder Selection System
The existing elder system will be changed to allow the 3 most active clans of each village to nominate either the clan leader or another member of the clan to be Village Elder.

- Activity is measured by Clan Points which resets at the start of each month
- At the start of each month, existing village elders are removed
- Top 3 clans from each village can nominate elders

### Clan Boost System Overhaul

**Key Changes:**
- Clan boosts no longer cost Clan Points - they now cost **Ryo**
- Players can donate Ryo to their clans
- Each boost caps at **20%** (10 levels, 2% per level)
- Clan Leader and Co-Leaders can purchase boosts

## Clan Boost Configuration

| Boost Type | Base Cost (Ryo) | Per Level (Ryo) | Max Level | Max Effect |
|------------|-----------------|-----------------|-----------|------------|
| Training | 100,000 | 30,000 | 10 | 20% |
| Ryo | 50,000 | 30,000 | 10 | 20% |
| Regen | 50,000 | 20,000 | 10 | 20% |
| Mission Rewards | 100,000 | 30,000 | 10 | 20% |
| Crafting Time Reduction | 200,000 | 30,000 | 10 | 20% |
| **Crafting Experience** | **200,000** | **40,000** | **10** | **20%** |
| Hunter Experience | 200,000 | 40,000 | 10 | 20% |
| Gatherer Experience | 200,000 | 40,000 | 10 | 20% |

## Implementation Tasks

### Phase 1: Database Schema Updates

- [ ] Add new fields to `clan` table:
  - `missionRewardsBoost` (double, default 0)
  - `craftingTimeBoost` (double, default 0)
  - `craftingExpBoost` (double, default 0)
  - `hunterExpBoost` (double, default 0)
  - `gathererExpBoost` (double, default 0)

### Phase 2: Constants Updates

Add new constants to `app/drizzle/constants.ts`:

```typescript
// New boost system - Ryo-based costs
export const CLAN_TRAINING_BOOST_BASE_COST = 100000;
export const CLAN_TRAINING_BOOST_PER_LEVEL_COST = 30000;
export const CLAN_RYO_BOOST_BASE_COST = 50000;
export const CLAN_RYO_BOOST_PER_LEVEL_COST = 30000;
export const CLAN_REGEN_BOOST_BASE_COST = 50000;
export const CLAN_REGEN_BOOST_PER_LEVEL_COST = 20000;
export const CLAN_MISSION_REWARDS_BOOST_BASE_COST = 100000;
export const CLAN_MISSION_REWARDS_BOOST_PER_LEVEL_COST = 30000;
export const CLAN_CRAFTING_TIME_BOOST_BASE_COST = 200000;
export const CLAN_CRAFTING_TIME_BOOST_PER_LEVEL_COST = 30000;
export const CLAN_CRAFTING_EXP_BOOST_BASE_COST = 200000;
export const CLAN_CRAFTING_EXP_BOOST_PER_LEVEL_COST = 40000;
export const CLAN_HUNTER_EXP_BOOST_BASE_COST = 200000;
export const CLAN_HUNTER_EXP_BOOST_PER_LEVEL_COST = 40000;
export const CLAN_GATHERER_EXP_BOOST_BASE_COST = 200000;
export const CLAN_GATHERER_EXP_BOOST_PER_LEVEL_COST = 40000;

// Max boost levels (all 10 for 20% max)
export const CLAN_MAX_BOOST_LEVEL = 10;
export const CLAN_BOOST_PERCENT_PER_LEVEL = 0.02; // 2% per level
```

### Phase 3: Router Updates

- [ ] Update `purchaseTrainingBoost` to use Ryo from clan bank instead of points
- [ ] Update `purchaseRyoBoost` to use Ryo from clan bank instead of points
- [ ] Update `purchaseRegenBoost` to use Ryo from clan bank instead of points
- [ ] Add new purchase mutations:
  - `purchaseMissionRewardsBoost`
  - `purchaseCraftingTimeBoost`
  - `purchaseCraftingExpBoost` (new - replaces clan exp boost)
  - `purchaseHunterExpBoost`
  - `purchaseGathererExpBoost`

### Phase 4: Boost Effect Application

- [ ] Update training calculations to apply training boost
- [ ] Update ryo reward calculations to apply ryo boost
- [ ] Update mission reward calculations to apply mission rewards boost
- [ ] Update crafting time calculations to apply crafting time reduction
- [ ] Update crafting experience calculations to apply crafting exp boost
- [ ] Update hunter experience calculations to apply hunter exp boost
- [ ] Update gatherer experience calculations to apply gatherer exp boost

### Phase 5: Elder Selection System

- [ ] Add monthly clan points reset mechanism
- [ ] Create elder nomination system for top 3 clans per village
- [ ] Update village elder removal/assignment at month start

### Phase 6: Frontend Updates

- [ ] Update clan management UI to show new boosts
- [ ] Add Ryo donation UI for clans
- [ ] Display boost costs in Ryo instead of clan points
- [ ] Show boost levels and effects (2% per level, max 20%)

## Notes

- **Crafting Experience Boost** has been added alongside Crafting Time Reduction (as requested)
- Clan Experience Boost was removed from the plan
- All boosts now cost Ryo from the clan bank, not clan points
- Existing boost purchasing endpoints need migration to use Ryo

## Change Log

- 2026-01-15: Initial plan created
- 2026-01-15: Removed Clan Experience Boost, added Crafting Experience Boost per user request
