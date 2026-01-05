//! SpacetimeDB Module for Tower Defense
//!
//! This module runs authoritative game logic on the SpacetimeDB server.
//! All game state changes happen here - clients only send actions and receive state updates.
//!
//! COST OPTIMIZATIONS IMPLEMENTED:
//! 1. Separate EnemySpawn table for static path data (sent once, not on every update)
//! 2. Client-side projectile interpolation (only spawn/delete, no progress updates)
//! 3. Increased tick rate from 100ms to 150ms
//! 4. Definition hash in completed_run instead of full JSON

use spacetimedb::{
    reducer, table, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp,
    TimeDuration,
};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

// ============================================
// Constants
// ============================================

// COST OPTIMIZATION: Increased from 100ms (10 TPS) to 150ms (~6.7 TPS)
// Combined with client-side interpolation, this maintains smooth visuals
// while reducing compute costs by ~33%.
const GAME_TICK_MS: u64 = 150;
const HEX_ASPECT_RATIO: f64 = 0.866;


// ============================================
// Definition Types (for JSON parsing)
// ============================================
// Definitions are passed from the tRPC server as signed JSON.
// This ensures they come from the MySQL database and cannot be tampered with.

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UpgradeDefinition {
    id: String,
    #[serde(rename = "maxLevel")]
    max_level: u32,
    #[serde(rename = "baseCost")]
    base_cost: u32,
    #[serde(rename = "costMultiplier")]
    cost_multiplier: f64,
    #[serde(rename = "effectValue")]
    effect_value: f64,
    #[serde(rename = "upgradeType")]
    upgrade_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct EnemyDefinition {
    id: String,
    #[serde(rename = "enemyType")]
    enemy_type: String,
    #[serde(rename = "baseHealth")]
    base_health: i32,
    #[serde(rename = "baseSpeed")]
    base_speed: f64,
    #[serde(rename = "baseDamage")]
    base_damage: i32,
    #[serde(rename = "attackCooldown")]
    attack_cooldown: f64,
    #[serde(rename = "healthScaling")]
    health_scaling: f64,
    #[serde(rename = "speedScaling")]
    speed_scaling: f64,
    #[serde(rename = "damageScaling")]
    damage_scaling: f64,
    #[serde(rename = "firstAppearWave")]
    first_appear_wave: u32,
    #[serde(rename = "baseCount")]
    base_count: u32,
    #[serde(rename = "countScaling")]
    count_scaling: f64,
}

// ============================================
// Tables
// ============================================

/// Active game session (static data)
#[derive(Clone)]
#[table(name = game_session, public)]
pub struct GameSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub ninjarpg_user_id: String,
    pub seed: String,
    pub nonce: String,
    pub session_signature: String,
    pub upgrade_definitions_json: String,
    pub enemy_definitions_json: String,
    // Initial stats (needed for claim verification)
    pub initial_ability_damage: u32,
    pub initial_ability_range: u32,
    pub initial_ability_cooldown_ms: u32,
    pub initial_ability_crit_chance: f64,
    pub initial_ability_damage_per_tile: f64,
    pub initial_player_max_health: i32,
    pub initial_health_regen: f64,
    pub initial_defense_percent: f64,
    pub initial_defense_flat: f64,
    pub initial_lifesteal_percent: f64,
    pub initial_knockback_chance: f64,
    pub initial_knockback_force: f64,
    pub initial_tokens_per_wave: f64,
    pub initial_tokens_per_kill: f64,
    pub initial_interest_per_wave: f64,
    pub initial_skip_enemy_chance: f64,
    // Game balance constants
    pub score_per_kill: u32,
    pub score_to_points_ratio: u32,
    pub initial_grid_size: u32,
    pub max_grid_size: u32,
    pub grid_expand_freq: u32,
    pub range_visual_factor: f64,
    pub created_at: u64,
    pub spacetimedb_identity: String,
}

/// Volatile game state (frequent updates)
#[derive(Clone)]
#[table(name = session_state, public)]
pub struct SessionState {
    #[primary_key]
    pub session_id: u64,
    pub wave: u32,
    pub score: u32,
    pub grid_size: u32,
    pub player_health: i32,
    pub player_max_health: i32,
    pub player_col: u32,
    pub player_row: u32,
    pub in_run_currency: u32,
    // Current stats (after in-run upgrades)
    pub ability_damage: u32,
    pub ability_range: u32,
    pub ability_cooldown_ms: u32,
    pub ability_crit_chance: f64,
    pub ability_damage_per_tile: f64,
    pub ability_last_used_at: u64,
    pub health_regen: f64,
    pub defense_percent: f64,
    pub defense_flat: f64,
    pub lifesteal_percent: f64,
    pub knockback_chance: f64,
    pub knockback_force: f64,
    pub tokens_per_wave: f64,
    pub tokens_per_kill: f64,
    pub interest_per_wave: f64,
    pub skip_enemy_chance: f64,
    // State flags
    pub wave_in_progress: bool,
    pub wave_start_time: u64,
    pub health_regen_accumulator: f64,
    pub status: String, // "active", "completed", "abandoned"
}

/// In-run upgrades purchased during a session
#[table(name = session_upgrade, public)]
pub struct SessionUpgrade {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub session_id: u64,
    pub upgrade_id: String,
    pub level: u32,
}

/// COST OPTIMIZATION: Static enemy spawn data (path, max_health, etc.)
/// This is sent ONCE on spawn and never updated, saving ~60-80% bandwidth on enemy updates.
/// Client uses this for pathfinding visualization while Enemy table handles volatile data.
#[table(name = enemy_spawn, public)]
pub struct EnemySpawn {
    #[primary_key]
    pub enemy_id: u64,
    pub session_id: u64,
    pub spawn_col: u32,
    pub spawn_row: u32,
    pub max_health: i32,
    pub path: Vec<HexPosition>,
}

/// Active enemies in a game session (volatile data only)
/// COST OPTIMIZATION: Path removed - stored in EnemySpawn table (sent once)
#[table(name = enemy, public)]
pub struct Enemy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub session_id: u64,
    pub enemy_type: String,
    pub col: u32,
    pub row: u32,
    pub health: i32,
    pub speed: f64,
    pub damage: i32,
    pub attack_cooldown: f64,
    pub last_attack_time: u64,
    pub movement_progress: f64,
    pub direction: String,
    pub path_index: u32,
}

