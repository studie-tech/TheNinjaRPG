import type { Grid } from "honeycomb-grid";
import type { RenderLayer } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import {
  IMG_AVATAR_DEFAULT,
  IMG_BATTLEFIELD_TOMBSTONE,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  WORLD_DAY_BRIGHTNESS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { AggroDisplay } from "@/libs/combat/aggroDisplay";
import type { HitSeverity } from "@/libs/combat/playback";
import { isClone } from "@/libs/combat/summon";
import type { ReturnedBattle, ReturnedUserState } from "@/libs/combat/types";
import {
  getClan,
  getEffectiveCurPool,
  getFacingDirection,
  getVillage,
} from "@/libs/combat/util";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { lpcFacing } from "@/libs/lpc/catalog";
import { walkDuration, walkProgress } from "@/libs/rendering/animation";
import { spriteGroundContact } from "@/libs/rendering/assets";
import { createCharacterAnimation } from "@/libs/rendering/characterAnimation";
import { createCombatMaxPoolCache } from "@/libs/rendering/combatMaxPools";
import { createSoftShadowTexture } from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createStatusMeter } from "@/libs/rendering/primitives/statusMeter";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { isObjectChainVisible } from "@/libs/rendering/visibility";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import type { LpcAnimation, LpcDirection, SpriteAction } from "@/validators/lpc";

const LPC_COMBAT_SCALE = 0.75;
/** Strides keep up with the battlefield's faster traversal without changing map walking. */
const WALK_CYCLE_RATE = 2.4;
/** A struck fighter is thrown back and blinks; harder hits throw further and hold longer. */
const HIT_REACTIONS = {
  light: { ms: 300, reach: 0.2 },
  heavy: { ms: 380, reach: 0.32 },
  crushing: { ms: 500, reach: 0.48 },
};
const HIT_FLASH_TINT = 0xff4a3a;
/** Fallback lengths for cues whose outfit has no authored clip. */
const CUE_DURATIONS: Record<LpcAnimation, number> = {
  stand: 0,
  idle: 0,
  combat: 0,
  walk: 0,
  slash: 480,
  thrust: 640,
  spellcast: 560,
  shoot: 1040,
  hurt: 480,
};

