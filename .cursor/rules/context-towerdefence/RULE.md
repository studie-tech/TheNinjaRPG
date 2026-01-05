---
description: "Context and architecture for the Tower Defense minigame system - provides comprehensive knowledge about game structure, file organization, and implementation patterns"
alwaysApply: false
---

# Tower Defense System Context

This rule provides detailed context about the Tower Defense minigame, a roguelike-style survival game where the player defends against waves of enemies.

## Game Overview

The Tower Defense game is a wave-based survival minigame within TheNinjaRPG. The player stands at the center of a hexagonal grid and must defeat waves of enemies that spawn from the edges. The game features:

- **Hexagonal grid-based gameplay** using flat-top hex orientation
- **Wave-based enemy spawning** with increasing difficulty
- **Seeded RNG** for deterministic enemy spawning
- **A\* pathfinding** for intelligent enemy movement
- **Auto-targeting shuriken projectiles** with manual override
- **Critical hits** with configurable crit chance
- **Distance-based damage** bonus for long-range attacks
- **In-run upgrade system** using earned tokens
- **Permanent upgrades** system using earned points
- **Player bonuses** (defense, lifesteal, knockback, regen, etc.)
- **Frame-based character animations** for player and enemies
- **Real-time multiplayer architecture** via SpacetimeDB
- **HMAC-signed session security** to prevent stat manipulation

## Architecture: SpacetimeDB with Secure Session Flow

The Tower Defense system uses **SpacetimeDB** as the authoritative game server. All game logic runs server-side with real-time state synchronization to clients via WebSocket.

### Why SpacetimeDB?

- **Authoritative server**: All game state lives on the server, preventing cheating
- **Real-time sync**: WebSocket-based reactive updates to all connected clients
- **Automatic persistence**: SpacetimeDB handles state persistence
- **Scheduled game loop**: 50ms tick rate runs entirely server-side
- **No client-side validation needed**: Server state IS the truth

### Security Architecture

The game uses **HMAC-based session signing** to prevent cheating:

1. **Stats calculated server-side**: All initial player stats come from the tRPC `initiateSecureSession` endpoint
2. **Signed definitions**: Upgrade and enemy definitions from MySQL are included in the signature
3. **Signature verification on claim**: When claiming points, the server re-verifies the signature
4. **No client-side stat calculation**: Clients cannot spoof their upgrade bonuses

### Data Flow

```
Client                          tRPC Server                        SpacetimeDB Server                 MySQL
──────                          ───────────                        ──────────────────                 ─────
initiateSecureSession() ─────────────────────────────────────────────────────────────────────> Fetch upgrades
                        <─────── {signature, params, definitions} ──────────────────────────────── Calculate stats


createSession(signed_params) ───────────────────────────────────────> Store session + signature
                        <─────────────────────────────────────────────── session_update

throwShuriken() ────────────────────────────────────────────────────> throw_shuriken()
                                                                           │
                                                                  [game_loop runs at 50ms]
                                                                           │
                        <──────────────────────────────────────────── projectile_insert
                        <──────────────────────────────────────────── enemy_update
                        <──────────────────────────────────────────── session_update

                                                                  [player dies]
                                                                           │
                        <──────────────────────────────────────────── completed_run

claimCompletedRun(all_params) ───> Verify signature + award points ─────────────────────────────> Save to leaderboard
```

## File Structure & Architecture

### SpacetimeDB Backend (`/app/spacetimedb/src/`)

| File     | Purpose                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| `lib.rs` | Complete game server: tables, reducers, game loop, pathfinding, combat, definition parsing |

#### Key Tables (SpacetimeDB)

| Table                | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `game_session`       | Active game state: player stats, wave, score, signature, definitions JSON |
| `enemy`              | Active enemies with position, health, path                                |
| `projectile`         | In-flight projectiles                                                     |
| `session_upgrade`    | In-run upgrades purchased during session                                  |
| `completed_run`      | Finished runs with all params needed for claim verification               |
| `game_loop_schedule` | Scheduler for 50ms tick                                                   |

#### Key Reducers (SpacetimeDB)

| Reducer            | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `create_session`   | Start new game with signed stats and definitions         |
| `start_wave`       | Spawn enemies using stored enemy definitions, begin wave |
| `throw_shuriken`   | Fire projectile at target (manual override)              |
| `purchase_upgrade` | Buy in-run upgrade using stored upgrade definitions      |
| `abandon_session`  | End session early                                        |
| `game_loop`        | Scheduled: movement, combat, auto-fire                   |

### SpacetimeDB Client (`/app/src/libs/spacetimedb/`)

| File        | Purpose                                                            |
| ----------- | ------------------------------------------------------------------ |
| `client.ts` | Connection manager, event handling, reducer calls, type re-exports |
| `bindings/` | Auto-generated TypeScript types from SpacetimeDB schema            |

### Core Game Logic (`/app/src/libs/towerDefense/`)

