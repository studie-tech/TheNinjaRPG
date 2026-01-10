# Lift PVP Level Restriction Between Warring Factions

## Issue
- GitHub Issue: #859
- Request: Lift PVP protection (level restriction) between warring factions/villages

## Clarified Requirements
Based on feedback from @theeneon:
- **Only** the level restriction (±15 levels) needs to be bypassed during war
- This should only apply to users whose villages/factions are at war with each other
- Other protections (immunity, PVP disabled zones, rank restrictions) remain unchanged

## Implementation Plan

### Scope
Only modify the level restriction check to bypass when attacker and target are at war.

### Changes Made

#### File: `/app/src/server/api/routers/combat.ts`

1. **Added import** (line 151):
   ```typescript
   import { findWarsWithUser } from "@/libs/war";
   ```

2. **Modified level restriction check** (lines 1607-1635):
   - When a non-compliant target is found (level difference > 15)
   - Check if attacker and target villages are on opposing sides of an active war using `findWarsWithUser()`
   - If at war: bypass the level restriction (allow attack)
   - If not at war: enforce the level restriction as before

### How It Works

The `findWarsWithUser()` function from `/app/src/libs/war.ts`:
- Takes attacker's wars, target's wars, target village ID, and attacker village ID
- Returns wars where the two villages are on **opposing** sides (one on attacker side, one on defender side)
- Also accounts for war allies (villages that joined the war on either side)

### Behavior Summary

| Scenario | Before | After |
|----------|--------|-------|
| Level difference > 15, not in war-torn sector, not at war | Blocked | Blocked |
| Level difference > 15, in war-torn sector | Allowed | Allowed |
| Level difference > 15, villages at war with each other | Blocked | **Allowed** |
| Level difference ≤ 15 | Allowed | Allowed |

## Testing Considerations
- Verify players from warring villages can attack each other regardless of level difference
- Verify players not at war still have level restrictions enforced
- Verify war allies are correctly included in the war check