/** Scene-owned fighters keep art, interpolation and display values outside battle state. */
export const createCombatActors = (
  game: GameRenderer,
  grid: Grid<TerrainHex>,
  onStep: () => void,
  shadows?: WorldShadows,
  layers?: { ground: RenderLayer; world: RenderLayer; ui: RenderLayer },
) => {
  const container = new Container(),
    records = new Map<string, Fighter>();
  const pending = new Set<Promise<unknown>>();
  const getMaxPools = createCombatMaxPoolCache(),
    paths = new PathCalculator(grid);
  let snapshot: CombatActorSnapshot | null = null;
  let brightness = WORLD_DAY_BRIGHTNESS;
  let needsSort = true,
    expiresAt = Number.POSITIVE_INFINITY,
    calculatedAt = 0,
    animatedAt = 0;
  const shadow = createSoftShadowTexture();
  game.own(() => shadow.destroy(true));
  const sync = (next: CombatActorSnapshot) => {
    snapshot = next;
    const wanted = new Set(next.battle.usersState.map((user) => user.userId));
    for (const [id, record] of records)
      if (!wanted.has(id)) {
        record.scope.dispose();
        records.delete(id);
        needsSort = true;
      }
    for (const source of next.battle.usersState) {
      // The authenticated player's own portrait may be redacted in a public battle snapshot.
      const user =
        source.userId === next.viewer?.userId
          ? {
              ...source,
              avatar: next.viewer.avatar,
              avatarLight: next.viewer.avatarLight,
              username: next.viewer.username,
            }
          : source;
      const tile = grid.getHex({ col: user.longitude, row: user.latitude });
      if (!tile) continue;
      let record = records.get(user.userId);
      const parts = combatActorParts(user, tile, next.battle);
      const signature = JSON.stringify(parts);
      if (!record || record.signature !== signature) {
        if (!record && (user.curHealth <= 0 || user.fledBattle)) continue;
        const previous = record;
        const previousPosition = previous
          ? { x: previous.root.x, y: previous.root.y }
          : null;
        previous?.scope.dispose();
        const scope = createRenderScope(game),
          root = new Container(),
          artRoot = new Container();
        const character = parts.find((part) => part.character);
        const figure = parts.find((part) => part.shadowCaster === "character");
        const figureScale = character ? LPC_COMBAT_SCALE : 1;
        // LPC feet sit near row 60 of the 64px frame; ground cues share that contact point.
        const groundY = character
          ? character.y - character.size * (0.5 - 4 / 64)
          : figure
            ? figure.y - figure.size / 2
            : tile.height * 0.28;
        const shadowSprite = new Sprite(shadow);
        shadowSprite.anchor.set(0.5);
        // A compact contact stays beneath the feet alongside directional light shadows.
        shadowSprite.width = tile.width * 0.45 * figureScale;
        shadowSprite.height = tile.height * 0.2 * figureScale;
        shadowSprite.scale.y *= -1;
        shadowSprite.position.set(tile.width / 2, figure ? groundY : tile.height * 0.3);
        const selection = groundSelection(tile, true, groundY),
          hover = groundSelection(tile, false, groundY);
        artRoot.label = "combat-art";
        // Ground cues stay below artwork; the compact HUD clears both LPC heads and NPC portraits.
        root.addChild(shadowSprite, selection, hover, artRoot);
        layers?.ground.attach(shadowSprite, selection, hover);
        layers?.world.attach(artRoot);
        // Contiguous full-height rows keep all resource colors readable at mobile map scale.
        const meterWidth = tile.width / 2,
          meterHeight = tile.height / 10;
        const lastMeterIndex = "curChakra" in user ? 2 : "curStamina" in user ? 1 : 0;
        const hudClearance =
          lastMeterIndex * meterHeight + meterHeight / 2 + tile.height * 0.03;
        const hudTop =
          tile.height * (user.isAi && user.isOriginal ? 1.71 : 1.07) +
          hudClearance +
          // Keep the same head clearance when the LPC frame is raised within its hex.
          (character ? character.y - character.size / 2 : 0);
        const meter = (color: number, index: number) =>
          createStatusMeter({
            width: meterWidth,
            height: meterHeight,
            color,
            x: (tile.width - meterWidth) / 2,
            y: hudTop - index * meterHeight,
          });
        const hp = createStatusMeter({
          width: meterWidth,
          height: meterHeight,
          color: 0xb22222,
          trailColor: 0xffe08a,
          x: (tile.width - meterWidth) / 2,
          y: hudTop,
        });
        const sp = "curStamina" in user ? meter(0x008000, 1) : null;
        const cp = "curChakra" in user ? meter(0x0000ff, 2) : null;
        hp.container.label = "combat-health";
        if (sp) sp.container.label = "combat-stamina";
        if (cp) cp.container.label = "combat-chakra";
        const threat = createStatusMeter({
          width: meterWidth,
          height: meterHeight,
          color: 0xfbbf24,
          x: (tile.width - meterWidth) / 2,
          y: hudTop + meterHeight,
        });
        threat.container.label = "combat-aggro";
        const highestThreat = new Graphics()
          .poly([
            -tile.height * 0.07,
            0,
            -tile.height * 0.035,
            tile.height * 0.035,
            0,
            0,
            -tile.height * 0.035,
            -tile.height * 0.035,
          ])
          .fill(0xf59e0b)
          .stroke({ color: 0x15232c, width: tile.height * 0.014 });
        highestThreat.label = "combat-aggro-highest";
        threat.container.addChild(highestThreat);
        root.addChild(threat.container);
        root.addChild(hp.container);
        layers?.ui.attach(hp.container, threat.container);
        if (sp) {
          root.addChild(sp.container);
          layers?.ui.attach(sp.container);
        }
        if (cp) {
          root.addChild(cp.container);
          layers?.ui.attach(cp.container);
        }
        root.label = user.userId;
        container.addChild(root);
        scope.own(() => {
          if (!root.destroyed)
            root.destroy({ children: true, texture: false, textureSource: false });
        });
        record = {
          scope,
          root,
          artRoot,
          art: null,
          spriteAnimation: undefined,
          signature,
          user,
          tile: previous?.tile ?? tile,
          target: previous?.target ?? tile,
          walk: previous?.walk ?? null,
          hitX: 0,
          hitY: 0,
          hitSeverity: "light",
          hp,
          sp,
          cp,
          selection,
          hover,
          threat,
          highestThreat,
          shadow: shadowSprite,
          alive: true,
          groundY,
          lastActionId: previous?.lastActionId ?? user.spriteAction?.id,
          action: previous?.action,
          actionAt: previous?.actionAt,
          facing: previous?.facing,
          deathAt: previous?.deathAt,
        };
        root.position.set(
          previousPosition?.x ?? -tile.center.x,
          previousPosition?.y ?? -tile.center.y,
        );
        records.set(user.userId, record);
        needsSort = true;
        const current = record;
        const loading = createWorldSprites(scope, parts, shadows).then(
          (art) => {
            if (!scope.isDisposed()) {
              current.art = art;
              const avatar = art.entries.find(
                (entry) => entry.description.kind === "aiAvatar",
              );
              if (
                avatar?.sprite instanceof Sprite &&
                Object.keys(current.user.spriteAnimations ?? {}).length
              ) {
                current.spriteAnimation = createCharacterAnimation(
                  avatar.sprite,
                  avatar.description.size,
                  current.user.spriteAnimations!,
                  {
                    initialEventId: user.spriteAnimationEvent?.id,
                    maxTextureSize: game.renderer.gl.getParameter(
                      game.renderer.gl.MAX_TEXTURE_SIZE,
                    ),
                  },
                );
                scope.own(current.spriteAnimation.dispose);
              }
              art.setLighting(brightness);
              artRoot.addChild(art.container);
              // Ground effects share actor ownership without widening the artwork's HUD-clearance bounds.
              for (const label of ["scenery-shadows", "scenery-lights"]) {
                const ground = art.container.getChildByLabel(label);
                if (!ground) continue;
                root.addChildAt(ground, root.getChildIndex(artRoot));
                layers?.ground.attach(...ground.children);
              }
              for (const entry of art.entries)
                if (entry.description.mask || entry.description.unlit)
                  layers?.ui.attach(entry.sprite);
              // Portrait and badge bounds keep HUD rows above art and ground cues below it.
              // Headgear can fill the LPC frame; ordinary frames retain their compact HUD.
              if (!(current.user.isAi && current.user.isOriginal)) {
                const { hp, sp, cp, threat } = current;
                const { selection, hover } = current;
                let top = 0,
                  bottom = Infinity;
                for (const entry of art.entries) {
                  if (entry.description.kind === "tombstone") continue;
                  if (entry.character) {
                    if (entry.character.hasHeadgear)
                      top = Math.max(top, entry.bounds.maxY);
                    // Transparent frame padding does not constrain the ground markers.
                    continue;
                  }
                  top = Math.max(top, entry.bounds.maxY);
                  bottom = Math.min(bottom, entry.bounds.minY);
                }
                const offset = Math.max(0, top + hudClearance - hudTop);
                for (const meter of [hp, sp, cp, threat])
                  if (meter) meter.container.y += offset;
                const groundOffset = Math.min(
                  0,
                  bottom - selection.getLocalBounds().maxY - tile.height * 0.02,
                );
                for (const marker of [selection, hover]) marker.y += groundOffset;
              }
              updateVisual(current);
            }
          },
          (error) => {
            if (!scope.isDisposed()) console.warn("Combat fighter unavailable", error);
          },
        );
        pending.add(loading);
        void loading.finally(() => pending.delete(loading));
      }
      record.user = user;
      // New cue IDs retrigger repeated attacks; refetched snapshots keep the current animation clock.
      if (user.spriteAction && user.spriteAction.id !== record.lastActionId) {
        record.lastActionId = user.spriteAction.id;
        record.action = user.spriteAction;
        record.actionAt = undefined;
      }
      if (record.target !== tile) {
        record.target = tile;
        const path = paths.getShortestPath(record.tile, tile) ?? [];
        const tiles = path[0] === record.tile ? path.slice(1) : path;
        record.walk = createWalk(record.root.position, tiles.length ? tiles : [tile]);
      }
      updateVisual(record);
    }
    scheduleExpiry();
  };
  const scheduleExpiry = () => {
    calculatedAt = Date.now();
    expiresAt = Number.POSITIVE_INFINITY;
    for (const effect of snapshot?.battle.usersEffects ?? []) {
      if (effect.timedBuffExpiresAt && effect.timedBuffExpiresAt > calculatedAt)
        expiresAt = Math.min(expiresAt, effect.timedBuffExpiresAt);
    }
  };
  const updateVisual = (record: Fighter) => {
    if (!snapshot) return;
    const { user } = record;
    const alive = stillInBattle(user);
    record.alive = alive;
    record.root.visible = !user.hidden && !user.leftBattle;
    const displayed = alive && record.root.visible;
    record.shadow.visible = displayed;
    // Clone identity uses the same rings as selection, without another ground marker.
    record.selection.tint = isClone(user) ? 0xd1d5db : 0xf0c56b;
    record.hover.tint = isClone(user) ? 0xd1d5db : 0x9ae0e9;
    for (const entry of record.art?.entries ?? []) {
      entry.sprite.visible =
        entry.description.kind === "tombstone" ? !alive && user.isOriginal : alive;
      if (entry.shadow) entry.shadow.visible = entry.sprite.visible;
      if (entry.light) entry.light.visible = displayed && entry.sprite.visible;
      if (entry.description.kind === "aiAvatar") {
        const facing = getFacingDirection(
          user,
          snapshot.battle.usersState,
          user.avatarFacing ?? "left",
        );
        entry.sprite.scale.x =
          Math.abs(entry.sprite.scale.x) *
          (facing !== (user.avatarFacing ?? "left") ? -1 : 1);
        if (entry.sprite instanceof Sprite) {
          const sprite = entry.sprite;
          sprite.updateLocalTransform();
          // Contacts and physical shadows share the visible footer, including mirrored asymmetric cutouts.
          const contact = spriteGroundContact(sprite);
          const foot = sprite.localTransform.apply({
            x: contact.x - sprite.texture.orig.width * sprite.anchor.x,
            y: contact.y - sprite.texture.orig.height * sprite.anchor.y,
          });
          for (const marker of [record.shadow, record.selection, record.hover])
            marker.position.copyFrom(foot);
          record.groundY = foot.y;
        }
      }
    }
    const maxima = getMaxPools(user, snapshot.battle, snapshot.battle.usersEffects);
    record.hp.set(getEffectiveCurPool(user, "Health") / maxima.health);
    if (record.sp && maxima.stamina !== undefined)
      record.sp.set(getEffectiveCurPool(user, "Stamina") / maxima.stamina);
    if (record.cp && maxima.chakra !== undefined)
      record.cp.set(getEffectiveCurPool(user, "Chakra") / maxima.chakra);
    const threat = displayed ? snapshot.aggro?.get(user.userId) : undefined;
    record.threat.container.visible =
      !!threat && Number.isFinite(threat.ratio) && threat.ratio > 0;
    record.highestThreat.visible =
      record.threat.container.visible && (threat?.isHighest ?? false);
    record.threat.set(threat?.ratio ?? 0, threat?.isHighest ? 0xf59e0b : 0xfbbf24);
  };
  const animate = (
    frame: GameFrame,
    selectedId: string,
    hoveredId: string | undefined,
    pixelsPerWorld = 1,
  ) => {
    if (!snapshot) return false;
    const now = Date.now();
    if (now >= expiresAt || now < calculatedAt) {
      for (const record of records.values()) updateVisual(record);
      scheduleExpiry();
    }
    let moving = false;
    animatedAt = frame.now;
    const pulse = (Math.sin((frame.now * Math.PI) / 900) + 1) / 2;
    for (const record of records.values()) {
      const { user, root, target, walk } = record;
      const waypoint = walk?.tiles[walk.reached] ?? target;
      const tx = -waypoint.center.x,
        ty = -waypoint.center.y;
      if (Math.hypot(tx - root.x, ty - root.y) > 0.01)
        record.facing = lpcFacing(tx - root.x, ty - root.y, record.facing);
      const cue = record.action;
      // Begin the cue clock only after movement and asynchronous artwork loading both finish.
      const startsAction = !!(
        cue &&
        record.art &&
        !walk &&
        record.actionAt === undefined
      );
      if (startsAction && cue) {
        record.actionAt = frame.now;
        const targetTile = grid.getHex({ col: cue.longitude, row: cue.latitude });
        if (targetTile)
          record.facing = lpcFacing(
            -targetTile.center.x - root.x,
            -targetTile.center.y - root.y,
            record.facing,
          );
      }
      record.shadow.renderable = game.visualEffects?.shadows !== false;
      // Full authored cycles expire independently of reduced-motion frame freezing.
      const active =
        cue &&
        record.actionAt !== undefined &&
        frame.now - record.actionAt <
          (authoredCueDuration(record, cue) || CUE_DURATIONS[cue.animation]);
      if (!record.alive && user.curHealth <= 0 && record.deathAt === undefined)
        record.deathAt = frame.now;
      if (record.alive) record.deathAt = undefined;
      for (const entry of record.art?.entries ?? []) {
        if (entry.description.kind === "aiAvatar" && entry.sprite instanceof Sprite) {
          record.spriteAnimation?.render({
            now: frame.now,
            moving: !!walk,
            facing: getFacingDirection(
              user,
              snapshot.battle.usersState,
              user.avatarFacing ?? "left",
            ),
            sourceFacing: user.avatarFacing ?? "left",
            event: user.spriteAnimationEvent,
            enabled:
              game.visualEffects.spriteAnimations && record.alive && root.visible,
            reducedMotion: frame.reducedMotion,
            cellSize:
              entry.description.size * pixelsPerWorld * game.renderer.resolution > 192
                ? 256
                : 128,
          });
        }
        if (!entry.character) continue;
        const falling =
          record.deathAt !== undefined &&
          !frame.reducedMotion &&
          frame.now - record.deathAt < 480;
        entry.sprite.visible = record.alive || falling;
        entry.character.render(
          frame,
          falling ? "hurt" : walk ? "walk" : active ? cue.animation : "combat",
          record.facing ?? (user.direction === "left" ? 3 : 1),
          startsAction,
          walk ? WALK_CYCLE_RATE : 1,
        );
      }
      if (walk) {
        walk.elapsed += frame.delta * 1000;
        const arrived = frame.reducedMotion || walk.elapsed >= walk.duration;
        const travelled = arrived
          ? walk.total
          : walkProgress(walk.elapsed / walk.duration, walk.duration) * walk.total;
        let stepped = false;
        while (
          walk.reached < walk.tiles.length &&
          travelled >= (walk.lengths[walk.reached] ?? 0)
        ) {
          const tile = walk.tiles[walk.reached++];
          if (tile && record.tile !== tile) {
            record.tile = tile;
            needsSort = true;
            stepped = true;
          }
        }
        if (stepped) onStep();
        if (arrived) {
          root.position.set(-target.center.x, -target.center.y);
          record.walk = null;
        } else {
          const from = walk.points[walk.reached],
            to = walk.points[walk.reached + 1],
            start = walk.lengths[walk.reached - 1] ?? 0,
            end = walk.lengths[walk.reached] ?? walk.total;
          if (from && to) {
            const share = end > start ? (travelled - start) / (end - start) : 1;
            root.position.set(
              from.x + (to.x - from.x) * share,
              from.y + (to.y - from.y) * share,
            );
          }
        }
      }
      moving ||= !!record.walk;
      if (record.hitAt !== undefined) {
        const reaction = HIT_REACTIONS[record.hitSeverity];
        const progress = (frame.now - record.hitAt) / reaction.ms;
        if (progress >= 1) {
          record.hitAt = undefined;
          record.artRoot.position.set(0, 0);
          record.artRoot.tint = 0xffffff;
          record.artRoot.alpha = 1;
        } else {
          // Snaps out in the first fifth, then eases home.
          const curve = progress < 0.2 ? progress / 0.2 : ((1 - progress) / 0.8) ** 2;
          const kick = frame.reducedMotion
            ? 0
            : curve * record.tile.height * reaction.reach;
          record.artRoot.position.set(record.hitX * kick, record.hitY * kick);
          record.artRoot.tint = progress < 0.45 ? HIT_FLASH_TINT : 0xffffff;
          const blink = progress > 0.2 && progress < 0.6 && progress % 0.2 < 0.1;
          record.artRoot.alpha = blink && !frame.reducedMotion ? 0.45 : 1;
        }
      }
      const draining = record.hp.drain(frame.delta * 1000, frame.reducedMotion);
      const displayed = record.alive && root.visible;
      const isSelected = user.userId === selectedId;
      const isHovered = user.userId === hoveredId;
      const clone = isClone(user);
      record.selection.visible = displayed && (isSelected || clone);
      // A quiet gray ring identifies idle clones; only selection breathes around the feet.
      record.selection.alpha = isSelected
        ? frame.reducedMotion
          ? 1
          : 0.7 + pulse * 0.3
        : isHovered
          ? 1
          : 0.55;
      record.selection.scale.set(
        isSelected && !frame.reducedMotion ? 1 + pulse * 0.08 : 1,
      );
      record.hover.visible = displayed && isHovered && !isSelected && !clone;
      const visible =
        displayed &&
        (user.userId === selectedId || user.userId === hoveredId || draining);
      record.hp.container.visible = visible;
      if (record.sp) record.sp.container.visible = visible;
      if (record.cp) record.cp.container.visible = visible;
    }
    if (needsSort) {
      container.children.sort((a, b) => b.y - a.y);
      needsSort = false;
    }
    let depthChanged = false;
    for (const record of records.values()) {
      const depth = -(record.root.y + record.groundY + container.y);
      if (record.artRoot.zIndex === depth) continue;
      record.artRoot.zIndex = depth;
      depthChanged = true;
    }
    if (depthChanged) layers?.world.sortRenderLayerChildren();
    return moving;
  };
  /** Authored length of a fighter's cue; 0 when its artwork has nothing to play. */
  const authoredCueDuration = (record: Fighter, cue: SpriteAction) =>
    Math.max(
      0,
      record.spriteAnimation?.actionDuration(
        record.user.spriteAnimationEvent?.actionKey,
      ) ?? 0,
      ...(record.art?.entries ?? []).map(
        (entry) => entry.character?.durations[cue.animation] ?? 0,
      ),
    );
  const hit = (x: number, y: number) => {
    for (let index = container.children.length - 1; index >= 0; index--) {
      const root = container.children[index];
      const record = root ? records.get(root.label) : undefined;
      if (!record) continue;
      for (const entry of record.art?.entries ?? []) {
        if (!isObjectChainVisible(entry.sprite)) continue;
        if (entry.sprite.getBounds().containsPoint(x, y))
          return { userId: record.user.userId, tile: record.target };
      }
    }
    return null;
  };
  return {
    container,
    sync,
    setLighting: (next: number) => {
      brightness = next;
      for (const record of records.values()) record.art?.setLighting(next);
    },
    animate,
    hit,
    ready: () => Promise.all([...pending]),
    /** Progress from 0 to 1 through a strike cue; 1 once artwork has nothing left to play. */
    cue: (id: string, cueId: string) => {
      const record = records.get(id);
      if (!record?.art || record.action?.id !== cueId || !record.root.visible) return 1;
      const duration = authoredCueDuration(record, record.action);
      if (!duration) return 1;
      if (record.actionAt === undefined) return 0;
      return Math.min(1, (animatedAt - record.actionAt) / duration);
    },
    snap: () => {
      for (const record of records.values()) {
        record.tile = record.target;
        record.walk = null;
        record.root.position.set(-record.target.center.x, -record.target.center.y);
      }
      needsSort = true;
    },
    position: (id: string) => records.get(id)?.root.position,
    /** Where feedback sits above a fighter on the field; nothing while it is not shown. */
    headPosition: (id: string) => {
      const record = records.get(id);
      if (!record?.root.visible) return undefined;
      const { root, tile, threat } = record;
      // The threat row tops the fighter's meters, whose height follows its artwork.
      return {
        x: root.x + tile.width / 2,
        y: root.y + threat.container.y + tile.height * 0.3,
      };
    },
    /** The unit direction a blow travels from its attacker; zero when there is none. */
    hitDirection: (id: string, attackerId?: string) => {
      const target = records.get(id)?.root;
      const attacker = attackerId ? records.get(attackerId)?.root : undefined;
      const x = target && attacker ? target.x - attacker.x : 0,
        y = target && attacker ? target.y - attacker.y : 0,
        distance = Math.hypot(x, y);
      return distance ? { x: x / distance, y: y / distance } : { x: 0, y: 0 };
    },
    /** Throw a struck fighter along the blow, which keeps it in place for no direction. */
    react: (id: string, direction: { x: number; y: number }, severity: HitSeverity) => {
      const record = records.get(id);
      if (!record?.root.visible) return;
      record.hitAt = animatedAt;
      record.hitX = direction.x;
      record.hitY = direction.y;
      record.hitSeverity = severity;
    },
  };
};