| File           | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `game.ts`      | Client-side utilities: direction helpers, visual range checking, seed generation        |
| `abilities.ts` | Initial stat calculation from permanent upgrades (used by tRPC before session creation) |
| `upgrades.tsx` | UI utilities: icons, colors, labels, sorting for upgrade display                        |

### Server Utilities (`/app/src/server/utils/`)

| File                    | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `towerDefenseCrypto.ts` | HMAC signing/verification for session params, nonce generation, type exports |

### ThreeJS Rendering (`/app/src/libs/threejs/`)

| File                     | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `towerDefense.ts`        | Grid creation, background, player/enemy sprites, health bars |
| `towerDefenseEffects.ts` | Projectile animations, impact effects, damage numbers        |
| `FrameAnimator.ts`       | Character animation system (idle, moving, throw, punch)      |

### React Components (`/app/src/layout/`)

| File                       | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `TowerDefense.tsx`         | Main ThreeJS canvas, animation loop, rendering |
| `TowerDefenseUpgrades.tsx` | UI for purchasing permanent upgrades           |

### State Management (`/app/src/hooks/`)

| File                   | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `useTowerDefense.ts`   | SpacetimeDB connection, event handling, state transformation, claiming |
| `towerDefenseEnemy.ts` | Form hook for editing enemy definitions in the manual module           |

### Backend tRPC (`/app/src/server/api/routers/`)

| File              | Purpose                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `towerDefense.ts` | Secure session initiation, permanent upgrades, leaderboards, enemy management |

The tRPC router handles **persistent data and security**:

- `getUpgrades`: Get upgrade definitions from MySQL
- `getUserUpgrades`: Get user's permanent upgrades and points
- `initiateSecureSession`: Calculate stats server-side, return signed params + definitions + asset configs
- `purchasePermanentUpgrade`: Buy permanent upgrades with points
- `getRunHistory`: Get user's past runs
- `getLeaderboard`: Get top scores
- `claimCompletedRun`: Verify HMAC signature and claim completed run from SpacetimeDB
- `getEnemies`: Get all enemy definitions from database
- `getEnemy`: Get single enemy definition by ID
- `createEnemy`: Create new enemy (staff only)
- `updateEnemy`: Update enemy stats and settings (staff only)
- `deleteEnemy`: Delete enemy definition (staff only)
- `processCharacterZip`: Process uploaded ZIP file and extract sprites to UploadThing
- `updateAssetConfig`: Update animation configuration (staff only)

### Manual Module (`/app/src/app/manual/towerDefenseEnemy/`)

| File                      | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `page.tsx`                | List all enemy definitions, create/delete enemies |
| `edit/[enemyid]/page.tsx` | Edit enemy stats and upload character assets      |

### Validators (`/app/src/validators/`)

| File              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `towerDefense.ts` | Zod schemas for game types, cost calculation, CharacterAssetConfig, enemies |

### Page (`/app/src/app/towerDefense/`)

| File       | Purpose                                                    |
| ---------- | ---------------------------------------------------------- |
| `page.tsx` | Main page component - lobby UI, game canvas, HUD, overlays |

### Constants (`/app/drizzle/constants.ts`)

All tower defense constants are prefixed with `TD_`:

- `TD_INITIAL_GRID_SIZE`: Starting grid size (7)
- `TD_MAX_GRID_SIZE`: Maximum grid size (15)
- `TD_GRID_EXPAND_EVERY_N_WAVES`: Grid expansion frequency (5 waves)
- `TD_SCORE_PER_KILL`: Points earned per kill (10)
- `TD_SCORE_TO_POINTS_RATIO`: Score to permanent points conversion (100:1)
- `TD_PLAYER_BASE_HEALTH`: Starting player health (100)
- `TD_SHURIKEN_BASE_DAMAGE`, `TD_SHURIKEN_BASE_RANGE`, `TD_SHURIKEN_BASE_COOLDOWN`
- `TD_BASE_CRIT_CHANCE`: Base critical hit chance (0%)
- `TD_BASE_DAMAGE_PER_TILE`: Extra damage per tile traveled (0)
- `TD_RANGE_VISUAL_FACTOR`: Visual factor for ellipse-based range checking (0.85)
- `TD_ENEMY_DIRECTIONS`: Array of valid direction strings (n, ne, e, etc.)

**Note:** Enemy definitions are no longer constants - they are stored in the database (`towerDefenseEnemy` table) and managed via the manual module.

## Key Concepts

### Secure Session Flow

The game uses HMAC-based signing to prevent cheating:

