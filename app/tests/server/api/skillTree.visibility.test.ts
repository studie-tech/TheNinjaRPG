// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRoles, type UserRole } from "@/drizzle/constants";
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
  costSkillPoints: 2,
  requiredSkillIds: [] as string[],
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
  const user = role ? { role, skillPoints: 10 } : null;
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
  const drizzle = {
    query: {
      userData: { findFirst: vi.fn().mockResolvedValue(user) },
      skillTree: {
        findMany: vi.fn().mockResolvedValue(skills),
        findFirst: vi.fn().mockResolvedValue(skills[1]),
      },
      skillTreeFolder: { findMany: vi.fn().mockResolvedValue(folders) },
      userSkill: { findMany: vi.fn().mockResolvedValue(owned) },
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: write })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onDuplicateKeyUpdate: write })) })),
  };
  return { drizzle, skills, owned, write, user };
};

describe("hidden skill-tree permissions", () => {
  it.each(UserRoles)("defines access for %s", (role) => {
    expect(canAccessHiddenSkillTree(role)).toBe(!excluded.includes(role));
  });

  it.each([undefined, null])("rejects a missing role: %s", (role) => {
    expect(canAccessHiddenSkillTree(role)).toBe(false);
  });

  it.each([...excluded, "CONTENT", "CODER", "OWNER", "EVENT", "BALANCE"] as UserRole[])(
    "applies the same visibility to queries and progress for %s",
    async (role) => {
      const { drizzle, owned } = setup(role);
      const allowed = !excluded.includes(role);
      owned[0]!.activated = true;
      const list = await invoke("getAll", drizzle, { limit: 500 });
      expect(list).toMatchObject({ data: allowed ? [expect.anything(), expect.anything(), expect.anything()] : [expect.objectContaining({ id: "public" })] });
      drizzle.query.skillTree.findMany.mockResolvedValue([owned[0]!.skill]);
      expect(await invoke("getAll", drizzle, { limit: 500, hidden: true })).toMatchObject({
        data: allowed ? [expect.objectContaining({ id: "secret" })] : [],
      });
      drizzle.query.skillTree.findMany.mockResolvedValue([
        skill("public"), skill("secret", true), skill("folder-secret", false, folders[1]),
      ]);
      expect(await invoke("getAllNames", drizzle)).toHaveLength(allowed ? 3 : 1);
      expect(await invoke("get", drizzle, { id: "secret" })).toEqual(allowed ? expect.objectContaining({ id: "secret" }) : undefined);
      expect(await invoke("getAllFolders", drizzle, { includeHidden: true })).toHaveLength(allowed ? 2 : 1);
      expect(await invoke("getAllFolders", drizzle, { includeHidden: false })).toHaveLength(1);
      expect(await invoke("getUserSkills", drizzle)).toMatchObject({
        skills: allowed ? [expect.anything()] : [], usedSkillPoints: 2,
      });
      expect(await invoke("getFolderStats", drizzle)).toEqual(allowed ? [
        { folderId: "visible", folderName: "Visible", folderImage: "", totalSkills: 2, ownedSkills: 1 },
        { folderId: "hidden", folderName: "Hidden", folderImage: "", totalSkills: 1, ownedSkills: 0 },
      ] : [{ folderId: "visible", folderName: "Visible", folderImage: "", totalSkills: 1, ownedSkills: 0 }]);
    },
  );

  it("does not expose hidden content to anonymous viewers or through pagination", async () => {
    const { drizzle } = setup(null);
    expect(await invoke("getAll", drizzle, { limit: 1, cursor: 1 }, null)).toMatchObject({ data: [] });
    expect(await invoke("getAllFolders", drizzle, { includeHidden: true }, null)).toHaveLength(1);
    expect(await invoke("get", drizzle, { id: "secret" }, null)).toBeUndefined();
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

  it.each(excluded)("rejects visible skills inside hidden folders for %s", async (role) => {
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
    expect(write).toHaveBeenCalledOnce();
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