/** Fighter artwork in tile-local Y-up units; vector UI is owned separately by the actor. */
export const combatActorParts = (
  user: ReturnedUserState,
  tile: TerrainHex,
  battle: ReturnedBattle,
) => {
  const h = tile.height,
    w = tile.width;
  const part = (
    kind: string,
    image: string,
    size: number,
    y: number,
    extra: Partial<WorldSpriteDescription> = {},
  ): WorldSpriteDescription => ({
    id: kind,
    kind,
    image,
    size,
    x: w / 2,
    y,
    groundY: 0,
    unlit: !["avatar", "aiAvatar", "tombstone"].includes(kind),
    ...extra,
  });
  const parts: WorldSpriteDescription[] = [];
  if (user.isAi && user.isOriginal) {
    parts.push(
      part("aiAvatar", user.avatar || IMG_AVATAR_DEFAULT, h * 1.6, h * 0.9, {
        rendition: 256,
        preserveAspect: true,
        nearest: true,
        shadowCaster: "character",
      }),
    );
  } else {
    const village = getVillage(battle, user.villageId);
    if (user.spriteAppearance)
      parts.push(
        // Raise the compact frame within the hex; ground cues and HUD follow its placement.
        part(
          "avatar",
          user.avatar || IMG_AVATAR_DEFAULT,
          h * 1.8 * LPC_COMBAT_SCALE,
          h * (0.9 * LPC_COMBAT_SCALE + 0.15),
          {
            character: user.spriteAppearance,
            shadowCaster: "character",
            shadow: 0.16,
            light: 0.65,
          },
        ),
      );
    else {
      parts.push(
        part("marker", IMG_SECTOR_USER_MARKER, h * 1.2, h * 0.9, {
          width: h,
          mask: IMG_SECTOR_USER_MARKER,
          tint: village
            ? Number.parseInt(village.hexColor.replace("#", ""), 16)
            : 0x000000,
        }),
        part("marker", IMG_SECTOR_USER_MARKER, h * 1.1, h * 0.9, {
          width: h * 0.9,
          mask: IMG_SECTOR_USER_MARKER,
        }),
        part("avatar", user.avatar || IMG_AVATAR_DEFAULT, h * 0.8, h, {
          mask: IMG_SECTOR_USER_SPRITE_MASK,
        }),
      );
    }
    const clan = getClan(battle, user.clanId);
    if (clan?.image)
      parts.push(
        part("clan-border", IMG_SECTOR_USER_SPRITE_MASK, h * 0.3 + 2, h * 1.4, {
          x: w * 0.9,
          mask: IMG_SECTOR_USER_SPRITE_MASK,
          tint: 0xffd700,
        }),
        part("clan", clan.image, h * 0.3, h * 1.4, {
          x: w * 0.9,
          mask: IMG_SECTOR_USER_SPRITE_MASK,
        }),
      );
  }
  parts.push(part("tombstone", IMG_BATTLEFIELD_TOMBSTONE, h * 0.5, h * 0.6));
  return parts;
};

