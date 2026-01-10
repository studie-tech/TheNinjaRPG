# MPVP Shrine Battle System Implementation Plan

## Overview
This task implements the MPVP Shrine Wars feature which allows players to team up and challenge shrines together, as specified in Issue #659.

## Current State
The PR has implemented basic backend functionality but has the following gaps:
1. Legacy `clan1Id`/`clan2Id` fields are still required and used alongside new `attackerEntityId`/`defenderEntityId` fields
2. Frontend components for the team-based shrine battle lobby are missing
3. The shrine page only supports 1v1 battles, not the new MPVP team battles

## Implementation Plan

### Phase 1: Schema Refactoring
1. **Make `clan1Id`/`clan2Id` nullable in `mpvpBattleQueue` table**
   - These fields should become optional since shrine battles use village IDs, not clan IDs
   - The new `attackerEntityId`/`defenderEntityId` fields are more generic and should be the primary fields

2. **Update relations**
   - The clan1/clan2 relations reference clan table, but shrine battles reference villages
   - May need to conditionally handle relations based on `battleType`

### Phase 2: Backend Updates
1. **Update clan router (`clan.ts`)**
   - Modify `challengeClan` to set `clan1Id` and `clan2Id` only when needed for backward compatibility
   - Use `attackerEntityId`/`defenderEntityId` as primary identifiers

2. **Update shrine router (`shrine.ts`)**
   - Remove redundant `clan1Id`/`clan2Id` assignments when creating shrine battles
   - The shrine battles should only use `attackerEntityId`/`defenderEntityId`

### Phase 3: Frontend Implementation
1. **Create ShrineBattleLobby component**
   - Display active shrine battle lobbies for a sector
   - Show attackers and defenders with join/leave buttons
   - Timer showing lobby countdown (60 seconds)
   - Initiate battle button (enabled when min 2 attackers and lobby time passed)

2. **Update shrine page (`app/src/app/shrine/page.tsx`)**
   - Add support for MPVP shrine battles alongside existing 1v1 battles
   - Show available shrine battle lobbies
   - Allow creating new shrine battle challenges
   - Allow joining existing lobbies as attacker or defender

### Phase 4: Migration & Testing
1. Generate database migration for nullable `clan1Id`/`clan2Id`
2. Run linting to ensure code quality
3. Verify TypeScript types are correct

## Files to Modify

### Schema
- `app/drizzle/schema.ts` - Make clan1Id/clan2Id nullable

### Backend
- `app/src/server/api/routers/clan.ts` - Update challengeClan to use new entity fields
- `app/src/server/api/routers/shrine.ts` - Remove legacy field assignments

### Frontend
- `app/src/app/shrine/page.tsx` - Add MPVP shrine battle UI
- Create new component for shrine battle lobby

## Key Design Decisions

1. **Backward Compatibility**: Clan battles will continue to set `clan1Id`/`clan2Id` for relations to work, but primary logic uses new entity fields
2. **Shrine Battles**: Only use `attackerEntityId`/`defenderEntityId` since clans are not involved
3. **AI Defenders**: When no player defenders join, AI defenders from village's `shrineSettings.activeAiIds` are used

## Constants (from constants.ts)
- `SHRINE_BATTLE_MIN_ATTACKERS = 2` - Minimum attackers to start
- `SHRINE_BATTLE_MAX_USERS_PER_SIDE = 3` - Maximum per side
- `SHRINE_BATTLE_LOBBY_SECONDS = 60` - Lobby wait time

## Progress

- [x] Phase 1: Schema Refactoring
- [x] Phase 2: Backend Updates
- [x] Phase 3: Frontend Implementation
- [ ] Phase 4: Migration & Testing (migration generation requires manual approval)

## Changes Made

### Schema (`app/drizzle/schema.ts`)
- Made `clan1Id`/`clan2Id` nullable in `mpvpBattleQueue` table
- Made `attackerEntityId`/`defenderEntityId` required (now primary identifiers)
- Added comments explaining the legacy vs new fields

### Backend (`app/src/server/api/routers/shrine.ts`)
- Removed legacy `clan1Id`/`clan2Id` field assignments from `challengeShrine` mutation
- Shrine battles now only use `attackerEntityId`/`defenderEntityId`

### Frontend - New Component (`app/src/layout/ShrineBattleLobby.tsx`)
- Created comprehensive shrine battle lobby component
- Shows attacker and defender slots (up to 3 per side)
- Join/Leave functionality for both sides
- Countdown timer for lobby wait time (60 seconds)
- Start battle button with minimum attacker requirement check (2 minimum)
- User avatar popovers with level/rank info
- Empty slot indicators with join-on-click functionality
- AI defender fallback notification

### Frontend - Updated Page (`app/src/app/shrine/page.tsx`)
- Added tabs to switch between "Solo Battle" and "Team Battle" modes
- Integrated ShrineBattleLobby component
- Team battle tab shows when user can attack a shrine owned by another village
- Both tabs available during active wars for maximum flexibility