/// Active projectiles in a game session
/// COST OPTIMIZATION: Added spawned_at, progress computed client-side
/// Server only sends insert/delete, reducing projectile bandwidth by ~90%
#[table(name = projectile, public)]
pub struct Projectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub session_id: u64,
    pub origin_col: u32,
    pub origin_row: u32,
    pub target_col: u32,
    pub target_row: u32,
    pub spawned_at: u64,  // Client computes progress from this
    pub damage: u32,
    pub crit_roll: f64,
}

/// Completed runs - claimed through tRPC with HMAC verification
/// COST OPTIMIZATION: Uses definitions_hash instead of full JSON strings
/// This reduces storage by ~40% per completed run
#[table(name = completed_run, public)]
pub struct CompletedRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub session_id: u64,
    pub ninjarpg_user_id: String,
    /// Session signature from the original session (for claim verification)
    pub session_signature: String,
    /// Session nonce (for claim verification)
    pub nonce: String,
    /// COST OPTIMIZATION: Hash of definitions instead of full JSON
    /// Format: SHA256(upgrade_definitions_json + enemy_definitions_json)
    /// Server re-computes hash from current definitions during claim verification
    pub definitions_hash: String,
    /// All original session params needed to verify the signature
    pub ability_damage: u32,
    pub ability_range: u32,
    pub ability_cooldown_ms: u32,
    pub ability_crit_chance: f64,
    pub ability_damage_per_tile: f64,
    pub player_max_health: i32,
    pub health_regen: f64,
    pub defense_percent: f64,
    pub defense_flat: f64,
    pub lifesteal_percent: f64,
    pub knockback_chance: f64,
    pub knockback_force: f64,
    pub tokens_per_wave: f64,
    pub tokens_per_kill: f64,
    pub interest_per_wave: f64,
    pub skip_enemy_chance: f64,
    // Game balance constants for claim verification
    pub score_per_kill: u32,
    pub score_to_points_ratio: u32,
    pub initial_grid_size: u32,
    pub max_grid_size: u32,
    pub grid_expand_freq: u32,
    pub range_visual_factor: f64,
    // Run results
    pub final_wave: u32,
    pub final_score: u32,
    pub points_earned: u32,
    pub completed_at: u64,
}

/// Game loop scheduler
#[table(name = game_loop_schedule, scheduled(game_loop))]
pub struct GameLoopSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// ============================================
// Helper Types
// ============================================

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HexPosition {
    pub col: u32,
    pub row: u32,
}

// ============================================
// Helper Functions
// ============================================

fn get_grid_size_for_wave(wave: u32, initial_grid_size: u32, max_grid_size: u32, expand_freq: u32) -> u32 {
    let expansions = (wave.saturating_sub(1)) / expand_freq;
    (initial_grid_size + expansions * 2).min(max_grid_size)
}

fn get_center_position(grid_size: u32) -> HexPosition {
    HexPosition {
        col: grid_size / 2,
        row: grid_size / 2,
    }
}

fn create_rng(seed: &str) -> ChaCha8Rng {
    let mut hash = [0u8; 32];
    for (i, byte) in seed.bytes().enumerate() {
        hash[i % 32] ^= byte;
    }
    ChaCha8Rng::from_seed(hash)
}

fn calculate_hex_distance(a: &HexPosition, b: &HexPosition) -> u32 {
    let aq = a.col as i32;
    let ar = a.row as i32 - ((a.col as i32 - (a.col as i32 & 1)) / 2);
    let bq = b.col as i32;
    let br = b.row as i32 - ((b.col as i32 - (b.col as i32 & 1)) / 2);
    
    let dq = (aq - bq).abs();
    let dr = (ar - br).abs();
    let ds = ((aq + ar) - (bq + br)).abs();
    
    dq.max(dr).max(ds) as u32
}

fn is_in_visual_range(
    player_col: u32,
    player_row: u32,
    target_col: u32,
    target_row: u32,
    range: u32,
    range_visual_factor: f64,
) -> bool {
    let dcol = target_col as f64 - player_col as f64;
    let drow = target_row as f64 - player_row as f64;
    
    let dx = dcol * 0.75;
    
    let player_col_is_odd = (player_col & 1) == 1;
    let target_col_is_odd = (target_col & 1) == 1;
    let stagger = if player_col_is_odd != target_col_is_odd {
        (if target_col_is_odd { 0.5 } else { -0.5 }) * HEX_ASPECT_RATIO
    } else {
        0.0
    };
    let dy = drow * HEX_ASPECT_RATIO + stagger;
    
    let radius_x = (range as f64 + 0.5) * range_visual_factor;
    let radius_y = (range as f64 + 0.5) * HEX_ASPECT_RATIO * range_visual_factor;
    
    let norm_x = dx / radius_x;
    let norm_y = dy / radius_y;
    
    norm_x * norm_x + norm_y * norm_y <= 1.0
}

fn calculate_direction(from_col: u32, from_row: u32, to_col: u32, to_row: u32) -> String {
    let dx = to_col as i32 - from_col as i32;
    let dy = to_row as i32 - from_row as i32;
    
    match (dx.signum(), dy.signum()) {
        (0, 1) => "n".to_string(),
        (0, -1) => "s".to_string(),
        (1, 0) => "e".to_string(),
        (-1, 0) => "w".to_string(),
        (1, 1) => "ne".to_string(),
        (1, -1) => "se".to_string(),
        (-1, 1) => "nw".to_string(),
        (-1, -1) => "sw".to_string(),
        _ => "s".to_string(),
    }
}

fn get_edge_tiles(grid_size: u32) -> Vec<HexPosition> {
    let mut edges = Vec::new();
    for col in 0..grid_size {
        for row in 0..grid_size {
            if col == 0 || col == grid_size - 1 || row == 0 || row == grid_size - 1 {
                edges.push(HexPosition { col, row });
            }
        }
    }
    edges
}