/** One uninterrupted path: its whole length shares a single speed curve. */
const createWalk = (from: { x: number; y: number }, tiles: TerrainHex[]): Walk => {
  const points = [
    { x: from.x, y: from.y },
    ...tiles.map(({ center }) => ({ x: -center.x, y: -center.y })),
  ];
  let total = 0;
  const lengths = tiles.map((_, index) => {
    const a = points[index],
      b = points[index + 1];
    total += a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    return total;
  });
  return {
    tiles,
    points,
    lengths,
    total,
    elapsed: 0,
    duration: walkDuration(tiles.length),
    reached: 0,
  };
};

/** Foot-centered rings distinguish clones and selection without obscuring the terrain. */
const groundSelection = (tile: TerrainHex, selected: boolean, y: number) => {
  const x = tile.width / 2;
  const rx = tile.width * 0.17,
    ry = tile.height * 0.07;
  const marker = new Graphics()
    .ellipse(x, y, rx, ry)
    .stroke({ color: 0x15232c, alpha: 0.55, width: tile.width * 0.025 })
    .ellipse(x, y, rx, ry)
    .stroke({
      color: 0xffffff,
      alpha: selected ? 0.8 : 0.65,
      width: tile.width * (selected ? 0.012 : 0.01),
    });
  marker.label = selected ? "combat-selection" : "combat-hover";
  // Matching pivot and position preserves placement while scaling around the foot point.
  marker.pivot.set(x, y);
  marker.position.set(x, y);
  marker.visible = false;
  return marker;
};

