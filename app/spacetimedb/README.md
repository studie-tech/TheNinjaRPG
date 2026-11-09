# Tower Defense SpacetimeDB Module (Rust)

This is the authoritative game server for the Tower Defense minigame, written in Rust and running on SpacetimeDB.

## Architecture

All game logic runs server-side on SpacetimeDB. Clients connect via WebSocket, subscribe to tables for real-time updates, and call reducers to perform actions.

### Tables

- `game_session` - Session identity, signed definitions, initial stats and final results
- `session_state` - Volatile per-session state (wave, score, health, current stats)
- `session_upgrade` - In-run upgrades purchased during a session
- `enemy_queued` - Enemies queued to spawn during the current wave
- `enemy_spawn` - Static data for a spawned enemy (path, max health), written once
- `enemy` - Volatile enemy state (position, health, movement progress)
- `projectile` - Active projectiles (shurikens); clients compute flight progress from `spawned_at`
- `completed_run` - Finished games (claimed via tRPC with HMAC verification)
- `game_loop_schedule` - Scheduler for the 10 TPS game loop

### Reducers

- `create_session` - Start a new game with server-signed initial stats and upgrade definitions
- `start_wave` - Begin the next wave, spawning enemies
- `throw_shuriken` - Manual attack (auto-fire is also implemented)
- `purchase_upgrade` - Buy in-run upgrades using signed definitions
- `abandon_session` - Quit the current game
- `delete_completed_run` - Delete a session and all of its rows after its reward is claimed
- `game_loop` - Scheduled reducer running at 10 TPS (`GAME_TICK_MS` = 100ms)

Every reducer that acts on an existing session only accepts calls from the identity that
created it (`game_session.spacetimedb_identity`). The web client keeps its SpacetimeDB token
in `localStorage` so that identity survives reloads. Rewards are claimed through tRPC, which
reads the result from `completed_run` itself and verifies the session signature.

## Prerequisites