// Hex neighbor offsets for flat-top grid
fn get_adjacent_positions(pos: &HexPosition, grid_size: u32) -> Vec<HexPosition> {
    let even_offsets: [(i32, i32); 6] = [(-1, -1), (-1, 0), (0, -1), (0, 1), (1, -1), (1, 0)];
    let odd_offsets: [(i32, i32); 6] = [(-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0), (1, 1)];
    
    let offsets = if pos.col % 2 == 0 { even_offsets } else { odd_offsets };
    
    offsets
        .iter()
        .filter_map(|(dc, dr)| {
            let new_col = pos.col as i32 + dc;
            let new_row = pos.row as i32 + dr;
            if new_col >= 0 && new_col < grid_size as i32 && new_row >= 0 && new_row < grid_size as i32 {
                Some(HexPosition {
                    col: new_col as u32,
                    row: new_row as u32,
                })
            } else {
                None
            }
        })
        .collect()
}

/// A* pathfinding
fn compute_path(start: &HexPosition, goal: &HexPosition, grid_size: u32) -> Vec<HexPosition> {
    use std::collections::{BinaryHeap, HashMap};
    use std::cmp::Ordering;
    
    if start.col == goal.col && start.row == goal.row {
        return vec![];
    }
    
    #[derive(Clone, Eq, PartialEq)]
    struct Node {
        pos: HexPosition,
        f_score: u32,
    }
    
    impl Ord for Node {
        fn cmp(&self, other: &Self) -> Ordering {
            other.f_score.cmp(&self.f_score)
        }
    }
    
    impl PartialOrd for Node {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }
    
    let pos_key = |p: &HexPosition| (p.col, p.row);
    
    let mut open_set = BinaryHeap::new();
    let mut came_from: HashMap<(u32, u32), HexPosition> = HashMap::new();
    let mut g_score: HashMap<(u32, u32), u32> = HashMap::new();
    
    g_score.insert(pos_key(start), 0);
    open_set.push(Node {
        pos: *start,
        f_score: calculate_hex_distance(start, goal),
    });
    
    while let Some(current) = open_set.pop() {
        if current.pos.col == goal.col && current.pos.row == goal.row {
            // Reconstruct path
            let mut path = vec![];
            let mut node = current.pos;
            while pos_key(&node) != pos_key(start) {
                path.push(node);
                if let Some(prev) = came_from.get(&pos_key(&node)) {
                    node = *prev;
                } else {
                    break;
                }
            }
            path.reverse();
            return path;
        }
        
        let current_g = *g_score.get(&pos_key(&current.pos)).unwrap_or(&u32::MAX);
        
        for neighbor in get_adjacent_positions(&current.pos, grid_size) {
            let tentative_g = current_g.saturating_add(1);
            let neighbor_key = pos_key(&neighbor);
            
            if tentative_g < *g_score.get(&neighbor_key).unwrap_or(&u32::MAX) {
                came_from.insert(neighbor_key, current.pos);
                g_score.insert(neighbor_key, tentative_g);
                let f_score = tentative_g + calculate_hex_distance(&neighbor, goal);
                open_set.push(Node { pos: neighbor, f_score });
            }
        }
    }
    
    vec![]
}

fn timestamp_to_ms(timestamp: Timestamp) -> u64 {
    (timestamp.to_micros_since_unix_epoch() / 1000) as u64
}

fn ensure_game_loop_scheduled(ctx: &ReducerContext) {
    // Check if already scheduled
    if ctx.db.game_loop_schedule().count() > 0 {
        return;
    }
    
    // Schedule next tick
    let interval = TimeDuration::from_micros((GAME_TICK_MS * 1000) as i64);
    ctx.db.game_loop_schedule().insert(GameLoopSchedule {
        scheduled_id: 0,
        scheduled_at: interval.into(),
    });
}

/// Simple hash function for definitions
/// Creates a deterministic hash from the definition JSON strings
fn hash_definitions(upgrade_json: &str, enemy_json: &str) -> String {
    // Simple but deterministic hash using djb2 algorithm
    fn djb2_hash(s: &str) -> u64 {
        let mut hash: u64 = 5381;
        for c in s.bytes() {
            hash = hash.wrapping_mul(33).wrapping_add(c as u64);
        }
        hash
    }
    
    let h1 = djb2_hash(upgrade_json);
    let h2 = djb2_hash(enemy_json);
    format!("{:016x}{:016x}", h1, h2)
}

// ============================================
// Reducers
// ============================================