export type CombatActorSnapshot = {
  battle: ReturnedBattle;
  viewer?: Pick<UserData, "userId" | "avatar" | "avatarLight" | "username">;
  aggro?: AggroDisplay;
};
type Meter = ReturnType<typeof createStatusMeter>;
type Walk = {
  tiles: TerrainHex[];
  /** The start position followed by each tile's position. */
  points: { x: number; y: number }[];
  /** Distance from the start to each tile. */
  lengths: number[];
  total: number;
  elapsed: number;
  duration: number;
  /** Tiles already passed; the fighter is between this tile and the next. */
  reached: number;
};
type Fighter = {
  hitAt?: number;
  hitX: number;
  hitY: number;
  hitSeverity: HitSeverity;
  lastActionId?: string;
  action?: SpriteAction;
  actionAt?: number;
  deathAt?: number;
  facing?: LpcDirection;
  scope: GameRenderer;
  root: Container;
  artRoot: Container;
  art: Awaited<ReturnType<typeof createWorldSprites>> | null;
  spriteAnimation?: ReturnType<typeof createCharacterAnimation>;
  signature: string;
  user: ReturnedUserState;
  tile: TerrainHex;
  target: TerrainHex;
  walk: Walk | null;
  hp: Meter;
  sp: Meter | null;
  cp: Meter | null;
  selection: Graphics;
  hover: Graphics;
  threat: Meter;
  highestThreat: Graphics;
  shadow: Sprite;
  alive: boolean;
  groundY: number;
};
