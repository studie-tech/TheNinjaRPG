import { afterEach, describe, expect, it, vi } from "bun:test";
import type {
  Bloodline,
  Item,
  Jutsu,
  JutsuReskin,
  Quest,
  SageMode,
  UserQuest,
} from "@/drizzle/schema";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import { availableUserActions, handleInjectedJutsus } from "@/libs/combat/actions";
import type { BattleUserJutsu } from "@/libs/combat/types";
import { getJutsu } from "@/libs/combat/util";
import { maskBattle } from "@/libs/combat/masking";
import { InjectJutsusTag, VisualTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeEffect,
} from "../../setup/combat";

const jutsu = (id: string): Jutsu =>
  ({
    id,
    name: id,
    image: `/${id}.png`,
    effects: [],
    cooldown: 4,
    target: "SELF",
    method: "SINGLE",
    range: 0,
    actionCostPerc: 20,
    healthCost: 0,
    chakraCost: 10,
    staminaCost: 0,
    healthCostReducePerLvl: 0,
    chakraCostReducePerLvl: 0,
    staminaCostReducePerLvl: 0,
    jutsuWeapon: "NONE",
    requiredMastery: 0,
    battleDescription: "test",
  }) as unknown as Jutsu;
const ref = (jutsuId: string): BattleUserJutsu => ({
  id: `owned-${jutsuId}`,
  jutsuId,
  level: 5,
  experience: 0,
  equipped: true,
  lastUsedRound: -4,
  originalCooldown: 4,
});
const privateUser = (id: string) =>
  makeBattleUser(id, {
    sector: 83,
    location: "VILLAGE",
    jutsus: [ref(`${id}-jutsu`)],
    items: [makeBattleUserItem({ id: `${id}-row`, itemId: `${id}-item` })],
    basicActions: [{ id: "basicHeal", lastUsedRound: 2 }],
    activeSkillIds: [`${id}-skill`],
    skillLockedJutsuIds: [`${id}-locked-jutsu`],
    sageMasteryExperience: 999,
    dailySageActivations: 3,
  });
const battleWithLoadouts = () =>
  makeCompleteBattle({
    usersState: [privateUser("me"), privateUser("foe")],
    createdAt: new Date("2020-01-01"),
    roundStartAt: new Date("2020-01-01"),
    extraState: {
      jutsus: {
        "me-jutsu": jutsu("me-jutsu"),
        "foe-jutsu": jutsu("foe-jutsu"),
        "unused-injectable": jutsu("unused-injectable"),
      },
      items: {
        "me-item": { id: "me-item", effects: [] } as unknown as Item,
        "foe-item": { id: "foe-item", effects: [] } as unknown as Item,
      },
      energyRegeneration: { me: 20, foe: 99 },
      energyRegenerationPeriods: {
        me: [{ startsAt: 1, endsAt: 2, bonus: 5 }],
        foe: [{ startsAt: 1, endsAt: 9, bonus: 9 }],
      },
      initialDurability: { foe: { "foe-row": 70 } },
      preBattleGearModifiers: { foe: { secret: 123 } as never },
      aiProfiles: { foe: { rules: ["secret-ai-rule"] } as never },
    },
  });

