# Tower Defense SpacetimeDB Module (Rust)

This is the authoritative game server for the Tower Defense minigame, written in Rust and running on SpacetimeDB.

## Architecture

All game logic runs server-side on SpacetimeDB. Clients connect via WebSocket, subscribe to tables for real-time updates, and call reducers to perform actions.

### Tables

- `game_session` - Active game sessions with player stats
- `enemy` - Enemies currently in the game
- `projectile` - Active projectiles (shurikens)
- `session_upgrade` - In-run upgrades purchased during a session
- `completed_run` - Finished games (claimed via tRPC with HMAC verification)
- `game_loop_schedule` - Scheduler for the 20 TPS game loop

### Reducers

- `create_session` - Start a new game with server-signed initial stats and upgrade definitions
- `start_wave` - Begin the next wave, spawning enemies
- `throw_shuriken` - Manual attack (auto-fire is also implemented)
- `purchase_upgrade` - Buy in-run upgrades using signed definitions
- `abandon_session` - Quit the current game
- `game_loop` - Scheduled reducer running at 20 TPS (50ms)

## Prerequisites

- [Rust](https://rustup.rs/) (for building the module)
- [SpacetimeDB CLI](https://spacetimedb.com/install)

## Commands

### First-time Setup

```bash
# Install SpacetimeDB CLI (if not installed)
make spacetime-install

# Start local SpacetimeDB server (in a separate terminal)
make spacetime-start

# Build and publish the module
make spacetime-publish-local

# Generate TypeScript bindings
make spacetime-generate
```

### Development Workflow

```bash
# After making changes to src/lib.rs:

# 1. Publish updated module (will rebuild automatically)
make spacetime-publish-local

# 2. Regenerate TypeScript bindings
make spacetime-generate

# 3. Watch logs (in separate terminal)
make spacetime-logs-follow
```

### Useful Commands

```bash
make spacetime-build        # Build the module without publishing
make spacetime-logs         # View recent logs
make spacetime-logs-follow  # Follow logs in real-time
```

## Client Integration

The TypeScript bindings are generated to `app/src/libs/spacetimedb/bindings/`. The client connection is managed in `app/src/libs/spacetimedb/client.ts`.

The client:

1. Connects to SpacetimeDB via WebSocket
2. Subscribes to relevant tables (game_session, enemy, projectile)
3. Receives real-time updates as tables change
4. Calls reducers to perform actions

## Game Loop

The game runs at 20 ticks per second (50ms interval). Each tick:

1. Applies health regeneration
2. Auto-fires shuriken at nearest enemy in range
3. Updates projectile positions and applies damage
4. Updates enemy positions and attacks
5. Applies lifesteal from damage dealt
6. Checks for wave completion or game over
