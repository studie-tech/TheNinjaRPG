# MPVP Shrine Battle System Implementation Plan

## Overview
This task implements the MPVP Shrine Wars feature which allows players to team up and challenge shrines together, as specified in Issue #659.

## Implementation Complete - Final Updates

This PR implements full MPVP shrine battle support with the following improvements:

### 1. Schema Refactoring (Fully Removed Legacy Fields)
- **Removed** `clan1Id`/`clan2Id` fields from `mpvpBattleQueue` table entirely (no legacy fields)
- `attackerEntityId`/`defenderEntityId` are now the sole identifiers for all MPVP battles
- Added `slot` field to `mpvpBattleUser` for race condition protection
- Added unique constraint on `(clanBattleId, side, slot)` to prevent slot conflicts

### 2. Backend Updates

#### Shrine Router (`shrine.ts`)
- `challengeShrine`: Creates queue with only `attackerEntityId`/`defenderEntityId`
- `joinShrineBattle`: Slot-based allocation with unique constraint protection
- `leaveShrineBattle`: Uses DB-truth count check instead of stale snapshot
- `initiateShrineBattle`:
  - Only attackers can initiate (defenders cannot)
  - Removed double-query (uses `shrineBattle.sector` directly)
  - Added `battleId IS NULL` guard to prevent double-start races
  - Fixed SQL CASE quoting (uses single quotes for MySQL compatibility)

#### Clan Router (`clan.ts`)
- Updated `challengeClan` to only use `attackerEntityId`/`defenderEntityId`
- Updated `joinClanBattle` to derive side from entity fields instead of legacy fields
- Updated `initiateClanBattle` to use `side` field for attacker/defender filtering
- Updated `fetchClanBattles` to query by entity fields and return `attackerClan`/`defenderClan`
- Added slot-based allocation for race condition protection
- Fixed SQL CASE quoting

### 3. Frontend Updates

#### Clan.tsx
- Updated to use `side` field for attacker/defender filtering
- Uses `attackerClan`/`defenderClan` from updated query

#### Shrine Page (`page.tsx`)
- Fixed `defenderVillageId` prop to use `sectorOwnerVillageId` instead of non-deterministic `userWars[0]`

### 4. Policy Update (CLAUDE.md)
- Added "No Legacy Fields" policy to Database Patterns section
- Clarifies that legacy fields should be fully removed during refactoring

## Key Design Decisions

1. **No Legacy Fields**: Completely removed `clan1Id`/`clan2Id` - all code now uses `attackerEntityId`/`defenderEntityId`
2. **Slot-Based Capacity**: Added `slot` field with unique constraint to prevent race conditions when multiple users try to join simultaneously
3. **Only Attackers Initiate**: Defenders cannot start the battle, only attackers can
4. **DB-Truth for Cleanup**: Queue deletion uses fresh count from DB, not stale snapshot

## Constants (from constants.ts)
- `SHRINE_BATTLE_MIN_ATTACKERS = 2` - Minimum attackers to start
- `SHRINE_BATTLE_MAX_USERS_PER_SIDE = 3` - Maximum per side
- `SHRINE_BATTLE_LOBBY_SECONDS = 60` - Lobby wait time

## Files Modified

### Schema
- `app/drizzle/schema.ts` - Removed legacy fields, added slot + unique constraint

### Backend
- `app/src/server/api/routers/clan.ts` - Migrated to entity fields, added slot support
- `app/src/server/api/routers/shrine.ts` - Fixed CodeRabbit concerns, added slot support

### Frontend
- `app/src/app/shrine/page.tsx` - Fixed defenderVillageId prop
- `app/src/layout/Clan.tsx` - Updated to use side field

### Documentation
- `CLAUDE.md` - Added no legacy fields policy

## Migration Notes
Database migration generation (`make makemigrations`) needs to be run locally to generate migration for:
1. Removal of `clan1Id`/`clan2Id` columns from `MpvpBattleQueue`
2. Addition of `slot` column to `MpvpBattleUser`
3. Addition of unique constraint on `(clanBattleId, side, slot)`