describe("battle response privacy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hides other participants' world location, loadouts, cooldowns and stats", () => {
    const battle = battleWithLoadouts();
    const before = structuredClone(battle);
    const response = maskBattle(battle, "me");
    const foe = response.usersState.find((u) => u.userId === "foe")!;
    for (const field of [
      "sector",
      "location",
      "items",
      "jutsus",
      "basicActions",
      "strength",
      "highestGenerals",
      "sageMasteryExperience",
      "dailySageActivations",
      "activeSkillIds",
      "skillLockedJutsuIds",
    ])
      expect(foe).not.toHaveProperty(field);
    expect(foe).toMatchObject({
      userId: "foe",
      longitude: 1,
      latitude: 0,
      curHealth: 5000,
      controllerId: "foe",
    });
    expect(response.usersState[0]).toMatchObject({
      activeSkillIds: ["me-skill"],
      skillLockedJutsuIds: ["me-locked-jutsu"],
    });
    expect(response.extraState.jutsus).toHaveProperty("me-jutsu");
    expect(response.extraState.jutsus).not.toHaveProperty("foe-jutsu");
    expect(response.extraState.items).not.toHaveProperty("foe-item");
    expect(JSON.stringify(response)).not.toContain("secret-ai-rule");
    expect(response.extraState.energyRegeneration).toEqual({ me: 20 });
    expect(response.extraState.energyRegenerationPeriods).toEqual({
      me: [{ startsAt: 1, endsAt: 2, bonus: 5 }],
    });
    expect(response.extraState).not.toHaveProperty("initialDurability");
    expect(response.extraState).not.toHaveProperty("preBattleGearModifiers");
    expect(battle).toEqual(before);
  });

  it("gives spectators public state without anyone's action catalogs", () => {
    const masked = maskBattle(battleWithLoadouts(), "spectator");
    expect(masked.extraState.jutsus).toEqual({});
    expect(masked.extraState.items).toEqual({});
    expect(masked.extraState.energyRegeneration).toEqual({});
    expect(masked.extraState.energyRegenerationPeriods).toEqual({});
    for (const user of masked.usersState) expect(user).not.toHaveProperty("jutsus");
  });

  it("includes linked variants only for their controller", () => {
    const battle = battleWithLoadouts();
    battle.usersState[0]!.jutsus[0]!.linkedReskinId = "me-variant";
    battle.usersState[1]!.jutsus[0]!.linkedReskinId = "foe-variant";
    battle.extraState.jutsus["me-variant"] = jutsu("me-variant");
    battle.extraState.jutsus["foe-variant"] = jutsu("foe-variant");
    const masked = maskBattle(battle, "me");
    expect(masked.extraState.jutsus).toHaveProperty("me-variant");
    expect(masked.extraState.jutsus).not.toHaveProperty("foe-variant");
    expect(maskBattle(battle, "spectator").extraState.jutsus).toEqual({});
    battle.usersState[1]!.usedActions = [{ id: "foe-jutsu", type: "jutsu" }];
    for (const viewer of ["me", "spectator"]) {
      const afterCast = maskBattle(battle, viewer);
      expect(getJutsu(afterCast, "foe-jutsu")?.name).toBe("foe-jutsu");
      expect(afterCast.extraState.jutsus).not.toHaveProperty("foe-variant");
      expect(afterCast.usersState[1]).not.toHaveProperty("jutsus");
    }
  });

  it("preserves the controller's actions, reskins and cooldowns", () => {
    vi.spyOn(Date, "now").mockReturnValue(1767225600000);
    const battle = battleWithLoadouts();
    battle.usersState[0]!.items = [];
    battle.usersState[0]!.jutsus[0]!.reskinId = "reskin";
    battle.extraState.jutsuReskins = {
      reskin: {
        id: "reskin",
        name: "Custom name",
        image: "/custom.png",
      } as JutsuReskin,
    };
    const masked = maskBattle(battle, "me");
    expect(availableUserActions(masked, "me")).toEqual(
      availableUserActions(battle, "me"),
    );
    expect(masked.usersState[0]!.basicActions).toEqual(
      battle.usersState[0]!.basicActions,
    );
    expect(masked.extraState.jutsuReskins).toEqual(battle.extraState.jutsuReskins);
  });

  it("reveals only cast definitions and retains them after the caster despawns", () => {
    const battle = battleWithLoadouts();
    battle.usersState[1]!.usedActions = [{ id: "foe-jutsu", type: "jutsu" }];
    const masked = maskBattle(battle, "spectator");
    expect(getJutsu(masked, "foe-jutsu")?.name).toBe("foe-jutsu");
    expect(masked.usersState[1]).not.toHaveProperty("jutsus");
    battle.extraState.revealedActions = {
      jutsuIds: ["foe-jutsu"],
      itemIds: ["foe-item"],
    };
    battle.usersState.pop();
    const afterDespawn = maskBattle(battle, "spectator");
    expect(afterDespawn.extraState.jutsus).toHaveProperty("foe-jutsu");
    expect(afterDespawn.extraState.items).toHaveProperty("foe-item");
    expect(afterDespawn.extraState.jutsus).not.toHaveProperty("me-jutsu");
    expect(afterDespawn.extraState.jutsus).not.toHaveProperty("unused-injectable");
  });

  it("delivers newly granted actions to a piloted summon without revealing other grants", () => {
    const battle = battleWithLoadouts();
    const summon = privateUser("summon");
    summon.controllerId = "me";
    summon.isSummon = true;
    summon.isPiloted = true;
    battle.usersState.push(summon);
    battle.extraState.jutsus["granted"] = jutsu("granted");
    battle.usersEffects = [
      makeEffect(
        "injectjutsus",
        { jutsuIds: ["granted"] },
        { targetId: "summon", creatorId: "foe" },
      ),
    ];
    const masked = maskBattle(battle, "me");
    const actor = masked.usersState.find((u) => u.userId === "summon")!;
    expect(actor.jutsus).toEqual(summon.jutsus);
    expect(handleInjectedJutsus(masked, actor).map((j) => j.jutsuId)).toContain(
      "granted",
    );
    const publicBattle = maskBattle(battle, "spectator");
    expect(publicBattle.extraState.jutsus).not.toHaveProperty("granted");
    expect(InjectJutsusTag.parse(publicBattle.usersEffects[0]).jutsuIds).toEqual([]);
  });

  it("preserves sage activation for the controller and hides opponents' mode catalogs", () => {
    const battle = battleWithLoadouts();
    battle.usersState[0]!.sageModeId = "my-mode";
    battle.usersState[0]!.dailySageActivations = 0;
    battle.usersState[1]!.sageModeId = "secret-mode";
    battle.extraState.sageModes = {
      "my-mode": { id: "my-mode" } as SageMode,
      "secret-mode": { id: "secret-mode" } as SageMode,
    };
    battle.extraState.jutsus[SAGE_MODE_ACTIVATION_JUTSU_ID] = jutsu(
      SAGE_MODE_ACTIVATION_JUTSU_ID,
    );
    const masked = maskBattle(battle, "me");
    expect(masked.extraState.sageModes).toHaveProperty("my-mode");
    expect(masked.extraState.sageModes).not.toHaveProperty("secret-mode");
    expect(masked.extraState.jutsus).toHaveProperty(SAGE_MODE_ACTIVATION_JUTSU_ID);
  });

  it("removes hidden summon templates, their effects, and their asset hints", () => {
    const battle = battleWithLoadouts();
    battle.usersState.push(
      makeBattleUser("template", {
        controllerId: "secret-template",
        isSummon: true,
        isSummonTemplate: true,
        curHealth: 0,
      }),
    );
    battle.usersEffects = [
      makeEffect(
        "visual",
        { staticAssetPath: "secret-summon-texture" },
        { creatorId: "template", targetId: "template" },
      ),
    ];
    const masked = maskBattle(battle, "spectator");
    expect(masked.usersState.map((u) => u.userId)).toEqual(["me", "foe"]);
    expect(masked.usersEffects).toEqual([]);
    expect(masked.extraState.textureAssets).not.toContain("secret-summon-texture");
  });

  it("keeps visible effects while stripping private sources and unused asset hints", () => {
    const battle = battleWithLoadouts();
    battle.extraState.jutsus["foe-jutsu"]!.effects = [
      VisualTag.parse({
        appearAnimation: "uncast-animation",
        appearSfx: "uncast-sound",
      }),
    ];
    battle.usersEffects = [
      makeEffect(
        "visual",
        { appearAnimation: "visible-animation" },
        {
          creatorId: "foe",
          targetId: "me",
          fromType: "armor",
          actionId: "secret-armor",
          highestGenerals: ["speed"],
        },
      ),
    ];
    const masked = maskBattle(battle, "me");
    expect(masked.usersEffects[0]).toMatchObject({
      actionId: "hidden",
      appearAnimation: "visible-animation",
    });
    expect(masked.usersEffects[0]).not.toHaveProperty("highestGenerals");
    expect(masked.extraState.textureAssets).toContain("visible-animation");
    expect(masked.extraState.textureAssets).not.toContain("uncast-animation");
    expect(masked.extraState.sfxAssets).not.toContain("uncast-sound");
  });

  it("redacts private target stats from persisted effects for opponents and spectators", () => {
    const battle = battleWithLoadouts();
    const effect = Object.assign(
      makeEffect(
        "visual",
        {},
        {
          creatorId: "foe",
          targetId: "foe",
          highestGenerals: ["speed", "willpower"],
        },
      ),
      { targetHighestGenerals: ["speed", "willpower"] },
    );
    battle.usersEffects = [effect];
    battle.groundEffects = [{ ...effect, targetType: "ground" } as never];
    const before = structuredClone(battle);
    for (const viewer of ["me", "spectator"]) {
      const masked = maskBattle(battle, viewer);
      for (const result of [...masked.usersEffects, ...masked.groundEffects]) {
        expect(result).not.toHaveProperty("highestGenerals");
        expect(result).not.toHaveProperty("targetHighestGenerals");
      }
    }
    expect(battle).toEqual(before);
  });
});

