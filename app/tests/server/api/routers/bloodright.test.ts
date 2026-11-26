import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, eq, ne } from "drizzle-orm";
import { COST_SKILL_RESET } from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  bloodrightOption,
  jutsu,
  skillTree,
  userData,
  userSkill,
} from "@/drizzle/schema";
import { bloodrightSwapRefund, matchBloodrightSnapshot } from "@/libs/bloodright";
import { calcEnergy } from "@/libs/profile";
import * as socials from "@/libs/socials";
import { bloodlineRouter, updateBloodline } from "@/server/api/routers/bloodline";
import { bloodrightRouter } from "@/server/api/routers/bloodright";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { staffRouter } from "@/server/api/routers/staff";
import { DamageTag, StunTag, type ZodAllTags } from "@/validators/combat";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

import { requireUser } from "../../../setup/userReads";

const userId = "bloodright-player";
const invoke = async (name: "purchase" | "refund" | "reset", input?: unknown) => {
  const db = await getTestDatabase();
  return callerForDatabase(bloodrightRouter, userId, db)[name](input as never);
};
const read = () => requireUser(userId);
const tier = (id: string, tier = 1, requiredSkillIds: string[] = []) => ({
  id,
  name: id,
  image: "",
  description: "Bloodright fixture",
  effects: [],
  tier,
  requiredSkillIds,
});

const damage = DamageTag.parse({ power: 20 });
const option = (id: string) => ({
  id,
  name: id,
  description: "Bloodright fixture",
  bloodlineId: "line",
  jutsuId: "line-jutsu",
  hidden: false,
  seichiSilverCost: 100,
  changes: [
    { tagIndex: 0, tag: damage, field: "power", mode: "FLAT" as const, value: 1 },
  ],
});