```
1. Client calls tRPC `initiateSecureSession`
2. Server fetches user's permanent upgrades from MySQL
3. Server fetches upgrade and enemy definitions from MySQL/constants
4. Server calculates initial stats using abilities.ts functions
5. Server creates HMAC signature of (userId, nonce, all stats, definitions)
6. Client receives: signature, calculated params, upgrade definitions, enemy definitions
7. Client passes ALL of this to SpacetimeDB's create_session reducer
8. SpacetimeDB stores everything including the signature
9. During gameplay, SpacetimeDB uses stored definitions for upgrades/spawning
10. When run ends, SpacetimeDB creates CompletedRun with all original params
11. Client calls tRPC claimCompletedRun with all params from CompletedRun
12. Server re-calculates signature and verifies it matches before awarding points
```

**Key Security Points:**

- Stats are NEVER calculated client-side
- Definitions are signed to prevent tampering
- The signature covers ALL parameters including definitions
- SpacetimeDB uses stored (signed) definitions, not client-provided ones during gameplay

### SpacetimeDB Game Loop

The server runs a scheduled `game_loop` reducer every 50ms that handles:

1. **Auto-fire shuriken**: Finds closest enemy in range, fires if cooldown ready
2. **Projectile updates**: Move projectiles, check for hits, apply damage
3. **Enemy movement**: A\* pathfinding, movement interpolation
4. **Enemy attacks**: Damage player when adjacent
5. **Health regen**: Apply player health regeneration
6. **Lifesteal**: Heal player based on damage dealt
7. **Knockback**: Push enemies back on hit (chance-based)
8. **Wave completion**: Check if all enemies dead, apply interest bonus
9. **Game over**: Create completed_run record with all session params for verification

### Enemy Types & Wave Composition

Enemy types are now **stored in the MySQL database** (`towerDefenseEnemy` table) and can be managed through the manual module at `/manual/towerDefenseEnemy`.

Each enemy definition includes:

- **Combat stats**: baseHealth, baseSpeed, baseDamage, attackCooldown
- **Scaling factors**: healthScaling, speedScaling, damageScaling, countScaling
- **Spawn info**: firstAppearWave, baseCount
- **Visual config**: scaleFactor, assetConfig (JSON field for sprite animations)

The `assetConfig` JSON field stores the `CharacterAssetConfig` type, which includes:

- `rotations`: Static direction sprites (8 directions)
- `animations`: Array of animation configs for idle, moving, punch states

**Definitions are passed to SpacetimeDB as signed JSON** during session creation, allowing dynamic balance changes without redeploying SpacetimeDB. The signature ensures these come from the server. Asset configs are passed separately (not signed) since they're only visual.

### Hex Grid System

Uses `honeycomb-grid` library with flat-top orientation:

- Player is always at center (`get_center_position()`)
- Enemies spawn from edges (`get_edge_tiles()`)
- Distance calculations use axial coordinates (`calculate_hex_distance()`)
- **Visual range uses ellipse-based checking** (`is_in_visual_range()`) to account for hex aspect ratio
- Grid expands every N waves to increase challenge

### A\* Pathfinding

Enemies use A\* pathfinding in the SpacetimeDB server:

- `compute_path()` calculates shortest path from spawn to center
- Each enemy stores pre-computed `path_json` and `path_index`
- Path stored as JSON array of `{col, row}` positions
- Knockback pushes enemy back along their path

### Movement & Direction

8 cardinal/intercardinal directions: `n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`

Enemy direction calculated via `calculate_direction()` for sprite rendering.

Enemies have `movement_progress` (0-1) for smooth interpolation between tiles.

### Upgrade System

#### Upgrade Categories

Upgrades organized into categories in `TowerDefenseUpgradeCategories`:

| Category  | Upgrade Types                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------- |
| ATTACK    | DAMAGE, ATTACK_SPEED, RANGE, CRIT_CHANCE, DAMAGE_PER_TILE                                         |
| DEFENSE   | HEALTH, HEALTH_REGEN, DEFENSE_PERCENT, DEFENSE_FLAT, LIFESTEAL, KNOCKBACK_CHANCE, KNOCKBACK_FORCE |
| UTILITY   | TOKENS_PER_WAVE, TOKENS_PER_KILL, INTEREST_PER_WAVE, SKIP_ENEMY_CHANCE                            |
| ABILITIES | ABILITY_UNLOCK                                                                                    |

#### Two Types of Upgrades

1. **Permanent upgrades**: Purchased with Tower Defense Points (MySQL), persist across runs
2. **In-run upgrades**: Purchased with tokens (SpacetimeDB), last only for current session

In-run upgrades tracked in `session_upgrade` table in SpacetimeDB.

### Player Bonuses System

The `PlayerBonuses` type aggregates all passive bonuses from upgrades:

**Defense Bonuses:**

- `healthRegen`: % of max health regenerated per second
- `defensePercent`: % damage reduction (capped at 90%)
- `defenseFlat`: Flat damage reduction applied first
- `lifestealPercent`: % of damage dealt healed back
- `knockbackChance`: Chance to push enemies back on hit
- `knockbackForce`: Number of tiles to push back

**Utility Bonuses:**