describe("masked battle payload", () => {
  afterEach(() => vi.restoreAllMocks());
  it("omits settlement records without mutating the authoritative battle or changing client actions", () => {
    vi.spyOn(Date, "now").mockReturnValue(1767225600000);
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("me"),
        makeBattleUser("opponent", { bloodlineId: "line" }),
      ],
      extraState: {
        userQuests: {
          me: [
            {
              id: "quest",
              quest: { content: "x".repeat(10000) },
            } as unknown as UserQuest,
          ],
        },
        completedQuests: { me: [{ id: "completed", questId: "quest", completed: 1 }] },
        questData: { me: [] },
        bounties: { me: [] },
        bountySignups: { me: [] },
        sectorExclusiveRaids: [{ id: "raid" } as Quest],
        jutsus: {},
        items: {},
        bloodlines: {
          line: {
            id: "line",
            name: "Visible bloodline",
            effects: [],
            bloodrightTiers: [
              { id: "hidden-tier", hidden: true, description: "Secret catalog" },
            ],
          } as unknown as Bloodline,
        },
      },
    });
    Object.assign(battle.extraState, {
      textureAssets: ["texture"],
      sfxAssets: ["sound"],
    });
    const snapshot = structuredClone(battle);
    const masked = maskBattle(battle, "me");
    expect(masked.extraState.userQuests).toEqual({});
    expect(masked.extraState.completedQuests).toEqual({});
    expect(masked.extraState.sectorExclusiveRaids).toEqual([]);
    expect(masked.extraState.textureAssets).not.toContain("texture");
    expect(masked.extraState.jutsus).toEqual(battle.extraState.jutsus);
    expect(masked.extraState.bloodlines.line).toEqual<
      Pick<Bloodline, "id" | "name" | "effects">
    >({ id: "line", name: "Visible bloodline", effects: [] });
    expect(JSON.stringify(masked)).not.toContain("Secret catalog");
    expect(availableUserActions(masked, "me")).toEqual(
      availableUserActions(battle, "me"),
    );
    expect(JSON.stringify(masked).length).toBeLessThan(
      JSON.stringify(battle).length - 10000,
    );
    expect(battle).toEqual(snapshot);
  });
});