describeWithDatabase("Bloodright economy on MySQL", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(
      actionLog,
      userSkill,
      skillTree,
      bloodrightOption,
      jutsu,
      userData,
      bloodline,
    );
    await db.insert(bloodline).values({
      id: "line",
      name: "Bloodright Line",
      rank: "D",
      image: "",
      description: "Fixture",
      effects: [],
    });
    await db.insert(jutsu).values({
      id: "line-jutsu",
      name: "Line Jutsu",
      battleDescription: "Line Jutsu",
      target: "OPPONENT",
      range: 3,
      requiredRank: "STUDENT",
      jutsuType: "BLOODLINE",
      image: "",
      description: "Fixture",
      bloodlineId: "line",
      effects: [damage],
    });
    await db
      .insert(bloodrightOption)
      .values(["root", "child", "grandchild", "other", "fifth", "sixth"].map(option));
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await db.insert(userData).values({
      userId,
      username: "BloodrightPlayer",
      gender: "Other",
      bloodlineId: "line",
      seichiSilver: 1000,
      reputationPoints: 100,
      rank: "JONIN",
    });
    await db
      .insert(skillTree)
      .values([
        tier("root"),
        tier("child", 2, ["root"]),
        tier("grandchild", 3, ["child"]),
        tier("other"),
        tier("fifth"),
        tier("sixth"),
      ]);
    stubProfile("fetchUpdatedUser", async () => ({ user: await read() }));
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("saves only the selected option and requires refunds before changing owned mechanics", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(bloodrightRouter, userId, db);
    const source = await db.query.bloodrightOption.findFirst({
      where: eq(bloodrightOption.id, "root"),
    });
    if (!source) throw new Error("Missing option");
    expect(
      (await caller.save({ id: "root", data: { ...source, name: "Renamed option" } }))
        .success,
    ).toBe(true);
    expect(
      (
        await db.query.bloodrightOption.findFirst({
          where: eq(bloodrightOption.id, "child"),
        })
      )?.name,
    ).toBe("child");
    expect((await caller.purchase({ optionId: "root" })).success).toBe(true);
    expect(
      (
        await caller.save({
          id: "root",
          data: { ...source, changes: [{ ...source.changes[0]!, value: 2 }] },
        })
      ).success,
    ).toBe(false);
    expect((await caller.delete({ optionId: "root" })).success).toBe(false);
    expect((await caller.refund({ optionId: "root" })).success).toBe(true);
    expect((await caller.delete({ optionId: "root" })).success).toBe(true);
  });
  it("saves an enhancement for a historical source tag with omitted defaults", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    const tag = { type: "damage", power: 20 } as unknown as ZodAllTags;
    await db
      .update(jutsu)
      .set({ effects: [tag] })
      .where(eq(jutsu.id, "line-jutsu"));
    const saved = await callerForDatabase(bloodrightRouter, userId, db).save({
      data: {
        bloodlineId: "line",
        jutsuId: "line-jutsu",
        name: "Historical source",
        description: "Fixture",
        seichiSilverCost: 10,
        hidden: false,
        changes: [{ tagIndex: 0, tag, field: "power", mode: "FLAT", value: 5 }],
      },
    });
    expect(saved.success).toBe(true);
  });
  it("rejects orphaned tag snapshots without charging Silver", async () => {
    const db = await getTestDatabase();
    await db
      .update(jutsu)
      .set({ effects: [DamageTag.parse({ power: 30 })] })
      .where(eq(jutsu.id, "line-jutsu"));
    expect((await invoke("purchase", { optionId: "root" })).success).toBe(false);
    expect((await read()).seichiSilver).toBe(1000);
  });
  it("rejects an invalid combination across a jutsu evolution family before payment", async () => {
    const db = await getTestDatabase();
    const stun = StunTag.parse({ rounds: 80 });
    await db
      .update(jutsu)
      .set({ effects: [stun] })
      .where(eq(jutsu.id, "line-jutsu"));
    await db.insert(jutsu).values({
      id: "evolved",
      name: "Evolved",
      description: "Fixture",
      image: "",
      battleDescription: "Evolved",
      target: "OPPONENT",
      range: 3,
      requiredRank: "STUDENT",
      jutsuType: "BLOODLINE",
      bloodlineId: "line",
      parentJutsuId: "line-jutsu",
      effects: [stun],
    });
    const changes = [
      { tagIndex: 0, tag: stun, field: "rounds", mode: "FLAT" as const, value: 15 },
    ];
    await db
      .update(bloodrightOption)
      .set({ changes })
      .where(eq(bloodrightOption.id, "root"));
    await db
      .update(bloodrightOption)
      .set({ jutsuId: "evolved", changes })
      .where(eq(bloodrightOption.id, "child"));
    expect((await invoke("purchase", { optionId: "root" })).success).toBe(true);
    expect((await invoke("purchase", { optionId: "child" })).success).toBe(false);
    expect((await read()).seichiSilver).toBe(900);
  });
  it("charges once for concurrent duplicate purchases and refunds once", async () => {
    const purchases = await Promise.all([
      invoke("purchase", { optionId: "root" }),
      invoke("purchase", { optionId: "root" }),
    ]);
    expect(purchases.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(900);
    const refunds = await Promise.all([
      invoke("refund", { optionId: "root" }),
      invoke("refund", { optionId: "root" }),
    ]);
    expect(refunds.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(1000);
  });
  it("enforces balance and five active options", async () => {
    for (const skillId of ["root", "child", "grandchild", "other", "fifth"])
      expect((await invoke("purchase", { optionId: skillId })).success).toBe(true);
    expect((await invoke("purchase", { optionId: "sixth" })).success).toBe(false);
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ seichiSilver: 0, bloodright: [], bloodrightSpent: 0 })
      .where(eq(userData.userId, userId));
    expect((await invoke("purchase", { optionId: "root" })).success).toBe(false);
    expect((await read()).seichiSilver).toBe(0);
  });
  it("refunds only the selected option at its saved cost after a price change", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"])
      await invoke("purchase", { optionId: skillId });
    const db = await getTestDatabase();
    await db
      .update(bloodrightOption)
      .set({ seichiSilverCost: 999 })
      .where(eq(bloodrightOption.id, "root"));
    expect((await invoke("refund", { optionId: "root" })).success).toBe(true);
    const user = await read();
    expect(user.seichiSilver).toBe(700);
    expect(user.bloodrightSpent).toBe(300);
    expect(user.bloodright.map((entry) => entry.optionId)).toEqual([
      "child",
      "grandchild",
      "other",
    ]);
  });
  it("refunds a changed bloodline in one update and does not refund a same-line update", async () => {
    await invoke("purchase", { optionId: "root" });
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" })
      .where(eq(userData.userId, userId));
    expect((await read()).seichiSilver).toBe(900);
    await db
      .update(userData)
      .set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" })
      .where(eq(userData.userId, userId));
    const user = await read();
    expect(user.seichiSilver).toBe(1000);
    expect(user.bloodright).toEqual([]);
    expect(user.bloodrightSpent).toBe(0);
    await db
      .update(userData)
      .set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" })
      .where(eq(userData.userId, userId));
    expect((await read()).bloodright).toEqual([]);
  });
  it("shares the one free reset with Skills and charges 30 reps afterward", async () => {
    await invoke("purchase", { optionId: "root" });
    expect((await invoke("reset")).success).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    const db = await getTestDatabase();
    expect(
      (await callerForDatabase(skillTreeRouter, userId, db).resetSkillPoints()).success,
    ).toBe(true);
    expect((await read()).reputationPoints).toBe(70);
    expect((await read()).monthlySkillResets.count).toBe(2);
  });
  it("returns reset capacity and exact allowance with one user read", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ curEnergy: 999 })
      .where(eq(userData.userId, userId));
    await db
      .insert(userSkill)
      .values({ id: "reset-skill", userId, skillId: "root", activated: true });
    let reads = 0;
    stubProfile("fetchUpdatedUser", async () => {
      reads++;
      return { user: await read(), requiresUserRefresh: false };
    });
    const result = await callerForDatabase(
      skillTreeRouter,
      userId,
      db,
    ).resetSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({});
    const saved = await read();
    expect(result.userPatch?.monthlySkillResets).toEqual(saved.monthlySkillResets);
    expect(result.userPatch?.maxEnergy).toBe(calcEnergy(saved.level));
    expect(saved.curEnergy).toBe(999);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(
      saved.ninjutsuMastery,
    );
    expect(
      await db.query.userSkill.findMany({ where: eq(userSkill.userId, userId) }),
    ).toEqual([]);
    expect(reads).toBe(1);
    const paid = await callerForDatabase(
      skillTreeRouter,
      userId,
      db,
    ).resetSkillPoints();
    expect(paid.userDelta).toEqual({ reputationPoints: -COST_SKILL_RESET });
    expect(paid.userPatch?.monthlySkillResets).toEqual(
      (await read()).monthlySkillResets,
    );
    expect(reads).toBe(2);
  });
  it("keeps the reset refresh when fetching the user settled other progress", async () => {
    const db = await getTestDatabase();
    stubProfile("fetchUpdatedUser", async () => ({
      user: await read(),
      requiresUserRefresh: true,
    }));
    const result = await callerForDatabase(
      skillTreeRouter,
      userId,
      db,
    ).resetSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.monthlySkillResets).toEqual(
      (await read()).monthlySkillResets,
    );
  });
  it("gives Gold two free resets and cannot overspend reputation", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ federalStatus: "GOLD", reputationPoints: 29 })
      .where(eq(userData.userId, userId));
    for (let i = 0; i < 2; i++) {
      await invoke("purchase", { optionId: "root" });
      expect((await invoke("reset")).success).toBe(true);
    }
    await invoke("purchase", { optionId: "root" });
    expect((await invoke("reset")).success).toBe(false);
    expect((await read()).reputationPoints).toBe(29);
    expect((await read()).bloodright).toHaveLength(1);
  });
  it("serializes different purchases competing for the final active slot", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"])
      await invoke("purchase", { optionId: skillId });
    const results = await Promise.all([
      invoke("purchase", { optionId: "fifth" }),
      invoke("purchase", { optionId: "sixth" }),
    ]);
    expect(results.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).bloodright).toHaveLength(5);
    expect((await read()).seichiSilver).toBe(500);
  });
  it("refunds once when a tier refund races a bloodline swap", async () => {
    await invoke("purchase", { optionId: "root" });
    const db = await getTestDatabase();
    await Promise.all([
      invoke("refund", { optionId: "root" }),
      db
        .update(userData)
        .set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" })
        .where(eq(userData.userId, userId)),
    ]);
    expect((await read()).seichiSilver).toBe(1000);
    expect((await read()).bloodrightSpent).toBe(0);
    expect((await read()).bloodright).toEqual([]);
  });
  it("supports repeated staff resets after allowance initialization", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ role: "OWNER", staffAccount: true })
      .where(eq(userData.userId, userId));
    for (let i = 0; i < 2; i++)
      expect(
        (await callerForDatabase(skillTreeRouter, userId, db).resetSkillPoints())
          .success,
      ).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    expect((await read()).monthlySkillResets.count).toBe(0);
  });
  it("prevents content edits and deletion from stranding dependent tiers", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    const root = await db.query.skillTree.findFirst({
      where: eq(skillTree.id, "root"),
    });
    const api = callerForDatabase(skillTreeRouter, userId, db);
    expect(
      (await api.update({ id: "root", data: { ...root, tier: 5 } } as never)).success,
    ).toBe(false);
    expect((await api.delete({ id: "root" })).success).toBe(false);
    expect(
      await db.query.skillTree.findFirst({ where: eq(skillTree.id, "root") }),
    ).toBeDefined();
  });
  it("rejects tiers of another bloodline and changes during battle", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ bloodlineId: "other-line" })
      .where(eq(userData.userId, userId));
    expect((await invoke("purchase", { optionId: "root" })).success).toBe(false);
    await db
      .update(userData)
      .set({ bloodlineId: "line", status: "BATTLE" })
      .where(eq(userData.userId, userId));
    expect((await invoke("purchase", { optionId: "root" })).success).toBe(false);
  });
  it("allows content-only edits to legacy skill hierarchies but validates hierarchy changes", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    await db.update(skillTree).set({ tier: 5 }).where(eq(skillTree.id, "root"));
    const api = callerForDatabase(skillTreeRouter, userId, db);
    for (const id of ["root", "child"]) {
      const skill = await db.query.skillTree.findFirst({ where: eq(skillTree.id, id) });
      expect(
        (
          await api.update({
            id,
            data: { ...skill, description: "Updated description" },
          } as never)
        ).success,
      ).toBe(true);
    }
    const root = await db.query.skillTree.findFirst({
      where: eq(skillTree.id, "root"),
    });
    expect(
      (await api.update({ id: "root", data: { ...root, tier: 6 } } as never)).success,
    ).toBe(false);
  });
  it("rejects bloodline swaps and natural removals during battle without refunding", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { optionId: "root" });
    const awake = await read();
    await db
      .update(userData)
      .set({ status: "BATTLE" })
      .where(eq(userData.userId, userId));
    for (const name of ["removeBloodline", "swapBloodline"] as const) {
      const result = await callerForDatabase(bloodlineRouter, userId, db)[name](
        (name === "swapBloodline" ? { bloodlineId: "line" } : undefined) as never,
      );
      expect(result).toMatchObject({
        success: false,
        message: "You cannot change bloodline during battle",
      });
    }
    expect(await updateBloodline(db, awake, null, 0, "Bloodline Removed")).toEqual({
      granted: false,
      message: "Bloodline or battle status changed. Refresh and try again",
    });
    expect(await read()).toMatchObject({
      bloodlineId: "line",
      seichiSilver: 900,
      bloodrightSpent: 100,
      reputationPoints: 100,
    });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });
  it("rejects battle claims after a refund and refunds after a battle claim", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { optionId: "root" });
    const beforeRefund = await read();
    await invoke("refund", { optionId: "root" });
    const claim = (snapshot: typeof beforeRefund) =>
      db
        .update(userData)
        .set({ status: "BATTLE" })
        .where(and(ne(userData.status, "BATTLE"), matchBloodrightSnapshot(snapshot)));
    expect((await claim(beforeRefund)).rowsAffected).toBe(0);
    await invoke("purchase", { optionId: "root" });
    expect((await claim(await read())).rowsAffected).toBe(1);
    expect((await invoke("refund", { optionId: "root" })).success).toBe(false);
    expect(await read()).toMatchObject({
      seichiSilver: 900,
      bloodrightSpent: 100,
      status: "BATTLE",
    });
  });
  it("claims battle only when a missing bloodline matches the snapshot", async () => {
    const db = await getTestDatabase();
    const snapshot = await read();
    const claim = (bloodlineId: string | null) =>
      db
        .update(userData)
        .set({ status: "BATTLE" })
        .where(
          and(
            ne(userData.status, "BATTLE"),
            matchBloodrightSnapshot({ ...snapshot, bloodlineId }),
          ),
        );
    expect((await claim(null)).rowsAffected).toBe(0);
    await db
      .update(userData)
      .set({ bloodlineId: null })
      .where(eq(userData.userId, userId));
    expect((await claim("line")).rowsAffected).toBe(0);
    expect((await claim(null)).rowsAffected).toBe(1);
  });
  it("clones Silver and saved Bloodright purchases as one debug snapshot without retaining the staff path", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ role: "OWNER", staffAccount: true })
      .where(eq(userData.userId, userId));
    await invoke("purchase", { optionId: "root" });
    await db.insert(userData).values({
      userId: "clone-target",
      username: "CloneTarget",
      gender: "Other",
      bloodlineId: "other-line",
      seichiSilver: 250,
      bloodright: [{ optionId: "target-tier", cost: 77 }],
      bloodrightSpent: 77,
    });
    stubProfile("fetchAttributes", async () => []);
    const api = callerForDatabase(staffRouter, userId, db);
    for (let i = 0; i < 2; i++) {
      expect((await api.cloneUserForDebug({ userId: "clone-target" })).success).toBe(
        true,
      );
      expect(await read()).toMatchObject({
        bloodlineId: "other-line",
        seichiSilver: 250,
        bloodright: [{ optionId: "target-tier", cost: 77 }],
        bloodrightSpent: 77,
      });
      expect((await invoke("reset")).success).toBe(true);
      expect((await read()).seichiSilver).toBe(327);
    }
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "clone-target") }),
    ).toMatchObject({ seichiSilver: 250, bloodrightSpent: 77 });
  });
  it("defers deletion refunds for battling users and lets them recover saved costs after battle", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { optionId: "root" });
    await db
      .update(userData)
      .set({ role: "OWNER", isAi: true, status: "BATTLE" })
      .where(eq(userData.userId, userId));
    await db.insert(userData).values({
      userId: "awake-ai",
      username: "AwakeAI",
      gender: "Other",
      isAi: true,
      bloodlineId: "line",
      seichiSilver: 250,
      bloodright: [{ optionId: "root", cost: 77 }],
      bloodrightSpent: 77,
    });
    expect(
      (await callerForDatabase(bloodlineRouter, userId, db).delete({ id: "line" }))
        .success,
    ).toBe(true);
    expect(
      await db.query.bloodline.findFirst({ where: eq(bloodline.id, "line") }),
    ).toBeUndefined();
    expect(await read()).toMatchObject({
      bloodlineId: null,
      seichiSilver: 900,
      bloodright: [{ optionId: "root", cost: 100 }],
      bloodrightSpent: 100,
    });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "awake-ai") }),
    ).toMatchObject({
      bloodlineId: null,
      seichiSilver: 327,
      bloodright: [],
      bloodrightSpent: 0,
    });
    expect((await invoke("refund", { optionId: "root" })).success).toBe(false);
    await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, userId));
    expect((await invoke("refund", { optionId: "root" })).success).toBe(true);
    expect((await invoke("refund", { optionId: "root" })).success).toBe(false);
    expect(await read()).toMatchObject({
      seichiSilver: 1000,
      bloodright: [],
      bloodrightSpent: 0,
    });
  });
});
