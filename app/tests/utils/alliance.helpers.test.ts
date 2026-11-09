import { describe, expect, it } from "bun:test";
import {
  CREATOR_USERNAME,
  VILLAGE_SYNDICATE_ID,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import { getWarRelationship } from "@/libs/objectiveWar";
import {
  canEnemy,
  canShowMapAttack,
  findRelationship,
  findVillageUserRelationship,
  getAllyStatus,
  getAlliedVillageIds,
  isAutoAttackTarget,
  mapAttackRelation,
} from "@/utils/alliance";

const relation = (
  villageIdA: string,
  villageIdB: string,
  status: VillageAlliance["status"],
) =>
  ({
    id: `${villageIdA}-${villageIdB}`,
    villageIdA,
    villageIdB,
    status,
  }) as VillageAlliance;

describe("getAlliedVillageIds", () => {
  const relations = [
    relation("a", "b", "ALLY"),
    relation("c", "a", "ALLY"),
    relation("a", "d", "ENEMY"),
    relation("b", "c", "ALLY"),
  ];

  it("lists the village and its formal allies once each", () => {
    expect(getAlliedVillageIds(relations, "a")).toEqual(["a", "b", "c"]);
  });

  it("is empty for a user without a village", () => {
    expect(getAlliedVillageIds(relations, null)).toEqual([]);
  });
});

describe("mapAttackRelation", () => {
  const viewer = {
    userId: "viewer",
    villageId: "a",
    village: {
      id: "a",
      relationshipA: [relation("a", "b", "ALLY")],
      relationshipB: [],
    },
  };
  const target = (villageId: string | null, patch: object = {}) => ({
    userId: "target",
    villageId,
    ...patch,
  });
  const wars = [
    {
      id: "war",
      attackerVillageId: "a",
      defenderVillageId: "d",
      warAllies: [
        { villageId: "c", supportVillageId: "a" },
        { villageId: "b", supportVillageId: "d" },
      ],
    },
  ] as never;

  it("counts the viewer's village and its formal allies", () => {
    expect(mapAttackRelation(viewer, target("a"), null)).toBe("ALLY");
    expect(mapAttackRelation(viewer, target("b"), null)).toBe("ALLY");
    expect(mapAttackRelation(viewer, target("c"), null)).toBe("NEUTRAL");
  });

  it("lets a target's alliance status override the village rule", () => {
    expect(
      mapAttackRelation(viewer, target("a", { allianceStatus: "ENEMY" }), null),
    ).toBe("ENEMY");
    expect(
      mapAttackRelation(viewer, target("c", { allianceStatus: "ALLY" }), null),
    ).toBe("ALLY");
  });

  it("treats a missing viewer as unrelated", () => {
    expect(mapAttackRelation(undefined, target("a"), null)).toBe("NEUTRAL");
  });

  it("never treats a village-less target as the viewer's village", () => {
    expect(
      mapAttackRelation({ userId: "viewer", villageId: null }, target(null), null),
    ).toBe("NEUTRAL");
  });

  it("keeps a snapshot that resolved no war side over the viewer's war list", () => {
    expect(
      mapAttackRelation(viewer, target("c", { warRelationship: null }), wars),
    ).toBe("NEUTRAL");
    expect(
      mapAttackRelation(viewer, target("b", { warRelationship: null }), wars),
    ).toBe("ALLY");
  });

  it("lets the viewer's war list outrank diplomacy", () => {
    expect(mapAttackRelation(viewer, target("c"), wars)).toBe("ALLY");
    expect(mapAttackRelation(viewer, target("b"), wars)).toBe("ENEMY");
    expect(
      mapAttackRelation(viewer, target("c", { allianceStatus: "ENEMY" }), wars),
    ).toBe("ALLY");
  });

  it("prefers the snapshot's war relation, which knows other players' contracts", () => {
    expect(
      mapAttackRelation(viewer, target("a", { warRelationship: "ENEMY" }), wars),
    ).toBe("ENEMY");
    expect(
      mapAttackRelation(viewer, target("d", { warRelationship: "ALLY" }), wars),
    ).toBe("ALLY");
  });
});

describe("canShowMapAttack", () => {
  const viewer = { userId: "viewer", villageId: "a" };
  const player = { userId: "target", status: "AWAKE" } as const;
  const wars = [
    {
      id: "war",
      attackerVillageId: "a",
      defenderVillageId: "d",
      warAllies: [{ villageId: "c", supportVillageId: "a" }],
    },
  ] as never;

  it("hides allies until ally attacks are enabled", () => {
    const ally = { ...player, villageId: "a", rank: "CHUNIN" } as const;
    expect(canShowMapAttack(viewer, ally, false, null)).toBe(false);
    expect(canShowMapAttack(viewer, ally, true, null)).toBe(true);
  });

  it("offers everyone but the creator an attack on the creator, whatever their rank or village", () => {
    const creator = {
      ...player,
      username: CREATOR_USERNAME,
      villageId: "a",
      rank: "STUDENT",
    } as const;
    expect(canShowMapAttack(viewer, creator, false, null)).toBe(true);
    expect(
      canShowMapAttack({ ...viewer, userId: creator.userId }, creator, false, null),
    ).toBe(false);
    expect(
      canShowMapAttack(viewer, { ...creator, status: "ASLEEP" }, false, null),
    ).toBe(false);
  });

  it("never offers an attack on a PvP-restricted rank", () => {
    const student = { ...player, villageId: "b", rank: "STUDENT" } as const;
    expect(canShowMapAttack(viewer, student, true, null)).toBe(false);
    expect(canShowMapAttack(viewer, { ...student, rank: "CHUNIN" }, false, null)).toBe(
      true,
    );
  });

  it.each(["BATTLE", "HOSPITALIZED", "TRAVEL", "ASLEEP"] as const)(
    "never offers an attack on a %s target",
    (status) => {
      const target = { ...player, villageId: "b", rank: "CHUNIN", status } as const;
      expect(canShowMapAttack(viewer, target, true, null)).toBe(false);
    },
  );

  it("never offers an attack on a banned target", () => {
    const target = {
      ...player,
      villageId: "b",
      rank: "CHUNIN",
      isBanned: true,
    } as const;
    expect(canShowMapAttack(viewer, target, true, null)).toBe(false);
  });

  it("hides a war-side supporter whose stored status knows nothing of the war", () => {
    const target = {
      ...player,
      villageId: "c",
      rank: "CHUNIN",
      allianceStatus: "NEUTRAL",
    } as const;
    expect(canShowMapAttack(viewer, target, false, null)).toBe(true);
    expect(canShowMapAttack(viewer, target, false, wars)).toBe(false);
  });
});

describe("isAutoAttackTarget", () => {
  const viewer = { userId: "viewer", villageId: "a" };

  it("never engages the creator on its own", () => {
    const creator = {
      userId: "creator",
      username: CREATOR_USERNAME,
      villageId: "b",
      allianceStatus: "ENEMY",
      status: "AWAKE",
      rank: "JONIN",
      level: 100,
    } as const;
    expect(isAutoAttackTarget(viewer, creator, null, 1)).toBe(false);
  });

  const wars = [
    {
      id: "war",
      attackerVillageId: "a",
      defenderVillageId: "d",
      warAllies: [
        { villageId: "c", supportVillageId: "a" },
        { villageId: "b", supportVillageId: "d" },
      ],
    },
  ] as never;

  /** Auto-attack's standing conditions, which the shared rule may narrow but never widen. */
  const standingRule = (target: {
    userId: string;
    villageId: string | null;
    allianceStatus: "ALLY" | "ENEMY" | "NEUTRAL";
    status: string;
    rank: string;
    level: number;
    isBanned: boolean;
    isNpc: boolean;
  }) => {
    if (target.userId === viewer.userId || target.isNpc) return false;
    if (target.status !== "AWAKE" || target.isBanned) return false;
    const warSides = getWarRelationship(wars, viewer, target) === "ALLY";
    if (target.allianceStatus === "ALLY") return false;
    if (
      target.allianceStatus !== "ENEMY" &&
      (warSides || target.villageId === viewer.villageId)
    ) {
      return false;
    }
    return target.rank !== "STUDENT" && target.rank !== "GENIN" && target.level >= 30;
  };

  const cases = ["a", "b", "c", "d", "e", null].flatMap((villageId) =>
    (["ALLY", "ENEMY", "NEUTRAL"] as const).flatMap((allianceStatus) =>
      ["AWAKE", "BATTLE"].flatMap((status) =>
        ["GENIN", "JONIN"].flatMap((rank) =>
          [20, 40].flatMap((level) =>
            [false, true].flatMap((isBanned) =>
              [false, true].flatMap((isNpc) =>
                ["target", "viewer"].map((userId) => ({
                  userId,
                  villageId,
                  allianceStatus,
                  status,
                  rank,
                  level,
                  isBanned,
                  isNpc,
                })),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  it("never engages anyone its standing conditions skip", () => {
    const widened = cases.filter(
      (target) =>
        isAutoAttackTarget(viewer, target as never, wars, 30) && !standingRule(target),
    );
    expect(widened).toEqual([]);
  });

  it("drops only war-side players the server would refuse anyway", () => {
    const narrowed = cases.filter(
      (target) =>
        standingRule(target) && !isAutoAttackTarget(viewer, target as never, wars, 30),
    );
    expect(narrowed.length).toBeGreaterThan(0);
    expect(
      narrowed.every((target) => getWarRelationship(wars, viewer, target) === "ALLY"),
    ).toBe(true);
  });

  it("keeps the level floor and ignores the map's ally opt-in", () => {
    const enemy = {
      userId: "target",
      villageId: "e",
      rank: "JONIN",
      status: "AWAKE",
      level: 40,
    } as const;
    expect(isAutoAttackTarget(viewer, enemy, null, 41)).toBe(false);
    expect(isAutoAttackTarget(viewer, enemy, null, 40)).toBe(true);
    expect(isAutoAttackTarget(viewer, { ...enemy, villageId: "a" }, null, 1)).toBe(
      false,
    );
  });
});

describe("findVillageUserRelationship", () => {
  const relations = [relation("a", "b", "ENEMY")];

  it("finds the relationship in either direction and on either side", () => {
    const expected = relations[0];
    expect(findRelationship(relations, "b", "a")).toBe(expected);
    expect(
      findVillageUserRelationship({ id: "a", relationshipA: relations }, "b"),
    ).toBe(expected);
    expect(
      findVillageUserRelationship({ id: "b", relationshipB: relations }, "a"),
    ).toBe(expected);
  });

  it("finds nothing for a user without a village", () => {
    for (const village of [
      { id: "a", relationshipA: relations },
      { id: null, relationshipA: relations },
    ]) {
      expect(findVillageUserRelationship(village, null)).toBeUndefined();
      expect(findVillageUserRelationship(village, undefined)).toBeUndefined();
      expect(findVillageUserRelationship(village)).toBeUndefined();
    }
  });
});

describe("getAllyStatus", () => {
  const village = {
    id: "a",
    relationshipA: [relation("a", "b", "ENEMY")],
    relationshipB: [],
  };

  it("reads the stored relationship once both sides are known", () => {
    expect(getAllyStatus(village, "b")).toBe("ENEMY");
    expect(getAllyStatus(village, "c")).toBe("NEUTRAL");
  });

  it("settles own village, outlaws and missing data before diplomacy", () => {
    expect(getAllyStatus(undefined, "b")).toBe("NEUTRAL");
    expect(getAllyStatus(village, "a")).toBe("ALLY");
    expect(getAllyStatus(village, VILLAGE_SYNDICATE_ID)).toBe("ENEMY");
    expect(getAllyStatus({ ...village, id: VILLAGE_SYNDICATE_ID }, "b")).toBe("ENEMY");
    expect(getAllyStatus({ id: "a", relationshipB: [] }, "b")).toBe("NEUTRAL");
    expect(getAllyStatus({ id: "a", relationshipA: [] }, "b")).toBe("NEUTRAL");
    expect(getAllyStatus(village, null)).toBe("NEUTRAL");
  });
});

describe("canEnemy", () => {
  const village = (id: string, tokens = WAR_FUNDS_COST) => ({ id, tokens }) as Village;
  const villages = [
    village("a"),
    village("b"),
    village("c"),
    village("d"),
    village("e"),
  ];
  const rejected = (message: string) => ({
    success: false,
    message,
    newNeutrals: [],
    newEnemies: [],
  });

  it("rejects in guard order with no consequences", () => {
    expect(canEnemy([], villages, "missing", "missing")).toEqual(
      rejected("Village not found"),
    );
    expect(canEnemy([], villages, "a", "a")).toEqual(
      rejected("Cannot be enemy with yourself"),
    );
    expect(
      canEnemy([relation("a", "b", "ENEMY")], [village("a", 0)], "a", "b"),
    ).toEqual(rejected("Already an enemy"));
    expect(canEnemy([relation("b", "a", "ALLY")], [village("a", 0)], "a", "b")).toEqual(
      rejected("Cannot be enemy with an ally"),
    );
    expect(canEnemy([], [village("a", WAR_FUNDS_COST - 1)], "a", "b")).toEqual(
      rejected("Insufficient funds"),
    );
  });

  it("neutralizes shared allies and turns the target's other allies into enemies", () => {
    const relations = [
      relation("c", "b", "ALLY"),
      relation("c", "a", "ALLY"),
      relation("d", "b", "ALLY"),
      relation("e", "a", "ALLY"),
    ];
    expect(canEnemy(relations, villages, "a", "b")).toEqual({
      success: true,
      message: "OK",
      newNeutrals: ["c"],
      newEnemies: ["d"],
    });
  });
});
