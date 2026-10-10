
import type { SQL } from "drizzle-orm";
import { MySqlDialect, QueryBuilder } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { UserRoles, type UserRole } from "@/drizzle/constants";
import * as socials from "@/libs/socials";
import { dataRouter } from "@/server/api/routers/data";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { canAccessHiddenSkillTree } from "@/utils/permissions";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";

const excluded: UserRole[] = [
  "USER",
  "MODERATOR",
  "MODERATOR-ADMIN",
  "HEAD_MODERATOR",
  "JR_MODERATOR",
];
const folders = [
  { id: "visible", name: "Visible", image: "", hidden: false },
  { id: "hidden", name: "Hidden", image: "", hidden: true },
] as const;
const skill = (
  id: string,
  hidden = false,
  folder: { id: string; name: string; image: string; hidden: boolean } = folders[0],
) => ({
  id,
  name: id,
  hidden,
  folder,
  folderId: folder.id,
  skillType: "DEFAULT",
  pathType: "SKILL",
  bloodlineId: null,
  seichiSilverCost: 0,
  costSkillPoints: 2,
  tier: 1,
  effects: [],
  requiredSkillIds: [] as string[],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

beforeEach(() => {
  // Resolver tests must never deliver fixture updates to the configured Discord webhook.
  vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
});

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

// Exercise the actual query/mutation resolvers with an explicit authenticated context.
// Middleware and database transport are outside these visibility policy tests.
const invoke = async (
  name: keyof typeof skillTreeRouter._def.procedures,
  drizzle: object,
  input?: unknown,
  userId: string | null = "viewer",
) => {
  const procedure = skillTreeRouter._def.procedures[name];
  const { resolver } = procedure._def as unknown as {
    resolver: (options: {
      ctx: { drizzle: object; userId: string | null };
      input: unknown;
    }) => Promise<unknown>;
  };
  return resolver({ ctx: { drizzle, userId }, input });
};

const setup = (role: UserRole | null) => {
  const user = role ? { role, username: "staff-fixture", skillPoints: 10 } : null;
  stubProfile("fetchUpdatedUser", async () => ({ user }));
  const skills = [
    skill("public"),
    skill("secret", true),
    skill("folder-secret", false, folders[1]),
  ];
  const owned = [
    { id: "owned", skillId: "secret", activated: false, skill: skills[1]! },
  ];
  const write = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const queryBuilder = new QueryBuilder();
  const drizzle = {
    select: queryBuilder.select.bind(queryBuilder),
    query: {
      userData: { findFirst: vi.fn().mockResolvedValue(user) },
      bloodline: { findFirst: vi.fn().mockResolvedValue(null) },
      skillTree: {
        findMany: vi.fn().mockImplementation((options) => Promise.resolve(options?.where && new MySqlDialect().sqlToQuery(options.where).sql.includes("JSON_CONTAINS") ? [] : skills)),
        findFirst: vi.fn().mockResolvedValue(skills[1]),
      },
      skillTreeFolder: {
        findMany: vi.fn().mockResolvedValue(folders),
        findFirst: vi.fn().mockResolvedValue(folders[0]),
      },
      userSkill: { findMany: vi.fn().mockResolvedValue(owned) },
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: write })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onDuplicateKeyUpdate: write })) })),
  };
  return { drizzle, skills, owned, write, user };
};