- `tokensPerWave`: Flat tokens added at wave start
- `tokensPerKill`: Tokens earned per kill (default 10)
- `interestPerWave`: % interest on tokens at wave end
- `skipEnemyChance`: Chance for enemies to not spawn (capped at 50%)

### Damage Calculation (Server-Side)

Damage is calculated in `game_loop`:

1. **Base damage** from ability
2. **Distance bonus**: `baseDamage + (distance * damagePerTile)`
3. **Critical hit**: If `crit_roll < critChance`, damage is doubled

Defense applied via:

1. Flat defense subtracted first
2. Percentage defense applied to remainder
3. Minimum 1 damage

### Game State Flow

```
lobby → connecting → playing (wave 0) → wave-end → playing (wave N) → wave-end → ...
                                              ↓
                                   game-over ← player dies → claiming → lobby
```

Game modes: `lobby`, `connecting`, `playing`, `wave-end`, `game-over`, `claiming`

### In-Run Token Economy

1. **Earning tokens:**

   - Per kill: `tokensPerKill` (default 10)
   - Per wave start: `tokensPerWave` bonus
   - Per wave end: `interestPerWave` % of current tokens

2. **Spending tokens:**
   - Purchase in-run upgrades via `purchase_upgrade` reducer
   - Cost formula: `baseCost * (costMultiplier ^ currentLevel)`

### Animation System

Uses `FrameAnimator` class for character animations:

- States: `idle`, `moving`, `throw`, `punch`
- Frame-based sprite sheets loaded per direction
- Different configs for player vs light/heavy enemies

## Implementation Patterns

### Adding a New Enemy Type

1. **Navigate to** `/manual/towerDefenseEnemy` and click "New Enemy"
2. **Configure stats**: Set base health, speed, damage, cooldown, and scaling factors
3. **Upload character assets**: Upload a ZIP file containing sprites with a `metadata.json` file
4. **Configure animations**: Select which uploaded animation to use for each state (idle, moving, punch)
5. **Save**: The enemy will be available in the next game session

The manual module handles:

- Creating the database record
- Processing uploaded ZIP files and extracting sprites to UploadThing
- Building the `CharacterAssetConfig` JSON from the metadata
- Allowing staff to configure animation state mappings

**Note:** Enemy definitions are passed as signed JSON, so new enemies are immediately available without any code changes or redeployment.

### Adding a New Ability

1. Add ability constants in `@/drizzle/constants.ts`
2. Add fields to `GameSession` table in `lib.rs`
3. Add fields to `create_session` reducer parameters
4. Add to `SessionParams` type in `towerDefenseCrypto.ts`
5. Update `signSessionParams()` canonicalization
6. Handle in `game_loop` auto-fire logic
7. Add visual effects in `towerDefenseEffects.ts`
8. Update `useTowerDefense.ts` to expose ability in game state
9. Add to `initiateSecureSession` in tRPC router

### Adding a New Upgrade Type

1. Add to `TowerDefenseUpgradeTypes` in constants
2. Add to appropriate category in `TowerDefenseUpgradeCategories`
3. Add icon in `getUpgradeIcon()` (`upgrades.tsx`)
4. Add color in `getUpgradeColor()` and `getUpgradeBorderColor()` (`upgrades.tsx`)
5. Handle effect application in `purchase_upgrade` reducer in `lib.rs`
6. Handle in `applyUpgradesToAbility()` or `calculatePlayerBonuses()` (`abilities.ts`)
7. Create upgrade record in database via seed/migration

### Adding a New Player Bonus

1. Add field to `playerBonusesSchema` in `validators/towerDefense.ts`
2. Add field to `GameSession` table in `lib.rs`
3. Add parameter to `create_session` reducer
4. Add to `SessionParams` type in `towerDefenseCrypto.ts`
5. Update `signSessionParams()` canonicalization (order matters!)
6. Apply bonus in `game_loop` reducer
7. Add calculation in `calculatePlayerBonuses()` (`abilities.ts`)
8. Add to `initiateSecureSession` return type in tRPC router
9. Update `useTowerDefense.ts` to pass bonus to SpacetimeDB
10. Update `claimCompletedRun` input schema to include the new param

## Testing Considerations

- Use browser automation to test gameplay (Playwright)
- Test with different wave numbers to verify scaling
- Check animation states transition correctly
- Test in-run upgrade purchases during gameplay
- Verify defense bonuses reduce damage correctly
- Test lifesteal heals player appropriately
- Verify knockback pushes enemies back along their path
- **Test SpacetimeDB connection handling** (connect/disconnect/reconnect)
- **Test real-time sync** by observing enemy/projectile updates
- **Test session resumption**: disconnect mid-game, reconnect to existing session
- **Test signature verification**: ensure claim fails with tampered params
- **Test performance**: Verify 60fps during combat with profiler output

## ⚠️ CRITICAL: Performance Architecture