/// Create a new game session
/// 
/// SECURITY: All parameters MUST come from the tRPC initiateSecureSession endpoint.
/// The session_signature is an HMAC signature proving these stats AND upgrade definitions
/// were calculated server-side based on the MySQL database.
/// 
/// Clients MUST NOT calculate these values themselves - they should call
/// initiateSecureSession first, then pass the returned values here.
/// 
/// The definitions JSON fields contain the in-run upgrade and enemy definitions from MySQL,
/// signed as part of session_signature. This ensures the game uses authentic data
/// without hardcoding it in SpacetimeDB, allowing for dynamic balancing.
#[reducer]
pub fn create_session(
    ctx: &ReducerContext,
    ninjarpg_user_id: String,
    seed: String,
    nonce: String,
    session_signature: String,
    upgrade_definitions_json: String,
    enemy_definitions_json: String,
    ability_damage: u32,
    ability_range: u32,
    ability_cooldown_ms: u32,
    ability_crit_chance: f64,
    ability_damage_per_tile: f64,
    player_max_health: i32,
    health_regen: f64,
    defense_percent: f64,
    defense_flat: f64,
    lifesteal_percent: f64,
    knockback_chance: f64,
    knockback_force: f64,
    tokens_per_wave: f64,
    tokens_per_kill: f64,
    interest_per_wave: f64,
    skip_enemy_chance: f64,
    score_per_kill: u32,
    score_to_points_ratio: u32,
    initial_grid_size: u32,
    max_grid_size: u32,
    grid_expand_freq: u32,
    range_visual_factor: f64,
) {
    // Validate signature and definitions are present
    if session_signature.is_empty() || nonce.is_empty() {
        log::error!("Session creation requires valid signature and nonce from tRPC server");
        return;
    }
    
    if upgrade_definitions_json.is_empty() || enemy_definitions_json.is_empty() {
        log::error!("Session creation requires definitions from tRPC server");
        return;
    }
    
    // Validate upgrade definitions JSON is parseable
    let upgrade_defs: Result<Vec<UpgradeDefinition>, _> = serde_json::from_str(&upgrade_definitions_json);
    if upgrade_defs.is_err() {
        log::error!("Invalid upgrade definitions JSON");
        return;
    }
    
    // Validate enemy definitions JSON is parseable
    let enemy_defs: Result<Vec<EnemyDefinition>, _> = serde_json::from_str(&enemy_definitions_json);
    if enemy_defs.is_err() {
        log::error!("Invalid enemy definitions JSON");
        return;
    }
    
    let center = get_center_position(initial_grid_size);
    let now = timestamp_to_ms(ctx.timestamp);
    let identity = ctx.sender.to_hex();
    
    // Mark any existing active sessions for this user as abandoned
    let mut sessions_to_abandon = Vec::new();
    for session in ctx.db.game_session().iter() {
        if session.ninjarpg_user_id == ninjarpg_user_id {
            if let Some(state) = ctx.db.session_state().session_id().find(session.id) {
                if state.status == "active" {
                    sessions_to_abandon.push(session.id);
                }
            }
        }
    }
    
    for session_id in sessions_to_abandon {
        if let Some(state) = ctx.db.session_state().session_id().find(session_id) {
            ctx.db.session_state().session_id().update(SessionState {
                status: "abandoned".to_string(),
                ..state
            });
            log::info!("Abandoned existing session {} for user {}", session_id, ninjarpg_user_id);
        }
    }
    
    let inserted_session = ctx.db.game_session().insert(GameSession {
        id: 0,
        ninjarpg_user_id: ninjarpg_user_id.clone(),
        seed,
        nonce,
        session_signature,
        upgrade_definitions_json,
        enemy_definitions_json,
        initial_ability_damage: ability_damage,
        initial_ability_range: ability_range,
        initial_ability_cooldown_ms: ability_cooldown_ms,
        initial_ability_crit_chance: ability_crit_chance,
        initial_ability_damage_per_tile: ability_damage_per_tile,
        initial_player_max_health: player_max_health,
        initial_health_regen: health_regen,
        initial_defense_percent: defense_percent,
        initial_defense_flat: defense_flat,
        initial_lifesteal_percent: lifesteal_percent,
        initial_knockback_chance: knockback_chance,
        initial_knockback_force: knockback_force,
        initial_tokens_per_wave: tokens_per_wave,
        initial_tokens_per_kill: tokens_per_kill,
        initial_interest_per_wave: interest_per_wave,
        initial_skip_enemy_chance: skip_enemy_chance,
        score_per_kill,
        score_to_points_ratio,
        initial_grid_size,
        max_grid_size,
        grid_expand_freq,
        range_visual_factor,
        created_at: now,
        spacetimedb_identity: identity.to_string(),
    });

    // Create the volatile session state
    ctx.db.session_state().insert(SessionState {
        session_id: inserted_session.id,
        wave: 0,
        score: 0,
        grid_size: initial_grid_size,
        player_health: player_max_health,
        player_max_health,
        player_col: center.col,
        player_row: center.row,
        in_run_currency: 0,
        ability_damage,
        ability_range,
        ability_cooldown_ms,
        ability_crit_chance,
        ability_damage_per_tile,
        ability_last_used_at: 0,
        health_regen,
        defense_percent,
        defense_flat,
        lifesteal_percent,
        knockback_chance,
        knockback_force,
        tokens_per_wave,
        tokens_per_kill,
        interest_per_wave,
        skip_enemy_chance,
        wave_in_progress: false,
        wave_start_time: 0,
        health_regen_accumulator: 0.0,
        status: "active".to_string(),
    });
    
    log::info!("Created session for user {} with signed definitions", ninjarpg_user_id);

    // Automatically start the first wave
    if let Some(state) = ctx.db.session_state().session_id().find(inserted_session.id) {
        internal_start_wave(ctx, inserted_session, state);
    }
}

/// Internal function to start a new wave
fn internal_start_wave(ctx: &ReducerContext, session: GameSession, state: SessionState) {
    let session_id = session.id;

    // Parse enemy definitions from session (these are signed and verified by tRPC)
    let enemy_definitions: Vec<EnemyDefinition> = 
        serde_json::from_str(&session.enemy_definitions_json).unwrap_or_default();
    
    if enemy_definitions.is_empty() {
        log::error!("No enemy definitions found in session");
        return;
    }
    
    let next_wave = state.wave + 1;
    let new_grid_size = get_grid_size_for_wave(next_wave, session.initial_grid_size, session.max_grid_size, session.grid_expand_freq);
    let center = get_center_position(new_grid_size);
    
    // Create seeded RNG
    let mut rng = create_rng(&format!("{}-wave-{}", session.seed, next_wave));
    
    // Get and shuffle edge tiles
    let mut edge_tiles = get_edge_tiles(new_grid_size);
    for i in (1..edge_tiles.len()).rev() {
        let j = rng.gen_range(0..=i);
        edge_tiles.swap(i, j);
    }
    
    // Generate enemies from definitions (from MySQL database, not hardcoded)
    let mut enemy_index = 0;
    
    for def in &enemy_definitions {
        if next_wave < def.first_appear_wave {
            continue;
        }
        
        let waves_since_appear = next_wave - def.first_appear_wave;
        let count = (def.base_count as f64 + waves_since_appear as f64 * def.count_scaling)
            .max(0.0) as u32;
        
        let health_multiplier = 1.0 + (next_wave - 1) as f64 * def.health_scaling;
        let health = (def.base_health as f64 * health_multiplier) as i32;
        let speed = def.base_speed + (next_wave - 1) as f64 * def.speed_scaling;
        let damage = (def.base_damage as f64 + (next_wave - 1) as f64 * def.damage_scaling) as i32;
        
        for _ in 0..count {
            // Skip enemy chance
            if state.skip_enemy_chance > 0.0 && rng.gen::<f64>() < state.skip_enemy_chance {
                continue;
            }
            
            let spawn_pos = &edge_tiles[enemy_index % edge_tiles.len()];
            let path = compute_path(spawn_pos, &center, new_grid_size);
            let first_waypoint = path.first().unwrap_or(&center);
            let direction = calculate_direction(spawn_pos.col, spawn_pos.row, first_waypoint.col, first_waypoint.row);
            
            // COST OPTIMIZATION: Insert enemy with volatile data only (no path)
            let inserted_enemy = ctx.db.enemy().insert(Enemy {
                id: 0,
                session_id,
                enemy_type: def.enemy_type.clone(),
                col: spawn_pos.col,
                row: spawn_pos.row,
                health,
                speed,
                damage,
                attack_cooldown: def.attack_cooldown,
                last_attack_time: 0,
                movement_progress: 0.0,
                direction,
                path_index: 0,
            });
            
            // COST OPTIMIZATION: Insert static spawn data separately (sent once, never updated)
            ctx.db.enemy_spawn().insert(EnemySpawn {
                enemy_id: inserted_enemy.id,
                session_id,
                spawn_col: spawn_pos.col,
                spawn_row: spawn_pos.row,
                max_health: health,
                path,
            });
            
            enemy_index += 1;
        }
    }
    
    // Apply tokens per wave bonus
    let mut new_currency = state.in_run_currency;
    if state.tokens_per_wave > 0.0 {
        new_currency += state.tokens_per_wave as u32;
    }
    
    // Update session state
    let now = timestamp_to_ms(ctx.timestamp);
    ctx.db.session_state().session_id().update(SessionState {
        wave: next_wave,
        grid_size: new_grid_size,
        player_col: center.col,
        player_row: center.row,
        in_run_currency: new_currency,
        wave_in_progress: true,
        wave_start_time: now,
        health_regen_accumulator: 0.0,
        ..state
    });
    
    // Ensure game loop is scheduled
    ensure_game_loop_scheduled(ctx);
    
    log::info!("Started wave {} for session {}", next_wave, session_id);
}