- [Rust](https://rustup.rs/) (for building the module)
- [SpacetimeDB CLI](https://spacetimedb.com/install)

The CLI, server, Rust module and TypeScript SDK must use the same SpacetimeDB
release. The Make targets select the CLI version from `app/package.json` without
changing the machine's global default. `make spacetime-install` installs that
version; override `SPACETIME_BIN` for a different installation location. A 1.x
server must be upgraded before it runs the 2.x module and client; follow the
[upstream migration guide](https://spacetimedb.com/docs/upgrade/).

## Local Development

### First-time Setup

```bash
# Install SpacetimeDB CLI (if not installed)
make spacetime-install

# Start local SpacetimeDB server (in a separate terminal)
make spacetime-start

# Build and publish the module, then generate TypeScript bindings
make spacetime-publish-local
```

### Development Workflow

```bash
# After making changes to src/lib.rs:

# 1. Rebuild, republish and regenerate the TypeScript bindings
make spacetime-publish-local

# 2. Watch logs (in separate terminal)
make spacetime-logs-follow
```

### Useful Commands

```bash
make spacetime-build        # Build the module without publishing
make spacetime-generate     # Regenerate TypeScript bindings only
make spacetime-logs         # View recent logs
make spacetime-logs-follow  # Follow logs in real-time
```

---

## Deployment Targets

The web client connects to `NEXT_PUBLIC_SPACETIMEDB_HOST`, which defaults to
`wss://maincloud.spacetimedb.com` in production builds and `ws://127.0.0.1:3001`
otherwise (`app/src/libs/spacetimedb/config.ts`). `make spacetime-publish-prod`
publishes to the CLI's default server (Maincloud unless changed with
`spacetime server set-default`). The section below
covers self-hosting instead, with the host variable pointing at your own server.

## Self-Hosted EC2 Deployment

This section explains how to deploy SpacetimeDB on your own EC2 instance with SSL/TLS encryption.

### EC2 Instance Requirements

- **Instance type**: t3.small or larger (2 GB RAM minimum)
- **OS**: Amazon Linux 2023
- **Storage**: 20 GB EBS
- **Security Group**:
  - Port 22 (SSH)
  - Port 80 (HTTP)
  - Port 443 (HTTPS)

### Domain Setup

1. Create an A record in your DNS pointing to the EC2 instance IP
   - Example: `spacetimedb.theninja-rpg.com` → `<EC2-PUBLIC-IP>`

### Deployment Steps

#### 1. Connect to EC2

```bash
ssh -i your-key.pem ec2-user@<EC2-PUBLIC-IP>
```

#### 2. Clone the Repository

```bash
git clone https://github.com/studie-tech/TheNinjaRPG.git
cd TheNinjaRPG/app/spacetimedb
```

Or copy just the spacetimedb folder:

```bash
scp -i your-key.pem -r app/spacetimedb ec2-user@<EC2-PUBLIC-IP>:~/
```

#### 3. Run Setup Script

```bash
# Set your domain (or edit setup.sh)
export SPACETIMEDB_DOMAIN="spacetimedb.theninja-rpg.com"

# Make executable and run
chmod +x setup.sh
./setup.sh
```

This script will:

- Install Rust and SpacetimeDB CLI
- Configure SpacetimeDB as a systemd service
- Build and publish the Tower Defense module
- Set up Nginx as a reverse proxy

#### 4. Configure SSL with Let's Encrypt

```bash
# Install Certbot
sudo dnf install -y python3-pip
sudo pip3 install certbot certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d spacetimedb.theninja-rpg.com

# Set up auto-renewal
echo "0 0,12 * * * root python3 -c 'import random; import time; time.sleep(random.random() * 3600)' && certbot renew -q" | sudo tee -a /etc/crontab > /dev/null
```

#### 5. Update Game Environment

In your Next.js environment (`.env` or Vercel settings):

```env
NEXT_PUBLIC_SPACETIMEDB_HOST=wss://spacetimedb.theninja-rpg.com
NEXT_PUBLIC_SPACETIMEDB_MODULE=towerdefense
TOWER_DEFENSE_HMAC_SECRET=<random secret>
TOWER_DEFENSE_CLAIMS_ENABLED=true
```

`TOWER_DEFENSE_HMAC_SECRET` signs session data and is required in production.
Reward claims are refused unless `TOWER_DEFENSE_CLAIMS_ENABLED` is exactly `true`.

### Server Management

#### Service Commands

```bash
# Check status
sudo systemctl status spacetimedb

# View logs
sudo journalctl -u spacetimedb -f
tail -f /opt/spacetimedb/logs/spacetimedb.log

# Restart service
sudo systemctl restart spacetimedb

# Stop service
sudo systemctl stop spacetimedb
```

#### Republishing the Module

After making changes to `src/lib.rs`:

```bash
cd ~/TheNinjaRPG/app/spacetimedb

# Build and publish
spacetime build
spacetime publish --server http://127.0.0.1:3000 towerdefense
```

#### Nginx Commands

```bash
# Test configuration
sudo nginx -t

# Reload configuration
sudo systemctl reload nginx

# View access logs
sudo tail -f /var/log/nginx/access.log

# View error logs
sudo tail -f /var/log/nginx/error.log
```

### Troubleshooting

#### Connection Issues

1. **Check SpacetimeDB is running**:

   ```bash
   curl http://127.0.0.1:3000/database/ping
   sudo systemctl status spacetimedb
   ```

2. **Check Nginx is proxying correctly**:

   ```bash
   curl -v https://spacetimedb.theninja-rpg.com/health
   ```

3. **Check WebSocket connectivity** (from local machine):
   ```bash
   wscat -c wss://spacetimedb.theninja-rpg.com
   ```

#### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```

#### Module Not Found

If clients can't find the module:

```bash
# List published modules
spacetime list --server http://127.0.0.1:3000

# Republish
spacetime publish --server http://127.0.0.1:3000 towerdefense
```

#### curl-minimal Conflict (Amazon Linux 2023)

Amazon Linux 2023 uses `curl-minimal` by default. If you see package conflicts when trying to install curl:

```
Problem: package curl-minimal conflicts with curl
```

**Solution**: Don't install the full `curl` package. The `curl-minimal` that comes with Amazon Linux 2023 works fine for all the installers. The setup script already handles this by using `wget` as a fallback.

#### SpacetimeDB Service Won't Start

Check the service logs:

```bash
sudo journalctl -u spacetimedb -n 100
tail -f /opt/spacetimedb/logs/spacetimedb.log
```

Common issues:

- **Port already in use**: Check if something else is using port 3000
- **Permission denied**: Ensure the data directory is owned by your user
- **Binary not found**: Verify the spacetime binary path in the service file

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        EC2 Instance                         │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │   Nginx     │────▶│ SpacetimeDB │────▶│   Module     │  │
│  │  (443/80)   │     │   (3000)    │     │ towerdefense │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│        │                                                    │
│        │ SSL/TLS                                           │
│        ▼                                                    │
└─────────────────────────────────────────────────────────────┘
         │
         │ wss://spacetimedb.theninja-rpg.com
         ▼
┌─────────────────┐
│  Game Client    │
│  (Browser)      │
└─────────────────┘
```

---

## Client Integration

The TypeScript bindings are generated to `app/src/libs/spacetimedb/bindings/`. The client connection is managed in `app/src/libs/spacetimedb/client.ts`.

The client:

1. Connects to SpacetimeDB via WebSocket
2. Subscribes to the user's `game_session` and `completed_run` rows (a guest's session by
   its seed) and to `session_state`;
   once a session is active, to that session's `enemy`, `enemy_spawn`, `projectile`,
   `session_upgrade`, `session_state` and `game_session` rows
3. Receives real-time updates as tables change
4. Calls reducers to perform actions

## Game Loop

The game runs at 10 ticks per second (`GAME_TICK_MS` = 100ms). For each active session
with a wave in progress, a tick:

1. Spawns the next queued enemy when its spawn time has come
2. Applies health regeneration
3. Auto-fires shuriken at nearest enemy in range
4. Resolves projectile hits and applies damage
5. Updates enemy positions and attacks
6. Applies lifesteal from damage dealt
7. Checks for wave completion or game over