**The Tower Defense game MUST maintain 60fps during gameplay.** Any React re-render of the parent page will block the Three.js animation loop and cause frame drops. This section documents the performance-critical architecture that MUST be followed.

### Core Principle: Separate React Renders from Three.js Animation

The Three.js animation loop runs on `requestAnimationFrame` at 60fps. React re-renders block the main thread. Therefore:

1. **Three.js scene MUST NOT depend on React state for runtime data**
2. **Parent page MUST NOT re-render during gameplay**
3. **All dynamic game data MUST flow through refs, not props**

### Data Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                    MODULE LEVEL (globalThis)                              │
│                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│  │  hudStore (singleton via globalThis)                                              │   │
│  │  - values: { score, enemyCount, playerHealth, maxHealth, abilities, ... }        │   │
│  │  - listeners: Set<() => void>                                                     │   │
│  │  - update(): Creates NEW object reference for useSyncExternalStore detection     │   │
│  └──────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼ syncHudStore() calls hudStore.update()
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                    useTowerDefense Hook                                   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌──────────────────────┐          ┌──────────────────────┐                             │
│  │   React State        │          │      Refs            │                             │
│  │   (gameState)        │          │  (entitiesRef,       │                             │
│  │                      │          │   runtimeStateRef)   │                             │
│  │  - mode              │          │                      │                             │
│  │  - runId             │          │  - enemies Map       │                             │
│  │  - error             │          │  - projectiles       │                             │
│  │  - existingSession   │          │  - score             │                             │
│  │                      │          │  - currentWave       │                             │
│  │  ONLY for:           │          │  - playerHealth      │                             │
│  │  mode changes,       │          │  - abilities         │                             │
│  │  lobby UI            │          │                      │                             │
│  └────────┬─────────────┘          └────────┬─────────────┘                             │
│           │                                  │                                           │
└───────────┼──────────────────────────────────┼───────────────────────────────────────────┘
            │                                  │
            ▼                                  ▼
    ┌───────────────┐              ┌─────────────────┐              ┌─────────────────┐
    │   Page.tsx    │              │ TowerDefense.tsx│              │    GameHUD      │
    │  (lobby UI,   │              │  (Three.js,     │              │  (wrapped in    │
    │   overlays)   │              │   reads refs)   │              │   memo())       │
    │               │              │                 │              │                 │
    │  Re-renders   │              │  NEVER          │              │  Subscribes via │
    │  on mode      │              │  re-renders     │              │  useHudStoreValues() │
    │  changes only │              │  from props     │              │  (useSyncExternalStore) │
    └───────────────┘              └─────────────────┘              └─────────────────┘
```

### What Goes Where

| Data Type                            | Storage                                           | Why                                             |
| ------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| Game mode (`lobby`, `playing`, etc.) | React state (`gameState`)                         | Changes UI layout, infrequent                   |
| Enemies (positions, health, paths)   | `entitiesRef`                                     | Updates 20x/sec per enemy, would kill perf      |
| Projectiles                          | `entitiesRef`                                     | High-frequency updates                          |
| Score, wave, health (HUD values)     | `runtimeStateRef` → `hudStore` (module singleton) | Updates frequently, only HUD needs to re-render |
| Player position, abilities           | `runtimeStateRef`                                 | Animation loop reads directly                   |
| Hit events (for effects)             | `playerHitEventsRef`, `enemyHitEventsRef`         | Animation loop reads directly                   |

### Entity Store Pattern (`entitiesRef`)

```typescript
interface EntityStore {
  enemies: Map<string, TowerDefenseEnemy>; // Fast lookup by ID
  projectiles: Map<string, TowerDefenseProjectile>;
  enemiesArray: TowerDefenseEnemy[]; // Pre-computed for iteration
  projectilesArray: TowerDefenseProjectile[];
  enemiesVersion: number; // Change detection
  projectilesVersion: number;
}
```

**Rules:**

- SpacetimeDB events update the Map directly
- Arrays are regenerated on insert/delete (not update)
- Version numbers increment on any change
- Animation loop reads `enemiesArray`/`projectilesArray` directly

### HUD Store Pattern (`hudStore`)

The HUD uses a **module-level global singleton** with `useSyncExternalStore` to subscribe to value changes without causing parent re-renders.

#### Why Global Singleton?

In Next.js development with Hot Module Replacement (HMR), module-level variables can be recreated on each reload, causing multiple store instances. Using `globalThis` ensures a true singleton:

```typescript
// In useTowerDefense.ts - Module level (outside component)
const HUD_STORE_KEY = "__TOWER_DEFENSE_HUD_STORE__" as const;

const createHudStore = (): HudStore => {
  const listeners = new Set<() => void>();
  let values: HudValues = { score: 0, playerHealth: 0 /* ... */ };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getValues: () => values,
    update: (newValues: Partial<HudValues>) => {
      // CRITICAL: Create NEW object for Object.is() change detection
      values = { ...values, ...newValues };
      listeners.forEach((l) => l());
    },
  };
};