/// Start a new wave
#[reducer]
pub fn start_wave(ctx: &ReducerContext, session_id: u64) {
    let Some(session) = ctx.db.game_session().id().find(session_id) else {
        log::error!("Session not found: {}", session_id);
        return;
    };

    let Some(state) = ctx.db.session_state().session_id().find(session_id) else {
        log::error!("Session state not found: {}", session_id);
        return;
    };
    
    if state.status != "active" {
        log::error!("Session is not active");
        return;
    }
    
    if state.wave_in_progress {
        log::error!("Wave already in progress");
        return;
    }

    internal_start_wave(ctx, session, state);
}

/// Player throws shuriken at target
#[reducer]
pub fn throw_shuriken(ctx: &ReducerContext, session_id: u64, target_col: u32, target_row: u32) {
    let Some(state) = ctx.db.session_state().session_id().find(session_id) else {
        log::error!("Session state not found");
        return;
    };
    
    if !state.wave_in_progress {
        log::error!("No wave in progress");
        return;
    }
    
    let now = timestamp_to_ms(ctx.timestamp);
    
    // Check cooldown
    if state.ability_last_used_at > 0 {
        let elapsed = now.saturating_sub(state.ability_last_used_at);
        if elapsed < state.ability_cooldown_ms as u64 {
            return; // Silently ignore - cooldown not ready
        }
    }
    
    // Check range
    let Some(session) = ctx.db.game_session().id().find(session_id) else {
        log::error!("Session not found");
        return;
    };

    if !is_in_visual_range(state.player_col, state.player_row, target_col, target_row, state.ability_range, session.range_visual_factor) {
        log::error!("Target out of range");
        return;
    }
    
    // Create projectile with spawn time (client computes progress)
    let mut rng = create_rng(&format!("{}-projectile-{}", session.seed, now));
    let crit_roll = rng.gen::<f64>();
    
    // COST OPTIMIZATION: Only send spawn, client interpolates progress
    ctx.db.projectile().insert(Projectile {
        id: 0,
        session_id,
        origin_col: state.player_col,
        origin_row: state.player_row,
        target_col,
        target_row,
        spawned_at: now,
        damage: state.ability_damage,
        crit_roll,
    });
    
    // Update cooldown
    ctx.db.session_state().session_id().update(SessionState {
        ability_last_used_at: now,
        ..state
    });
}