describe("hidden skill-tree permissions", () => {
  it.each([
    { role: "MODERATOR-ADMIN", hidden: true, allowed: false },
    { role: "MODERATOR-ADMIN", hidden: false, allowed: true },
    { role: "CONTENT", hidden: true, allowed: true },
  ] as const)(
    "guards folder writes for $role with hidden=$hidden",
    async ({ role, hidden, allowed }) => {
      const { drizzle } = setup(role);
      const data = { name: "Folder", hidden };

      expect(await invoke("createFolder", drizzle, data)).toMatchObject(
        allowed
          ? { success: true }
          : { success: false, message: "You are not authorized to create hidden folders" },
      );
      expect(drizzle.insert).toHaveBeenCalledTimes(allowed ? 1 : 0);

      expect(await invoke("updateFolder", drizzle, { id: "visible", data })).toMatchObject(
        allowed
          ? { success: true }
          : { success: false, message: "You are not authorized to hide folders" },
      );
      expect(drizzle.update).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );

  it("returns the database page without applying the offset a second time", async () => {
    const { drizzle, skills } = setup("USER");
    drizzle.query.skillTree.findMany.mockResolvedValue([skills[0]!]);

    expect(await invoke("getAll", drizzle, { limit: 1, cursor: 2 })).toEqual({
      data: [skills[0]!],
      nextCursor: 3,
    });
    expect(drizzle.query.skillTree.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 2 }),
    );
  });

  it.each(["secret", "folder-secret"])(
    "returns activated prerequisite IDs without exposing %s details",
    async (prerequisiteId) => {
      const { drizzle, skills, owned } = setup("USER");
      const prerequisite = skills.find((entry) => entry.id === prerequisiteId)!;
      owned[0]!.skillId = prerequisite.id;
      owned[0]!.skill = prerequisite;
      owned[0]!.activated = true;
      const visibleSkill = skills[0]!;
      visibleSkill.requiredSkillIds = [prerequisite.id];

      expect(await invoke("getUserSkills", drizzle)).toEqual({
        skills: [],
        activatedSkillIds: [prerequisite.id],
        activatedSkillCount: 1,
        usedSkillPoints: prerequisite.costSkillPoints,
      });

      // The same prerequisite must also satisfy the purchase endpoint.
      drizzle.query.skillTree.findFirst.mockResolvedValue(visibleSkill);
      expect(
        await invoke("purchaseSkill", drizzle, { skillId: visibleSkill.id }),
      ).toMatchObject({ success: true });

      owned[0]!.activated = false;
      expect(await invoke("getUserSkills", drizzle)).toEqual({
        skills: [],
        activatedSkillIds: [],
        activatedSkillCount: 0,
        usedSkillPoints: 0,
      });
      expect(
        await invoke("purchaseSkill", drizzle, { skillId: visibleSkill.id }),
      ).toMatchObject({ success: false, message: "Prerequisites not met" });
    },
  );

  it("rejects hidden skill creation by moderator-admins before writing", async () => {
    const { drizzle, write } = setup("MODERATOR-ADMIN");

    expect(await invoke("create", drizzle)).toMatchObject({
      success: false,
      message: "You are not authorized to create hidden skills",
    });
    expect(drizzle.insert).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects hiding a visible skill or editing a hidden one", async () => {
    const { drizzle, skills } = setup("MODERATOR-ADMIN");
    const visible = skills[0]!;
    const hidden = skills[1]!;
    const data = { ...visible, hidden: false, folderId: null };

    drizzle.query.skillTree.findFirst.mockResolvedValue(visible);
    expect(
      await invoke("update", drizzle, { id: visible.id, data: { ...data, hidden: true } }),
    ).toMatchObject({
      success: false,
      message: "You are not authorized to hide skills",
    });

    drizzle.query.skillTreeFolder.findFirst.mockResolvedValue(folders[1]);
    expect(
      await invoke("update", drizzle, {
        id: visible.id,
        data: { ...data, folderId: folders[1]!.id },
      }),
    ).toMatchObject({
      success: false,
      message: "You are not authorized to hide skills",
    });

    drizzle.query.skillTree.findFirst.mockResolvedValue(hidden);
    expect(await invoke("update", drizzle, { id: hidden.id, data })).toMatchObject({
      success: false,
      message: "Skill not found",
    });
    expect(drizzle.update).not.toHaveBeenCalled();
    expect(socials.callDiscordContent).not.toHaveBeenCalled();

    drizzle.query.skillTree.findFirst.mockResolvedValue(visible);
    drizzle.query.skillTreeFolder.findFirst.mockResolvedValue(folders[0]);
    expect(await invoke("update", drizzle, { id: visible.id, data })).toMatchObject({
      success: true,
    });
    expect(drizzle.update).toHaveBeenCalledTimes(1);
    expect(socials.callDiscordContent).toHaveBeenCalledTimes(1);
    expect(socials.callDiscordContent).toHaveBeenCalledWith(
      "staff-fixture",
      "Updated skill: public",
      [expect.stringContaining('Updated: {"folderId":null}')],
    );
  });

  it.each([null, ...excluded, "CONTENT", "OWNER"] as (UserRole | null)[])(
    "enforces balance statistics visibility for %s when hidden is omitted or requested",
    async (role) => {
      const { drizzle, skills } = setup(role);
      const { resolver } = dataRouter._def.procedures
        .getSkillTreeEffectsBalanceStatistics._def as unknown as {
        resolver: (options: {
          ctx: { drizzle: object; userId: string | null };
          input: { hidden?: boolean };
        }) => Promise<unknown>;
      };
      const allowed = role !== null && !excluded.includes(role);
      const project = ({
        id,
        name,
        costSkillPoints,
        tier,
        effects,
      }: (typeof skills)[number]) => ({
        id,
        name,
        costSkillPoints,
        tier,
        effects,
      });
      expect(
        await resolver({
          ctx: { drizzle, userId: role ? "viewer" : null },
          input: {},
        }),
      ).toEqual((allowed ? skills : [skills[0]!]).map(project));
      expect(drizzle.query.skillTree.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: expect.objectContaining({ hidden: true }),
          with: { folder: { columns: { hidden: true } } },
        }),
      );
      drizzle.query.skillTree.findMany.mockResolvedValue([skills[1]!]);
      expect(
        await resolver({
          ctx: { drizzle, userId: role ? "viewer" : null },
          input: { hidden: true },
        }),
      ).toEqual(allowed ? [project(skills[1]!)] : []);
      if (!role) expect(drizzle.query.userData.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([null, ...excluded, "CONTENT", "OWNER"] as (UserRole | null)[])(
    "hides hidden skills from usage balance statistics for %s",
    async (role) => {
      const { drizzle, skills } = setup(role);
      const select = vi.fn(() => ({
        from: () => ({
          groupBy: () =>
            Promise.resolve([
              { skillId: "secret", userCount: 3 },
              { skillId: "public", userCount: 2 },
              { skillId: "folder-secret", userCount: 1 },
            ]),
        }),
      }));
      const { resolver } = dataRouter._def.procedures.getSkillTreeBalanceStatistics
        ._def as unknown as {
        resolver: (options: {
          ctx: { drizzle: object; userId: string | null };
          input: { minCount: number };
        }) => Promise<{ skillId: string; userCount: number }[]>;
      };
      const allowed = role !== null && !excluded.includes(role);
      const rows = await resolver({
        ctx: { drizzle: { ...drizzle, select }, userId: role ? "viewer" : null },
        input: { minCount: 1 },
      });
      // Every listed id must resolve through skillTree.get for the same viewer.
      expect(rows.map((row) => row.skillId).sort()).toEqual(
        (allowed ? skills.map((entry) => entry.id) : ["public"]).sort(),
      );
      expect(rows.find((row) => row.skillId === "public")).toMatchObject({ userCount: 2 });
      if (allowed) {
        expect(rows.find((row) => row.skillId === "secret")).toMatchObject({ userCount: 3 });
      }
      for (const row of rows) expect(row).not.toHaveProperty("hidden");
      expect(drizzle.query.skillTree.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ with: { folder: { columns: { hidden: true } } } }),
      );
    },
  );

  it.each([...UserRoles])("defines access for %s", (role) => {
    expect(canAccessHiddenSkillTree(role)).toBe(!excluded.includes(role));
  });

  it.each([undefined, null])("rejects a missing role: %s", (role) => {
    expect(canAccessHiddenSkillTree(role)).toBe(false);
  });

  it.each([...excluded, "CONTENT", "CODER", "OWNER", "EVENT", "BALANCE"] as UserRole[])(
    "applies the same visibility to queries and progress for %s",
    async (role) => {
      const { drizzle, owned, skills } = setup(role);
      const allowed = !excluded.includes(role);
      owned[0]!.activated = true;
      drizzle.query.skillTree.findMany.mockResolvedValue(allowed ? skills : [skills[0]!]);
      const list = await invoke("getAll", drizzle, { limit: 500 });
      expect(list).toMatchObject({ data: allowed ? [expect.anything(), expect.anything(), expect.anything()] : [expect.objectContaining({ id: "public" })] });
      const options = drizzle.query.skillTree.findMany.mock.calls[0]![0] as {
        where?: SQL; limit: number; offset: number;
      };
      expect(options).toMatchObject({ limit: 500, offset: 0 });
      if (allowed) {
        expect(new MySqlDialect().sqlToQuery(options.where!).params).toEqual(["SKILL"]);
      } else {
        const query = new MySqlDialect().sqlToQuery(options.where!);
        expect(query.sql).toContain("`SkillTree`.`hidden` = ?");
        expect(query.sql).toContain("`SkillTree`.`folderId` is null");
        expect(query.sql).toContain("not in (select");
        expect(query.sql).toContain("`SkillTreeFolder`.`hidden` = ?");
        expect(query.params).toEqual(["SKILL", false, true]);
      }
      drizzle.query.skillTree.findMany.mockResolvedValue(allowed ? [owned[0]!.skill] : []);
      expect(await invoke("getAll", drizzle, { limit: 500, hidden: true })).toMatchObject({
        data: allowed ? [expect.objectContaining({ id: "secret" })] : [],
      });
      drizzle.query.skillTree.findMany.mockResolvedValue([
        skill("public"), skill("secret", true), skill("folder-secret", false, folders[1]),
      ]);
      expect(await invoke("getAllNames", drizzle)).toHaveLength(allowed ? 3 : 1);
      expect(await invoke("get", drizzle, { id: "secret" })).toEqual(allowed ? expect.objectContaining({ id: "secret" }) : null);
      expect(await invoke("getAllFolders", drizzle, { includeHidden: true })).toHaveLength(allowed ? 2 : 1);
      expect(await invoke("getAllFolders", drizzle, { includeHidden: false })).toHaveLength(1);
      expect(await invoke("getUserSkills", drizzle)).toMatchObject({
        skills: allowed ? [expect.anything()] : [],
        activatedSkillCount: 1,
        usedSkillPoints: 2,
      });
      expect(await invoke("getFolderStats", drizzle)).toEqual(allowed ? [
        { folderId: "visible", folderName: "Visible", folderImage: "", totalSkills: 2, ownedSkills: 1 },
        { folderId: "hidden", folderName: "Hidden", folderImage: "", totalSkills: 1, ownedSkills: 0 },
      ] : [{ folderId: "visible", folderName: "Visible", folderImage: "", totalSkills: 1, ownedSkills: 0 }]);
    },
  );

  it("does not expose hidden content to anonymous viewers or through pagination", async () => {
    const { drizzle } = setup(null);
    drizzle.query.skillTree.findMany.mockResolvedValue([]);
    expect(await invoke("getAll", drizzle, { limit: 1, cursor: 1 }, null)).toMatchObject({ data: [] });
    expect(drizzle.query.skillTree.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 1, where: expect.anything() }),
    );
    expect(await invoke("getAllFolders", drizzle, { includeHidden: true }, null)).toHaveLength(1);
    expect(await invoke("get", drizzle, { id: "secret" }, null)).toBeNull();
  });

  it.each([...excluded, "CONTENT", "CODER", "OWNER"] as UserRole[])(
    "guards activation and purchase for %s", async (role) => {
      const { drizzle, write } = setup(role);
      const allowed = !excluded.includes(role);
      expect(await invoke("purchaseSkill", drizzle, { skillId: "secret" })).toMatchObject({ success: allowed });
      expect(write).toHaveBeenCalledTimes(allowed ? 1 : 0);
      drizzle.query.userSkill.findMany.mockResolvedValue([]);
      expect(await invoke("purchaseSkill", drizzle, { skillId: "secret" })).toMatchObject({ success: allowed });
      expect(write).toHaveBeenCalledTimes(allowed ? 2 : 0);
    },
  );

  it.each([...excluded])("rejects visible skills inside hidden folders for %s", async (role) => {
    const { drizzle, skills, write } = setup(role);
    drizzle.query.skillTree.findFirst.mockResolvedValue(skills[2]);
    expect(await invoke("purchaseSkill", drizzle, { skillId: "folder-secret" })).toMatchObject({ success: false });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["prerequisites", "points", "special", "activated"])("retains the %s guard for authorized staff", async (guard) => {
    const { drizzle, skills, owned, write, user } = setup("OWNER");
    if (guard === "prerequisites") skills[1]!.requiredSkillIds = ["missing"];
    if (guard === "points") user!.skillPoints = 0;
    if (guard === "special") {
      skills[1]!.skillType = "SPECIAL";
      drizzle.query.userSkill.findMany.mockResolvedValue([]);
    }
    if (guard === "activated") owned[0]!.activated = true;
    expect(await invoke("purchaseSkill", drizzle, { skillId: "secret" })).toMatchObject({ success: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("allows an authorized owner to activate an unlocked hidden special skill", async () => {
    const { drizzle, skills, write } = setup("CONTENT");
    skills[1]!.skillType = "SPECIAL";
    expect(await invoke("purchaseSkill", drizzle, { skillId: "secret" })).toMatchObject({
      success: true,
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("counts special skills only after ownership is unlocked", async () => {
    const { drizzle, skills } = setup("OWNER");
    skills[1]!.skillType = "SPECIAL";
    drizzle.query.userSkill.findMany.mockResolvedValue([]);
    expect(await invoke("getFolderStats", drizzle)).toEqual(expect.arrayContaining([
      expect.objectContaining({ folderId: "visible", totalSkills: 1, ownedSkills: 0 }),
    ]));
  });
});