// TRUE GLOBAL SINGLETON: Survives HMR
const getHudStore = (): HudStore => {
  if (typeof globalThis !== "undefined") {
    if (!globalThis[HUD_STORE_KEY]) {
      globalThis[HUD_STORE_KEY] = createHudStore();
    }
    return globalThis[HUD_STORE_KEY];
  }
  return createHudStore();
};

const hudStore = getHudStore();
```

#### useSyncExternalStore Usage

**CRITICAL**: Pass `getValues` directly as the snapshot function. React uses `Object.is()` to compare snapshots - since `update()` creates a new object via spread, changes are detected:

```typescript
// Custom hook for HUD components
export const useHudStoreValues = (): HudValues => {
  // Returns values directly - Object.is() detects new object references
  return useSyncExternalStore(hudStore.subscribe, hudStore.getValues, hudStore.getValues);
};
```

**Common Mistake**: Don't use a version number as snapshot and call `getValues()` separately - this breaks change detection:

```typescript
// ❌ WRONG - version number doesn't help React detect value changes
useSyncExternalStore(subscribe, getSnapshot); // getSnapshot returns version
return hudStore.getValues(); // Called separately - React doesn't track this

// ✅ CORRECT - React tracks the actual values object
return useSyncExternalStore(subscribe, getValues, getValues);
```

#### HUD Component Pattern

HUD components MUST be wrapped with `memo()` to prevent parent re-renders from affecting them:

```typescript
// In page.tsx - GameHUD component
const GameHUD = memo(function GameHUD() {
  // Only THIS component re-renders when store updates
  const values = useHudStoreValues();
  // ... render HUD
});