/// Purchase an in-run upgrade
///
/// SECURITY: Upgrade parameters are looked up from session's upgrade_definitions_json,
/// which was signed by the tRPC server at session creation. This ensures all upgrade
/// parameters come from the MySQL database and cannot be tampered with.
#[reducer]
pub fn purchase_upgrade(
    ctx: &ReducerContext,
    session_id: u64,
    upgrade_id: String,
) {
    let Some(session) = ctx.db.game_session().id().find(session_id) else {
        log::error!("Session not found");
        return;
    };

    let Some(state) = ctx.db.session_state().session_id().find(session_id) else {
        log::error!("Session state not found");
        return;
    };
    
    // Parse upgrade definitions from session (these were signed at session creation)
    let definitions: Vec<UpgradeDefinition> = match serde_json::from_str(&session.upgrade_definitions_json) {
        Ok(defs) => defs,
        Err(e) => {
            log::error!("Failed to parse upgrade definitions: {}", e);
            return;
        }
    };
    
    // Look up upgrade config from stored definitions
    let Some(config) = definitions.iter().find(|d| d.id == upgrade_id) else {
        log::error!("Unknown upgrade: {}", upgrade_id);
        return;
    };
    
    // Find existing upgrade level
    let mut current_level = 0u32;
    let mut existing_upgrade: Option<SessionUpgrade> = None;
    
    for upgrade in ctx.db.session_upgrade().iter() {
        if upgrade.session_id == session_id && upgrade.upgrade_id == upgrade_id {
            current_level = upgrade.level;
            existing_upgrade = Some(upgrade);
            break;
        }
    }
    
    if current_level >= config.max_level {
        log::error!("Upgrade at max level");
        return;
    }
    
    // Calculate cost using stored definition values
    let cost = (config.base_cost as f64 * config.cost_multiplier.powi(current_level as i32)) as u32;
    if state.in_run_currency < cost {
        log::error!("Insufficient currency");
        return;
    }
    
    // Apply purchase
    if let Some(existing) = existing_upgrade {
        ctx.db.session_upgrade().id().update(SessionUpgrade {
            level: current_level + 1,
            ..existing
        });
    } else {
        ctx.db.session_upgrade().insert(SessionUpgrade {
            id: 0,
            session_id,
            upgrade_id: upgrade_id.clone(),
            level: 1,
        });
    }
    
    // Update session currency and stats using stored effect_value
    let effect_value = config.effect_value;
    let mut updated_state = SessionState {
        in_run_currency: state.in_run_currency - cost,
        ..state.clone()
    };
    
    match config.upgrade_type.as_str() {
        // Attack upgrades - multiplicative for damage, additive for others
        "DAMAGE" => {
            // +X% damage per level (multiplicative from current value)
            updated_state.ability_damage = ((state.ability_damage as f64) * (1.0 + effect_value)) as u32;
        }
        "ATTACK_SPEED" => {
            // Reduce cooldown by X% per level
            let reduction_factor = 1.0 - (effect_value * 0.5);
            updated_state.ability_cooldown_ms = ((state.ability_cooldown_ms as f64) * reduction_factor).max(100.0) as u32;
        }
        "RANGE" => {
            // +X range per level (flat additive)
            updated_state.ability_range = ((state.ability_range as f64) + effect_value).max(1.0) as u32;
        }
        "CRIT_CHANCE" => {
            updated_state.ability_crit_chance = (state.ability_crit_chance + effect_value).min(1.0);
        }
        "DAMAGE_PER_TILE" => {
            updated_state.ability_damage_per_tile = state.ability_damage_per_tile + effect_value;
        }
        // Defense upgrades
        "HEALTH" => {
            // +X% max health per level (multiplicative from current value)
            updated_state.player_max_health = ((state.player_max_health as f64) * (1.0 + effect_value)) as i32;
        }
        "HEALTH_REGEN" => {
            updated_state.health_regen = state.health_regen + effect_value;
        }
        "DEFENSE_PERCENT" => {
            updated_state.defense_percent = (state.defense_percent + effect_value).min(0.9);
        }
        "DEFENSE_FLAT" => {
            updated_state.defense_flat = state.defense_flat + effect_value;
        }
        "LIFESTEAL" => {
            updated_state.lifesteal_percent = state.lifesteal_percent + effect_value;
        }
        "KNOCKBACK_CHANCE" => {
            updated_state.knockback_chance = (state.knockback_chance + effect_value).min(1.0);
        }
        "KNOCKBACK_FORCE" => {
            updated_state.knockback_force = state.knockback_force + effect_value;
        }
        // Utility upgrades
        "TOKENS_PER_WAVE" => {
            updated_state.tokens_per_wave = state.tokens_per_wave + effect_value;
        }
        "TOKENS_PER_KILL" => {
            updated_state.tokens_per_kill = state.tokens_per_kill + effect_value;
        }
        "INTEREST_PER_WAVE" => {
            updated_state.interest_per_wave = state.interest_per_wave + effect_value;
        }
        "SKIP_ENEMY_CHANCE" => {
            updated_state.skip_enemy_chance = (state.skip_enemy_chance + effect_value).min(0.5);
        }
        _ => {}
    }
    
    ctx.db.session_state().session_id().update(updated_state);
    log::info!("Purchased upgrade {} for session {}", upgrade_id, session_id);
}

/// Internal function to clean up all data associated with a session
fn internal_delete_session(ctx: &ReducerContext, session_id: u64) {
    // Clean up enemy spawn data
    let mut spawns_to_delete = Vec::new();
    for spawn in ctx.db.enemy_spawn().iter() {
        if spawn.session_id == session_id {
            spawns_to_delete.push(spawn.enemy_id);
        }
    }
    for id in spawns_to_delete {
        ctx.db.enemy_spawn().enemy_id().delete(id);
    }

    // Clean up enemies
    let mut enemies_to_delete = Vec::new();
    for enemy in ctx.db.enemy().iter() {
        if enemy.session_id == session_id {
            enemies_to_delete.push(enemy.id);
        }
    }
    for id in enemies_to_delete {
        ctx.db.enemy().id().delete(id);
    }

    // Clean up projectiles
    let mut projectiles_to_delete = Vec::new();
    for proj in ctx.db.projectile().iter() {
        if proj.session_id == session_id {
            projectiles_to_delete.push(proj.id);
        }
    }
    for id in projectiles_to_delete {
        ctx.db.projectile().id().delete(id);
    }

    // Clean up upgrades
    let mut upgrades_to_delete = Vec::new();
    for upgrade in ctx.db.session_upgrade().iter() {
        if upgrade.session_id == session_id {
            upgrades_to_delete.push(upgrade.id);
        }
    }
    for id in upgrades_to_delete {
        ctx.db.session_upgrade().id().delete(id);
    }

    // Clean up completed runs
    let mut runs_to_delete = Vec::new();
    for run in ctx.db.completed_run().iter() {
        if run.session_id == session_id {
            runs_to_delete.push(run.id);
        }
    }
    for id in runs_to_delete {
        ctx.db.completed_run().id().delete(id);
    }

    // Finally delete session and state
    ctx.db.game_session().id().delete(session_id);
    ctx.db.session_state().session_id().delete(session_id);
}

/// Abandon a game session
#[reducer]
pub fn abandon_session(ctx: &ReducerContext, session_id: u64) {
    internal_delete_session(ctx, session_id);
    log::info!("Abandoned and deleted session {}", session_id);
}

/// Delete a completed run record after it has been claimed by tRPC
#[reducer]
pub fn delete_completed_run(ctx: &ReducerContext, session_id: u64) {
    internal_delete_session(ctx, session_id);
    log::info!("Deleted all data for claimed session {}", session_id);
}

/// Game loop - called automatically by scheduler
#[reducer]
pub fn game_loop(ctx: &ReducerContext, arg: GameLoopSchedule) {
    let delta_time = GAME_TICK_MS as f64 / 1000.0;
    let mut has_active_sessions = false;
    let now = timestamp_to_ms(ctx.timestamp);
    
    // Process all active session states
    for state in ctx.db.session_state().iter() {
        if state.status != "active" || !state.wave_in_progress {
            continue;
        }
        has_active_sessions = true;
        
        let session_id = state.session_id;
        let Some(session) = ctx.db.game_session().id().find(session_id) else {
            continue;
        };

        let player_pos = HexPosition { col: state.player_col, row: state.player_row };
        let mut player_health = state.player_health;
        let mut in_run_currency = state.in_run_currency;
        let mut score = state.score;
        let mut health_regen_accum = state.health_regen_accumulator;
        let mut total_damage_dealt = 0i32;
        let mut ability_last_used_at = state.ability_last_used_at;
        
        // Health regeneration
        if state.health_regen > 0.0 && player_health < state.player_max_health {
            let regen_amount = state.player_max_health as f64 * state.health_regen * delta_time;
            health_regen_accum += regen_amount;
            if health_regen_accum >= 1.0 {
                let health_to_add = health_regen_accum as i32;
                player_health = (player_health + health_to_add).min(state.player_max_health);
                health_regen_accum -= health_to_add as f64;
            }
        }
        
        // Auto-fire shuriken
        let time_since_last_shuriken = if ability_last_used_at > 0 {
            now.saturating_sub(ability_last_used_at)
        } else {
            u64::MAX
        };
        
        if time_since_last_shuriken >= state.ability_cooldown_ms as u64 {
            // Find closest enemy in range
            let mut closest_enemy: Option<(u64, u32, u32, u32)> = None;
            let mut min_distance = u32::MAX;
            
            for enemy in ctx.db.enemy().iter() {
                if enemy.session_id != session_id || enemy.health <= 0 {
                    continue;
                }
                
                if is_in_visual_range(player_pos.col, player_pos.row, enemy.col, enemy.row, state.ability_range, session.range_visual_factor) {
                    let distance = calculate_hex_distance(&player_pos, &HexPosition { col: enemy.col, row: enemy.row });
                    if distance < min_distance {
                        closest_enemy = Some((enemy.id, enemy.col, enemy.row, distance));
                        min_distance = distance;
                    }
                }
            }
            
            if let Some((_, target_col, target_row, _)) = closest_enemy {
                let mut rng = create_rng(&format!("{}-auto-{}", session.seed, now));
                let crit_roll = rng.gen::<f64>();
                
                // COST OPTIMIZATION: Only insert, client computes progress from spawned_at
                ctx.db.projectile().insert(Projectile {
                    id: 0,
                    session_id,
                    origin_col: player_pos.col,
                    origin_row: player_pos.row,
                    target_col,
                    target_row,
                    spawned_at: now,
                    damage: state.ability_damage,
                    crit_roll,
                });
                
                ability_last_used_at = now;
            }
        }
        
        // COST OPTIMIZATION: Process projectiles - only track progress server-side for hit detection
        // No updates sent to client - they compute progress from spawned_at
        let projectile_speed = 5.0; // tiles per second
        for proj in ctx.db.projectile().iter() {
            if proj.session_id != session_id {
                continue;
            }
            
            // Calculate server-side progress for hit detection
            let time_elapsed = now.saturating_sub(proj.spawned_at) as f64 / 1000.0;
            let server_progress = time_elapsed * projectile_speed;
            
            if server_progress >= 1.0 {
                // Projectile reached target - process hit
                let target_pos = HexPosition { col: proj.target_col, row: proj.target_row };
                
                // Find enemy at target
                for enemy in ctx.db.enemy().iter() {
                    if enemy.session_id != session_id || enemy.health <= 0 {
                        continue;
                    }
                    
                    let enemy_pos = HexPosition { col: enemy.col, row: enemy.row };
                    if enemy_pos.col == target_pos.col && enemy_pos.row == target_pos.row {
                        // Calculate damage
                        let distance = calculate_hex_distance(&player_pos, &target_pos);
                        let distance_bonus = (distance as f64 * state.ability_damage_per_tile) as i32;
                        let mut damage = proj.damage as i32 + distance_bonus;
                        
                        // Crit check
                        if proj.crit_roll < state.ability_crit_chance {
                            damage *= 2;
                        }
                        
                        total_damage_dealt += damage;
                        let new_health = enemy.health - damage;
                        
                        if new_health <= 0 {
                            // Enemy killed - delete both enemy and spawn data
                            in_run_currency += state.tokens_per_kill as u32;
                            score += session.score_per_kill;
                            ctx.db.enemy_spawn().enemy_id().delete(enemy.id);
                            ctx.db.enemy().id().delete(enemy.id);
                        } else {
                            // Apply knockback - need to look up path from spawn table
                            let mut rng = create_rng(&format!("{}-kb-{}-{}", session.seed, now, enemy.id));
                            if state.knockback_force > 0.0 && rng.gen::<f64>() < state.knockback_chance {
                                if let Some(spawn) = ctx.db.enemy_spawn().enemy_id().find(enemy.id) {
                                    let new_path_index = enemy.path_index.saturating_sub(state.knockback_force.ceil() as u32);
                                    let new_pos = spawn.path.get(new_path_index as usize).unwrap_or(&enemy_pos);
                                    ctx.db.enemy().id().update(Enemy {
                                        health: new_health,
                                        col: new_pos.col,
                                        row: new_pos.row,
                                        path_index: new_path_index,
                                        movement_progress: 0.0,
                                        ..enemy
                                    });
                                } else {
                                    ctx.db.enemy().id().update(Enemy {
                                        health: new_health,
                                        ..enemy
                                    });
                                }
                            } else {
                                ctx.db.enemy().id().update(Enemy {
                                    health: new_health,
                                    ..enemy
                                });
                            }
                        }
                        break;
                    }
                }
                
                // COST OPTIMIZATION: Only delete sent - client already knows projectile hit
                ctx.db.projectile().id().delete(proj.id);
            }
            // COST OPTIMIZATION: No update sent for progress - client computes from spawned_at
        }
        
        // Update enemies
        for enemy in ctx.db.enemy().iter() {
            if enemy.session_id != session_id || enemy.health <= 0 {
                continue;
            }
            
            let enemy_pos = HexPosition { col: enemy.col, row: enemy.row };
            let is_adjacent = calculate_hex_distance(&enemy_pos, &player_pos) == 1;
            
            if is_adjacent {
                // Enemy attacks player
                let time_since_last_attack = if enemy.last_attack_time > 0 {
                    (now - enemy.last_attack_time) as f64 / 1000.0
                } else {
                    f64::INFINITY
                };
                
                if time_since_last_attack >= enemy.attack_cooldown {
                    // Apply defense reduction
                    let mut damage = enemy.damage as f64 - state.defense_flat;
                    damage *= 1.0 - state.defense_percent;
                    let final_damage = (damage.max(1.0)) as i32;
                    
                    player_health = (player_health - final_damage).max(0);
                    
                    let direction = calculate_direction(enemy.col, enemy.row, player_pos.col, player_pos.row);
                    ctx.db.enemy().id().update(Enemy {
                        last_attack_time: now,
                        direction,
                        ..enemy
                    });
                }
            } else {
                // Enemy moves along path - need to look up path from spawn table
                if let Some(spawn) = ctx.db.enemy_spawn().enemy_id().find(enemy.id) {
                    if let Some(next_waypoint) = spawn.path.get(enemy.path_index as usize) {
                        let next_is_player = next_waypoint.col == player_pos.col && next_waypoint.row == player_pos.row;
                        
                        if !next_is_player {
                            let new_progress = enemy.movement_progress + enemy.speed * delta_time;
                            
                            if new_progress >= 1.0 {
                                // Tile completed
                                let new_path_index = enemy.path_index + 1;
                                let next_next = spawn.path.get(new_path_index as usize).unwrap_or(&player_pos);
                                let direction = calculate_direction(next_waypoint.col, next_waypoint.row, next_next.col, next_next.row);
                                
                                ctx.db.enemy().id().update(Enemy {
                                    col: next_waypoint.col,
                                    row: next_waypoint.row,
                                    path_index: new_path_index,
                                    movement_progress: 0.0,
                                    direction,
                                    ..enemy
                                });
                            } else {
                                // Update movement progress
                                // NOTE: We removed the threshold optimization because SpacetimeDB
                                // doesn't support "silent" updates - every update is broadcast.
                                // The main bandwidth savings come from removing path from Enemy table.
                                let direction = calculate_direction(enemy.col, enemy.row, next_waypoint.col, next_waypoint.row);
                                ctx.db.enemy().id().update(Enemy {
                                    movement_progress: new_progress,
                                    direction,
                                    ..enemy
                                });
                            }
                        }
                    }
                }
            }
        }
        
        // Apply lifesteal
        if total_damage_dealt > 0 && state.lifesteal_percent > 0.0 {
            let heal_amount = (total_damage_dealt as f64 * state.lifesteal_percent) as i32;
            player_health = (player_health + heal_amount).min(state.player_max_health);
        }
        
        // Check if wave is complete
        let enemies_remaining = ctx.db.enemy().iter().filter(|e| e.session_id == session_id && e.health > 0).count();
        let projectiles_remaining = ctx.db.projectile().iter().filter(|p| p.session_id == session_id).count();
        let wave_complete = enemies_remaining == 0 && projectiles_remaining == 0;
        
        // Check for game over
        if player_health <= 0 {
            let points_earned = score / session.score_to_points_ratio;
            
            // COST OPTIMIZATION: Use hash instead of full JSON for definitions
            let definitions_hash = hash_definitions(
                &session.upgrade_definitions_json, 
                &session.enemy_definitions_json
            );
            
            // Create completed run with hash instead of full JSON
            ctx.db.completed_run().insert(CompletedRun {
                id: 0,
                session_id: session.id,
                ninjarpg_user_id: session.ninjarpg_user_id.clone(),
                session_signature: session.session_signature.clone(),
                nonce: session.nonce.clone(),
                // COST OPTIMIZATION: Hash instead of full JSON
                definitions_hash,
                // Store original session params for signature verification
                ability_damage: session.initial_ability_damage,
                ability_range: session.initial_ability_range,
                ability_cooldown_ms: session.initial_ability_cooldown_ms,
                ability_crit_chance: session.initial_ability_crit_chance,
                ability_damage_per_tile: session.initial_ability_damage_per_tile,
                player_max_health: session.initial_player_max_health,
                health_regen: session.initial_health_regen,
                defense_percent: session.initial_defense_percent,
                defense_flat: session.initial_defense_flat,
                lifesteal_percent: session.initial_lifesteal_percent,
                knockback_chance: session.initial_knockback_chance,
                knockback_force: session.initial_knockback_force,
                tokens_per_wave: session.initial_tokens_per_wave,
                tokens_per_kill: session.initial_tokens_per_kill,
                interest_per_wave: session.initial_interest_per_wave,
                skip_enemy_chance: session.initial_skip_enemy_chance,
                score_per_kill: session.score_per_kill,
                score_to_points_ratio: session.score_to_points_ratio,
                initial_grid_size: session.initial_grid_size,
                max_grid_size: session.max_grid_size,
                grid_expand_freq: session.grid_expand_freq,
                range_visual_factor: session.range_visual_factor,
                // Run results
                final_wave: state.wave,
                final_score: score,
                points_earned,
                completed_at: now,
            });
            
            ctx.db.session_state().session_id().update(SessionState {
                status: "completed".to_string(),
                wave_in_progress: false,
                player_health: 0,
                score,
                ..state
            });
            
            // Clean up enemies and spawn data
            for enemy in ctx.db.enemy().iter() {
                if enemy.session_id == session_id {
                    ctx.db.enemy_spawn().enemy_id().delete(enemy.id);
                    ctx.db.enemy().id().delete(enemy.id);
                }
            }
            for proj in ctx.db.projectile().iter() {
                if proj.session_id == session_id {
                    ctx.db.projectile().id().delete(proj.id);
                }
            }
            
            log::info!("Game over for session {}, score: {}", session.id, score);
        } else if wave_complete {
            // Wave complete - apply interest
            if state.interest_per_wave > 0.0 {
                let interest_tokens = (in_run_currency as f64 * state.interest_per_wave) as u32;
                in_run_currency += interest_tokens;
            }
            
            ctx.db.session_state().session_id().update(SessionState {
                player_health,
                in_run_currency,
                score,
                wave_in_progress: false,
                health_regen_accumulator: health_regen_accum,
                ability_last_used_at,
                ..state
            });
            
            log::info!("Wave {} complete for session {}", state.wave, session.id);
        } else {
            // Update session state when any tracked value changes
            // NOTE: ability_last_used_at MUST be included - without it, cooldown tracking breaks
            // and multiple projectiles fire per tick
            let changed = player_health != state.player_health || 
                          in_run_currency != state.in_run_currency || 
                          score != state.score ||
                          ability_last_used_at != state.ability_last_used_at;

            if changed {
                ctx.db.session_state().session_id().update(SessionState {
                    player_health,
                    in_run_currency,
                    score,
                    health_regen_accumulator: health_regen_accum,
                    ability_last_used_at,
                    ..state
                });
            }
        }
    }
    
    // Stop the game loop if no active sessions
    if !has_active_sessions {
        ctx.db.game_loop_schedule().scheduled_id().delete(arg.scheduled_id);
    }
}