// In page.tsx - InRunUpgradesWrapper component
const InRunUpgradesWrapper = memo(function InRunUpgradesWrapper(props) {
  const values = useHudStoreValues();
  // ... render upgrades UI
});
```

### When to Call `syncHudStore()`

The `syncHudStore()` function reads from `runtimeStateRef` and calls `hudStore.update()`:

```typescript
const syncHudStore = useCallback(() => {
  const runtime = runtimeStateRef.current;
  hudStore.update({
    score: runtime.score,
    playerHealth: runtime.state?.playerHealth ?? 0,
    enemyCount: runtime.enemyCount,
    // ... other HUD values
  });
}, []);
```

| Event                           | Call syncHudStore? | Why                               |
| ------------------------------- | ------------------ | --------------------------------- |
| `enemy_insert`                  | ✅ YES             | Enemy count changed               |
| `enemy_update`                  | ❌ NO              | Only position changed, count same |
| `enemy_delete`                  | ✅ YES             | Enemy count changed               |
| `session_update` (non-critical) | ✅ YES             | Score/health may have changed     |
| `session_update` (mode change)  | ✅ YES             | Also sync HUD for initial values  |
| `projectile_*`                  | ❌ NO              | Projectiles not shown in HUD      |

### Three.js Component Rules (`TowerDefense.tsx`)

1. **Use `memo()` with `() => true` comparison:**

   ```typescript
   const TowerDefense = memo(
     forwardRef<TowerDefenseHandle, TowerDefenseProps>((props, ref) => {
       // ... component
     }),
     () => true // NEVER re-render from props
   );
   ```

2. **Read all dynamic data from refs in animation loop:**

   ```typescript
   const animate = () => {
     // ✅ CORRECT: Read from refs
     const currentEnemies = entitiesRef.current?.enemiesArray ?? [];
     const runtimeState = runtimeStateRef.current;

     // ❌ WRONG: Would require prop changes to update
     // const currentEnemies = props.enemies;
   };
   ```

3. **Use `usePerformanceMonitor(false)` - NEVER `true`:**

   ```typescript
   // ✅ CORRECT: Uses requestAnimationFrame, syncs with display refresh
   const performanceMonitor = usePerformanceMonitor(false);

   // ❌ WRONG: Uses setTimeout, causes ~20fps instead of 60fps
   const performanceMonitor = usePerformanceMonitor(true);
   ```

4. **Props are for INITIAL values only:**

   ```typescript
   interface TowerDefenseProps {
     seed: string; // Initial seed (never changes)
     initialGridSize: number; // Starting grid size
     initialPlayerPosition: HexPosition;
     onTileClick: (pos: HexPosition) => void; // Stable callback
     entitiesRef: React.RefObject<EntityStore>; // Ref, not data
     runtimeStateRef: React.RefObject<RuntimeState>;
     // ... other refs
   }
   ```

5. **Use imperative handles for updates that MUST trigger changes:**
   ```typescript
   useImperativeHandle(
     ref,
     () => ({
       updateGrid: (newGridSize: number) => {
         /* ... */
       },
       updateRange: (newRange: number) => {
         /* ... */
       },
     }),
     []
   );
   ```

### Page Component Rules (`page.tsx`)

1. **HUD components use module-level `useHudStoreValues` hook:**

   ```typescript
   // HUD components subscribe directly to module-level store
   // No props needed - prevents parent re-renders from affecting HUD
   <GameHUD />
   <InRunUpgradesWrapper {...otherProps} />
   ```

2. **Use stable callbacks with `useCallback`:**

   ```typescript
   const handleTileClick = useCallback(
     (position: HexPosition) => {
       throwShuriken(position.col, position.row);
     },
     [throwShuriken]
   );
   ```

3. **Conditionally render Three.js only when ready:**
   ```typescript
   {gameState.seed && gameState.state && (
     <TowerDefenseCanvas
       seed={gameState.seed}
       initialGridSize={gameState.state.gridSize}
       // ...
     />
   )}
   ```

### SpacetimeDB Event Handler Rules (`useTowerDefense.ts`)

1. **Entity events update refs, NOT React state:**

   ```typescript
   case "enemy_update":
     updateEnemyInStore(event.enemy);  // Updates ref only
     // NO setGameState or syncHudStore here - count unchanged!
     break;

   case "enemy_delete":
     deleteEnemyFromStore(event.enemyId);  // Updates ref
     syncHudStore();  // Enemy count changed - update HUD
     break;
   ```

2. **Only mode changes trigger setGameState:**

   ```typescript
   if (needsImmediateUpdate) {
     setGameState((prev) => ({ ...prev, mode: newMode, ... }));
     syncHudStore();  // Also sync HUD for initial values
   } else {
     syncHudStore();  // Just update HUD, don't re-render page
   }
   ```

3. **Profile all event handlers:**
   ```typescript
   case "enemy_update":
     profiler.mark("stdb_event_enemy_update");
     updateEnemyInStore(event.enemy);
     endMark();
     break;
   ```

### Performance Debugging

Use the built-in profiler to diagnose issues:

```typescript
// In browser console, look for:
// 🎮 Performance Profile (last 2.0s)
// 📊 FPS: 60.0 | Frame Time: 16.67ms avg
// ⏱️ Budget (16.67ms): 0% frames over budget
```

**Red flags:**

- FPS below 55 during combat
- `animate_total` > 10ms average
- Large gap between `animate_total` and Frame Time (indicates React re-renders)
- High max frame time (> 100ms) indicates blocking operations

**Common causes of poor performance:**

1. React state updates during gameplay → Use refs instead
2. `usePerformanceMonitor(true)` → Change to `false`
3. Props changing on memoized components → Pass refs instead
4. Parent page re-rendering → Use `useSyncExternalStore` for HUD
5. Creating new arrays/objects in render → Memoize or use refs
6. HUD components not wrapped in `memo()` → Wrap with `memo()`
7. Multiple hudStore instances (HMR issue) → Use `globalThis` singleton

**Debugging HUD updates not working:**

1. Check console for `[hudStore.update]` logs - is `update()` being called?
2. Verify `old===new: false` - is a new object being created?
3. Check that `useHudStoreValues` returns values from `useSyncExternalStore` directly
4. Ensure HUD components are wrapped in `memo()` to isolate re-renders

### Checklist: Before Committing Changes

- [ ] No new `useState` for data that changes during combat
- [ ] No new props to `TowerDefense.tsx` that change during gameplay
- [ ] `syncHudStore()` called appropriately (not on every event)
- [ ] New event handlers update refs, not React state
- [ ] Test FPS remains at 60 during combat with profiler
- [ ] `usePerformanceMonitor(false)` is used (not `true`)
- [ ] HUD components use `useHudStoreValues` and are wrapped in `memo()`

## Database Schema References

### MySQL (Drizzle ORM - `@/drizzle/schema`)

- `towerDefenseUpgrade`: Upgrade definitions (id, name, description, image, maxLevel, baseCost, costMultiplier, upgradeType, effectValue)
- `userTowerDefenseUpgrade`: User's purchased permanent upgrades (userId, upgradeId, level)
- `towerDefenseRun`: Completed run history for leaderboards (id, seed, userId, wave, score, status)
- `towerDefenseEnemy`: Enemy definitions (id, name, description, image, combat stats, scaling factors, spawn config, scaleFactor, assetConfig JSON)
- `userData.towerDefensePoints`: Permanent points balance

The `towerDefenseEnemy.assetConfig` JSON field stores `CharacterAssetConfig`:

```typescript
interface CharacterAssetConfig {
  rotations: Record<SpriteDirection, string>; // direction -> URL
  animations: Array<{
    name: string;
    state: "idle" | "moving" | "throw" | "punch";
    frames: Record<SpriteDirection, string[]>; // direction -> frame URLs
    frameDurationMs: number;
    loop: boolean;
  }>;
}
```

### SpacetimeDB (Rust - `lib.rs`)

- `GameSession`: Active game state with all player stats, bonuses, **signature, nonce, definitions JSON**
- `Enemy`: Active enemies with position, health, path
- `Projectile`: In-flight projectiles
- `SessionUpgrade`: In-run upgrades for current session
- `CompletedRun`: Finished runs with **all original session params** for claim verification

**Important:** `GameSession` and `CompletedRun` store `session_signature`, `nonce`, `upgrade_definitions_json`, and `enemy_definitions_json` to enable secure claim verification.

## Common Tasks

### Debugging Enemy Movement

Check `game_loop` in `lib.rs` for movement logic. Enemies follow their pre-computed A\* paths stored in `path_json`.

### Debugging Projectiles

Check `game_loop` projectile update section in `lib.rs`. Projectiles update progress and check for hits at target position.

### Debugging Animations

Check `FrameAnimator.ts` and the state management in `TowerDefense.tsx`.

### Debugging SpacetimeDB Connection

Check `client.ts` for connection state handling. The `useTowerDefense.ts` hook handles events and transforms SpacetimeDB types to game state.

### Debugging Player Bonuses

Check `game_loop` in `lib.rs` for how bonuses are applied (defense, lifesteal, knockback, etc.).

### Debugging Signature Verification Failures

1. Check `towerDefenseCrypto.ts` - ensure `canonicalizeSessionParams()` uses the same field order
2. Verify all floating point values use `.toFixed(6)` for consistent serialization
3. Check that definitions are sorted by ID before hashing
4. Ensure `TOWER_DEFENSE_HMAC_SECRET` env var is set consistently
5. Compare the signature generated in `initiateSecureSession` with the one verified in `claimCompletedRun`

### Debugging Run Claiming Issues

1. Check the `CompletedRun` record in SpacetimeDB contains all required params
2. Verify the `useTowerDefense.ts` hook's `returnToLobby` function passes all fields
3. Check `claimCompletedRun` input schema matches what SpacetimeDB stores
4. Look for timing-safe comparison failures in the tRPC endpoint

### Debugging HUD Not Updating

The HUD system has several potential failure points. Debug in order:

1. **Is `syncHudStore()` being called?**

   - Add logging to event handlers that should update HUD
   - Check `handleSessionUpdate` and `deleteEnemyFromStore` callbacks

2. **Is `hudStore.update()` receiving correct values?**

   ```typescript
   // Add temporary logging in hudStore.update
   console.log("[hudStore.update]", newValues);
   ```

3. **Is the object reference changing?**

   ```typescript
   // Check that update() creates new object
   const oldValues = values;
   values = { ...values, ...newValues };
   console.log("old===new:", oldValues === values); // Should be false
   ```

4. **Are listeners being notified?**

   ```typescript
   console.log("[hudStore.update] listeners:", listeners.size);
   ```

5. **Is `useHudStoreValues` returning new values?**

   - Ensure it uses `useSyncExternalStore(subscribe, getValues, getValues)`
   - NOT `useSyncExternalStore(subscribe, getSnapshot)` with separate `getValues()` call

6. **Multiple hudStore instances (HMR issue)?**

   - Check that `globalThis[HUD_STORE_KEY]` is used for singleton
   - In dev, HMR can create multiple module instances

7. **Component not wrapped in `memo()`?**
   - HUD components should be wrapped in `memo()` to isolate re-renders
   - Without `memo()`, parent re-renders can mask HUD updates

## SpacetimeDB Development

### Running Locally

```bash
# From /app/spacetimedb/
spacetimedb start  # Start local SpacetimeDB server
spacetimedb publish towerdefense --project-path .  # Deploy module
```

### Generating Bindings

```bash
# After changing lib.rs
spacetimedb generate --lang typescript --out-dir ../src/libs/spacetimedb/bindings
```

### Environment Variables

**SpacetimeDB Connection:**

- `NEXT_PUBLIC_SPACETIMEDB_HOST`: WebSocket URL (default: `ws://127.0.0.1:3001` local, `wss://spacetimedb.com` prod)
- `NEXT_PUBLIC_SPACETIMEDB_MODULE`: Module name (default: `towerdefense`)

**Security:**

- `TOWER_DEFENSE_HMAC_SECRET`: Secret key for HMAC session signing (required in production, falls back to derived key in dev)

### Crypto Utilities (`towerDefenseCrypto.ts`)

Key functions:

- `signSessionParams(params)`: Generate HMAC-SHA256 signature of session parameters
- `generateSessionNonce()`: Create unique nonce for each session
- `canonicalizeSessionParams(params)`: Create deterministic string for hashing (order matters!)
- `canonicalizeUpgrade(upgrade)`: Convert upgrade definition to canonical string
- `canonicalizeEnemy(enemy)`: Convert enemy definition to canonical string

**Important:** When adding new parameters to `SessionParams`:

1. Add to the type interface
2. Add to `canonicalizeSessionParams()` in the correct order
3. Use `.toFixed(6)` for floating point values
4. Update both `initiateSecureSession` and `claimCompletedRun` endpoints
