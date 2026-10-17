import { beforeEach, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { HOME_FURNITURE_STARTERS, HOME_FURNITURE_STORAGE_CAPACITY, HomeTypeDetails } from "@/drizzle/constants";
import { item, itemVariant, userData, userHome, userItem, userRequest, userItemVariant, village } from "@/drizzle/schema";
import { homeRouter } from "@/server/api/routers/home";
import { itemRouter } from "@/server/api/routers/item";
import { createStarterHomeItems } from "@/server/utils/homeFurniture";
import { type HomeFurniture, clampHomeFurniturePlacement } from "@/libs/home";
import { DEFAULT_FURNITURE_DATA, FURNITURE_ITEM_DEFAULTS } from "@/validators/itemFurniture";
import type { HomePlacement } from "@/validators/home";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

const basicFurniture = [
  { itemId: "home-sleeping-mat", action: "sleep", name: "Sleeping mat" },
  { itemId: "home-storage-box", action: "storage", name: "Storage box" },
  { itemId: "home-kitchen-utensils", action: "kitchen", name: "Kitchen utensils" },
] as const;
const userId = "home-owner";
const homeVillage = "home-village";
const initialMoney = HomeTypeDetails.STUDIO_APARTMENT.cost + 200_000;
const essentialLayout: HomePlacement[] = [
  { id: "bed-row", x: 22, y: 15.15, rotation: 0 },
  { id: "storage-row", x: 75, y: 15.15, rotation: 0 },
  { id: "kitchen-row", x: 50, y: 15.15, rotation: 0 },
];
const layout = (x = 30): HomePlacement[] => [
  { id: "cabinet-a", x, y: 40, rotation: 0 },
  { id: "cabinet-b", x: x + 10, y: 60, rotation: 1 },
  ...essentialLayout,
];

const expectLayout = (actual: HomePlacement[] | undefined, expected: HomePlacement[]) => {
  const sort = (placements: HomePlacement[]) => [...placements].sort((a, b) => a.id.localeCompare(b.id));
  expect(actual && sort(actual)).toEqual(sort(expected));
};

/** Real inventory rows verify that every placement and the revision publish together. */
describeWithDatabase("owned furniture persistence", () => {
  beforeEach(async () => {
    await resetTables(userHome, userRequest, userItemVariant, itemVariant, userItem, item, userData, village);
    const database = await getTestDatabase();
    await database.insert(village).values({ id: homeVillage, name: "Home", sector: 30, kageId: "kage" });
    await insertUsers([
      { userId, username: userId, villageId: homeVillage, sector: 30, status: "AWAKE", money: initialMoney },
      { userId: "other-owner", username: "other-owner", villageId: homeVillage, sector: 30, status: "AWAKE" },
    ]);
    await database.insert(userHome).values([{ userId }, { userId: "other-owner" }]);
    await insertItems([
      { ...FURNITURE_ITEM_DEFAULTS, id: "cabinet", name: "Painted Cabinet", description: "Timber cabinet", image: "/cabinet.webp", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, width: 28, groundAnchor: 92, views: { "90": { image: "/cabinet-90.webp" }, "180": { image: "/cabinet-180.webp", width: 18 }, "270": { image: "/cabinet-270.webp", groundAnchor: 85 } } } },
      { ...FURNITURE_ITEM_DEFAULTS, id: "rug", name: "Woven Rug", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, isFloor: true } },
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-bed", name: "Bed", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "sleep", width: 6 }, inShop: false, cost: 0 },
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-storage", name: "Storage", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "storage", width: 6 } },
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-cooking", name: "Cooking", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "kitchen", width: 6 } },
      ...basicFurniture.map(({ itemId, action, name }) => ({ ...FURNITURE_ITEM_DEFAULTS, id: itemId, name: `Basic ${name}`, itemType: "FURNITURE" as const, furnitureData: { ...DEFAULT_FURNITURE_DATA, action, width: 6 }, inShop: false, canBeTraded: false, cost: 0 })),
      { id: "material", name: "Material", itemType: "MATERIAL" },
    ]);
    await insertUserItems([
      { id: "cabinet-a", userId, itemId: "cabinet", storedAtHome: true, homeX: 25, homeY: 30 },
      { id: "cabinet-b", userId, itemId: "cabinet", storedAtHome: true, homeX: 70, homeY: 60, homeRotation: 1 },
      { id: "rug-row", userId, itemId: "rug", storedAtHome: true },
      { id: "bed-row", userId, itemId: "home-bed", storedAtHome: true, homeX: 22, homeY: 15.15 },
      { id: "storage-row", userId, itemId: "home-storage", storedAtHome: true, homeX: 75, homeY: 15.15 },
      { id: "kitchen-row", userId, itemId: "home-cooking", storedAtHome: true, homeX: essentialLayout[2]!.x, homeY: essentialLayout[2]!.y },
      { id: "material-row", userId, itemId: "material", storedAtHome: true },
      { id: "foreign-cabinet", userId: "other-owner", itemId: "cabinet", storedAtHome: true },
    ]);
  });

  const snapshot = async () => {
    const database = await getTestDatabase();
    const [users, inventory] = await Promise.all([
      database.select().from(userData).where(eq(userData.userId, userId)),
      database.select().from(userItem).orderBy(userItem.id),
    ]);
    return { owner: users[0]!, inventory };
  };

  it("ignores inventory with deleted item definitions in home reads and layout saves", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "orphan-row", userId, itemId: "deleted-item", storedAtHome: true, homeX: 50, homeY: 50 }]);
    await db.update(userHome).set({ isPublic: true }).where(eq(userHome.userId, userId));
    const owner = await callerFor(homeRouter, userId);
    const visitor = await callerFor(homeRouter, "other-owner");
    const before = await snapshot();
    const read = await recordQueries(() => owner.getUserHome());
    expect(read.statements).toHaveLength(1);
    expect(read.result?.furniture.map(({ id }) => id)).toContain("cabinet-a");
    expect(read.result?.furniture.map(({ id }) => id)).not.toContain("orphan-row");
    expect(read.result?.layout.map(({ id }) => id)).not.toContain("orphan-row");
    const visit = await visitor.getVisitedHome({ userId });
    expect(visit.success).toBe(true);
    expect(visit.home?.furniture.map(({ id }) => id)).toContain("cabinet-a");
    expect(visit.home?.furniture.map(({ id }) => id)).not.toContain("orphan-row");
    expect(await snapshot()).toEqual(before);
    expect((await owner.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(true);
    expectLayout((await owner.getUserHome())?.layout, layout());
    expect((await snapshot()).inventory.find(({ id }) => id === "orphan-row")).toEqual(before.inventory.find(({ id }) => id === "orphan-row"));
  });

  it("publishes separate rooms and finishes together, then stores removed-room furniture permanently on downgrade", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    const api = await callerFor(homeRouter, userId);
    const placements: HomePlacement[] = [...essentialLayout, { id: "cabinet-a", x: 50, y: 50, rotation: 0, room: "room-4" }, { id: "cabinet-b", x: 50, y: 50, rotation: 0 }];
    const styles = [{ room: "room-4", paint: "sage", floor: "slate" }] as const;
    expect((await api.saveFurnitureLayout({ homeType: "TOWN_HOUSE", revision: 0, placements, styles: [...styles] })).success).toBe(true);
    const home = await api.getUserHome();
    expectLayout(home?.layout, placements);
    expect(home?.styles).toEqual([...styles]);
    expect((await api.toggleStoreItem({ userItemId: "cabinet-a" })).success).toBe(true);
    expect((await snapshot()).inventory.find(({ id }) => id === "cabinet-a")).toMatchObject({ storedAtHome: false, homeRoom: "room-4", homeX: 50, homeY: 50 });
    expect((await api.getUserHome())?.layout.some(({ id }) => id === "cabinet-a")).toBe(true);
    const downgrade = await recordQueries(() => api.upgradeHome({ homeType: "TWO_BED_HOUSE" }));
    expect(downgrade.result.success).toBe(true);
    expect(downgrade.statements.filter((statement) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(statement))).toHaveLength(1);
    const stored = (await snapshot()).inventory.find(({ id }) => id === "cabinet-a");
    expect(stored).toMatchObject({ quantity: 1, storedAtHome: true, homeRoom: "main", homeX: null, homeY: null });
    const downgraded = await api.getUserHome();
    expect(downgraded?.styles).toEqual([]);
    expect(downgraded?.layout.some(({ id }) => id === "cabinet-a")).toBe(false);
    await db.update(userData).set({ money: HomeTypeDetails.TOWN_HOUSE.cost }).where(eq(userData.userId, userId));
    expect((await api.upgradeHome({ homeType: "TOWN_HOUSE" })).success).toBe(true);
    expect((await api.getUserHome())?.layout.some(({ id }) => id === "cabinet-a")).toBe(false);
  });

  it.each([
    { homeType: "MANSION", room: "room-7" },
    { homeType: "PALACE", room: "room-8" },
    { homeType: "MARSHMALLOWOPOLIS", room: "room-9" },
  ] as const)("persists furniture in the highest room of $homeType", async ({ homeType, room }) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType }).where(eq(userData.userId, userId));
    const api = await callerFor(homeRouter, userId);
    const placements: HomePlacement[] = [...essentialLayout, { id: "cabinet-a", x: 50, y: 50, rotation: 0, room }];
    expect((await api.saveFurnitureLayout({ homeType, revision: 0, placements })).success).toBe(true);
    expectLayout((await api.getUserHome())?.layout, placements);
    expect((await snapshot()).inventory.find(({ id }) => id === "cabinet-a")).toMatchObject({ homeRoom: room, homeX: 50, homeY: 50 });
  });

  it("rejects removed rooms and duplicate finishes before publishing", async () => {
    const api = await callerFor(homeRouter, userId);
    const before = await snapshot();
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [...essentialLayout, { id: "cabinet-a", x: 50, y: 50, rotation: 0, room: "room-1" }] })).success).toBe(false);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: essentialLayout, styles: [{ room: "main", paint: "sage", floor: "oak" }, { room: "main", paint: "rose", floor: "slate" }] })).success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("keeps removed-room basics stored after downgrade without restoring them", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    const api = await callerFor(homeRouter, userId);
    const placements = essentialLayout.map((placement, index) => index < 2 ? { ...placement, room: "room-4" as const } : placement);
    expect((await api.saveFurnitureLayout({ homeType: "TOWN_HOUSE", revision: 0, placements })).success).toBe(true);
    expect((await api.toggleStoreItem({ userItemId: "kitchen-row" })).success).toBe(true);
    expect((await api.upgradeHome({ homeType: "TWO_BED_HOUSE" })).success).toBe(true);
    const before = await snapshot();
    expect(before.inventory.find(({ id }) => id === "kitchen-row")).toMatchObject({ storedAtHome: false, homeX: essentialLayout[2]!.x, homeY: essentialLayout[2]!.y });
    const home = await api.getUserHome();
    expectLayout(home?.layout, [essentialLayout[2]!]);
    expect(home?.furnitureRevision).toBe(before.owner.homeFurnitureRevision);
    expect(await snapshot()).toEqual(before);
  });

  it("keeps unplaced carried furniture out of full storage when its old room is removed", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    await insertUserItems([
      ...Array.from({ length: HOME_FURNITURE_STORAGE_CAPACITY - 6 }, (_, i) => ({ id: `stored-${i}`, userId, itemId: "rug", storedAtHome: true })),
      // Ownership transfers can retain the seller's room after clearing placement coordinates.
      { id: "carried-extra", userId, itemId: "rug", homeRoom: "room-6", storedAtHome: false },
    ]);
    const api = await callerFor(homeRouter, userId);
    expect((await api.upgradeHome({ homeType: "TWO_BED_HOUSE" })).success).toBe(true);
    const { inventory } = await snapshot();
    expect(inventory.find(({ id }) => id === "carried-extra")).toMatchObject({ storedAtHome: false, homeX: null, homeY: null });
    expect(inventory.filter((owned) => owned.userId === userId && owned.storedAtHome && owned.itemId !== "material")).toHaveLength(HOME_FURNITURE_STORAGE_CAPACITY);
  });

  it.each([
    [271, "ground"],
    [203, "ice"],
    [305, "dessert"],
    [296, "ocean"],
  ] as const)("uses owner village sector %s for both home views while players travel", async (sector, biome) => {
    const db = await getTestDatabase();
    await db.update(village).set({ sector }).where(eq(village.id, homeVillage));
    await db.insert(village).values({ id: "visitor-village", name: "Visitor", sector: sector === 203 ? 271 : 203, kageId: "visitor-kage" });
    await db.update(userData).set({ sector: sector === 305 ? 203 : 305 }).where(eq(userData.userId, userId));
    await db.update(userData).set({ villageId: "visitor-village", sector: 296 }).where(eq(userData.userId, "other-owner"));
    await db.update(userHome).set({ isPublic: true }).where(eq(userHome.userId, userId));
    const owner = await callerFor(homeRouter, userId);
    const visitor = await callerFor(homeRouter, "other-owner");
    const read = await recordQueries(() => Promise.all([owner.getUserHome(), visitor.getVisitedHome({ userId })]));
    expect(read.result[0]?.biome).toBe(biome);
    expect(read.result[1].home?.biome).toBe(biome);
    expect(read.statements).toHaveLength(3);
  });

  it("uses grassland for village-less homes without depending on current travel location", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ villageId: null, sector: 203 }).where(eq(userData.userId, userId));
    await db.update(userHome).set({ isPublic: true }).where(eq(userHome.userId, userId));
    const owner = await callerFor(homeRouter, userId);
    const visitor = await callerFor(homeRouter, "other-owner");
    expect((await owner.getUserHome())?.biome).toBe("ground");
    expect((await visitor.getVisitedHome({ userId })).home?.biome).toBe("ground");
  });

  it("enforces private, invited, revoked and public visits without exposing unplaced furniture or mutating the owner", async () => {
    const api = await callerFor(homeRouter, userId);
    const visitor = await callerFor(homeRouter, "other-owner");
    const before = await snapshot();
    expect((await visitor.getVisitedHome({ userId })).home).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect((await api.inviteHomeVisitor({ username: "other-owner" })).success).toBe(true);
    const request = (await visitor.getHomeRequests())[0]!;
    expect(request.type).toBe("HOME");
    expect(request.status).toBe("PENDING");
    expect((await visitor.getVisitedHome({ userId })).home).toBeNull();
    expect((await visitor.acceptHomeInvitation({ id: request.id })).success).toBe(true);
    const visit = await visitor.getVisitedHome({ userId });
    expect(visit.success).toBe(true);
    expect(visit.home?.furniture.some(({ id }) => id === "rug-row")).toBe(false);
    expect(visit.home && Object.keys(visit.home).sort()).toEqual(["biome", "furniture", "homeType", "layout", "styles", "username"]);
    expect((await api.cancelHomeInvitation({ id: request.id })).success).toBe(true);
    expect((await visitor.getVisitedHome({ userId })).home).toBeNull();
    expect((await api.setHomeSharing({ revision: 0, isPublic: true })).success).toBe(true);
    expect((await visitor.getVisitedHome({ userId })).success).toBe(true);
    expect((await api.setHomeSharing({ revision: 0, isPublic: false })).success).toBe(false);
    expect((await visitor.getVisitedHome({ userId })).success).toBe(true);
  });

  it("initializes home-only settings on writes while default reads remain side-effect free", async () => {
    const db = await getTestDatabase();
    await db.delete(userHome).where(eq(userHome.userId, userId));
    const api = await callerFor(homeRouter, userId);
    const read = await recordQueries(() => api.getUserHome());
    expect(read.result).toMatchObject({ styles: [], isPublic: false });
    expect(read.statements).toHaveLength(1);
    expect(await db.query.userHome.findFirst({ where: eq(userHome.userId, userId) })).toBeUndefined();
    expect((await api.setHomeSharing({ revision: 99, isPublic: true })).success).toBe(false);
    expect(await db.query.userHome.findFirst({ where: eq(userHome.userId, userId) })).toBeUndefined();
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: essentialLayout, styles: [{ room: "main", paint: "sage", floor: "slate" }] })).success).toBe(true);
    expect((await api.getUserHome())?.styles).toEqual([{ room: "main", paint: "sage", floor: "slate" }]);
    const account = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(account).not.toHaveProperty("homeRoomStyles");
    expect(account).not.toHaveProperty("homeInvitations");
    expect(account).not.toHaveProperty("homePublic");
  });

  it("uses shared invitation states and rejects unauthorized, stale and missing actions", async () => {
    const db = await getTestDatabase();
    const host = await callerFor(homeRouter, userId);
    const guest = await callerFor(homeRouter, "other-owner");
    expect((await host.inviteHomeVisitor({ username: userId })).success).toBe(false);
    expect((await host.inviteHomeVisitor({ username: "missing-player" })).success).toBe(false);
    await db.update(userData).set({ isBanned: true }).where(eq(userData.userId, "other-owner"));
    expect((await host.inviteHomeVisitor({ username: "other-owner" })).success).toBe(false);
    await db.update(userData).set({ isBanned: false }).where(eq(userData.userId, "other-owner"));
    expect((await host.inviteHomeVisitor({ username: "other-owner" })).success).toBe(true);
    const request = (await host.getHomeRequests())[0]!;
    expect((await guest.getHomeRequests())[0]?.id).toBe(request.id);
    expect((await host.acceptHomeInvitation({ id: request.id })).success).toBe(false);
    expect((await host.rejectHomeInvitation({ id: request.id })).success).toBe(false);
    expect((await guest.cancelHomeInvitation({ id: request.id })).success).toBe(false);
    expect((await guest.rejectHomeInvitation({ id: request.id })).success).toBe(true);
    expect((await guest.acceptHomeInvitation({ id: request.id })).success).toBe(false);
    expect((await host.inviteHomeVisitor({ username: "other-owner" })).success).toBe(true);
    expect((await host.getHomeRequests()).find((row) => row.status === "PENDING")).toBeTruthy();
    for (const api of [host, guest]) for (const action of [api.acceptHomeInvitation, api.rejectHomeInvitation, api.cancelHomeInvitation]) {
      expect((await action({ id: "already-cleaned-up" })).success).toBe(false);
    }
    expect((await guest.getVisitedHome({ userId })).home).toBeNull();
  });

  it("keeps one active grant when duplicate invitations race", async () => {
    const db = await getTestDatabase();
    const host = await callerFor(homeRouter, userId);
    const results = await Promise.all([
      host.inviteHomeVisitor({ username: "other-owner" }),
      host.inviteHomeVisitor({ username: "other-owner" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await db.query.userRequest.findMany({ where: and(eq(userRequest.type, "HOME"), eq(userRequest.senderId, userId)) })).toHaveLength(1);
  });

  it("rejects acceptance after a concurrent revocation without recreating access", async () => {
    const db = await getTestDatabase();
    const host = await callerFor(homeRouter, userId);
    await host.inviteHomeVisitor({ username: "other-owner" });
    const request = (await host.getHomeRequests())[0]!;
    const delayed = await callerForDatabase(homeRouter, "other-owner", beforeStatements(db, userRequest, [async () => {
      expect((await host.cancelHomeInvitation({ id: request.id })).success).toBe(true);
    }]));
    expect((await delayed.acceptHomeInvitation({ id: request.id })).success).toBe(false);
    const guest = await callerFor(homeRouter, "other-owner");
    expect((await guest.getVisitedHome({ userId })).home).toBeNull();
    expect((await guest.getHomeRequests())[0]?.status).toBe("CANCELLED");
  });

  it("expires pending invitations without expiring accepted home access", async () => {
    const db = await getTestDatabase();
    const host = await callerFor(homeRouter, userId);
    const guest = await callerFor(homeRouter, "other-owner");
    await host.inviteHomeVisitor({ username: "other-owner" });
    const request = (await host.getHomeRequests())[0]!;
    await db.update(userRequest).set({ createdAt: new Date(Date.now() - 2 * 86400000) }).where(eq(userRequest.id, request.id));
    expect((await guest.acceptHomeInvitation({ id: request.id })).success).toBe(false);
    await db.update(userRequest).set({ status: "ACCEPTED" }).where(eq(userRequest.id, request.id));
    expect((await guest.getVisitedHome({ userId })).success).toBe(true);
    expect((await host.cancelHomeInvitation({ id: request.id })).success).toBe(true);
    expect((await guest.getVisitedHome({ userId })).home).toBeNull();
  });

  it("guards a downgrade against a concurrent layout save before refunding or clearing rooms", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    const regular = await callerFor(homeRouter, userId);
    const client = beforeStatements(db, userItem, [async () => {
      expect((await regular.saveFurnitureLayout({ homeType: "TOWN_HOUSE", revision: 0, placements: essentialLayout })).success).toBe(true);
    }]);
    const api = callerForDatabase(homeRouter, userId, client);
    expect((await api.upgradeHome({ homeType: "NONE" })).success).toBe(false);
    const after = await snapshot();
    expect(after.owner.homeType).toBe("TOWN_HOUSE");
    expect(after.owner.money).toBe(initialMoney);
    expect(after.owner.homeFurnitureRevision).toBe(1);
  });

  it.each(["save", "downgrade"] as const)("rejects %s without changing inventory or balances if home settings disappear before the write", async (action) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    const before = await snapshot();
    const client = beforeStatements(db, userHome, [async () => db.delete(userHome).where(eq(userHome.userId, userId))]);
    const api = callerForDatabase(homeRouter, userId, client);
    const result = action === "save"
      ? await api.saveFurnitureLayout({ homeType: "TOWN_HOUSE", revision: 0, placements: layout(), styles: [{ room: "main", paint: "sage", floor: "slate" }] })
      : await api.upgradeHome({ homeType: "NONE" });
    expect(result.success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])("refunds a downgrade with no removed placements even when inventory is empty: %s", async (isEmpty) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    if (isEmpty) await db.delete(userItem).where(eq(userItem.userId, userId));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    expect((await api.upgradeHome({ homeType: "TWO_BED_HOUSE" })).success).toBe(true);
    const after = await snapshot();
    expect(after.owner.homeType).toBe("TWO_BED_HOUSE");
    expect(after.owner.homeFurnitureRevision).toBe(before.owner.homeFurnitureRevision + 1);
    expect(after.owner.money).toBe(before.owner.money + Math.floor((HomeTypeDetails.TOWN_HOUSE.cost - HomeTypeDetails.TWO_BED_HOUSE.cost) * 0.75));
    expect(after.inventory).toEqual(before.inventory);
  });

  it("refunds a concurrent downgrade once while storing every removed-room placement", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    await db.update(userItem).set({ homeRoom: "room-4" }).where(eq(userItem.userId, userId));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const results = await Promise.all([api.upgradeHome({ homeType: "TWO_BED_HOUSE" }), api.upgradeHome({ homeType: "TWO_BED_HOUSE" })]);
    expect(results.filter(({ success }) => success)).toHaveLength(1);
    const after = await snapshot();
    expect(after.owner.homeFurnitureRevision).toBe(before.owner.homeFurnitureRevision + 1);
    expect(after.owner.money).toBe(before.owner.money + Math.floor((HomeTypeDetails.TOWN_HOUSE.cost - HomeTypeDetails.TWO_BED_HOUSE.cost) * 0.75));
    expect(after.inventory.filter((owned) => owned.userId === userId && owned.homeX !== null)).toHaveLength(0);
    expect(after.inventory.filter((owned) => owned.userId === userId && before.inventory.some((previous) => previous.id === owned.id && previous.homeX !== null)).every((owned) => owned.homeRoom === "main" && owned.storedAtHome && owned.homeRotation === 0)).toBe(true);
  });

  it("rejects a layout after an inventory snapshot claim without regressing its timestamp", async () => {
    const db = await getTestDatabase();
    const next = new Date(Date.now() + 60_000);
    const client = beforeStatements(db, userData, [async () => db.update(userData).set({ updatedAt: next }).where(eq(userData.userId, userId))]);
    const api = callerForDatabase(homeRouter, userId, client);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(false);
    const after = await snapshot();
    expect(after.owner.updatedAt).toEqual(next);
    expect(after.owner.homeFurnitureRevision).toBe(0);
  });

  it.each([{}, { isInAuction: true }, { craftingFinishedAt: new Date(Date.now() + 60_000) }])("counts stored unavailable furniture against capacity without storing a carried piece %j", async (unavailable) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, userId));
    await insertUserItems(Array.from({ length: HOME_FURNITURE_STORAGE_CAPACITY - 6 }, (_, i) => ({ id: `stored-${i}`, userId, itemId: "rug", storedAtHome: true, ...(i === 0 ? unavailable : {}) })));
    await insertUserItems([{ id: "carried-extra", userId, itemId: "rug", storedAtHome: false, homeRoom: "room-1", homeX: 50, homeY: 50 }]);
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const result = await api.saveFurnitureLayout({ homeType: "TOWN_HOUSE", revision: 0, placements: [...essentialLayout, { id: "carried-extra", x: 50, y: 50, rotation: 0, room: "room-1" }] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("storage is full");
    expect((await api.upgradeHome({ homeType: "NONE" })).success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])("reads a revision-zero home without filling missing furniture or placements: empty inventory %s", async (isEmpty) => {
    const database = await getTestDatabase();
    if (isEmpty) await database.delete(userItem).where(eq(userItem.userId, userId));
    else await database.update(userItem).set({ homeX: null, homeY: null }).where(eq(userItem.userId, userId));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    for (let i = 0; i < 2; i++) {
      const read = await recordQueries(() => api.getUserHome());
      expect(read.result?.layout).toEqual([]);
      expect(read.result?.furniture).toHaveLength(isEmpty ? 0 : 6);
      expect(read.result?.furnitureRevision).toBe(0);
      expect(read.statements).toHaveLength(1);
      expect(read.statements[0]).toMatch(/^\s*select\b/i);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("preserves stored action furniture without placing it during a read", async () => {
    const database = await getTestDatabase();
    await database.update(userItem).set({ homeX: null, homeY: null }).where(eq(userItem.id, "kitchen-row"));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const read = await recordQueries(() => api.getUserHome());
    expect(read.result?.layout.some(({ id }) => id === "kitchen-row")).toBe(false);
    expect(read.result?.furniture).toHaveLength(6);
    expect(read.statements).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { isInAuction: true }, { craftingFinishedAt: new Date(Date.now() + 60_000) }, { quantity: 0 },
  ])("does not replace an unavailable action with free furniture %j", async (patch) => {
    const database = await getTestDatabase();
    await database.update(userItem).set(patch).where(eq(userItem.id, "kitchen-row"));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const read = await recordQueries(() => api.getUserHome());
    expect(read.result?.furniture.some(({ action }) => action === "kitchen")).toBe(false);
    expect(read.result?.layout.some(({ id }) => id === "kitchen-row")).toBe(false);
    expect(read.statements).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });

  it("leaves saved furniture and its revision unchanged after content geometry changes", async () => {
    const database = await getTestDatabase();
    await database.update(item).set({ furnitureData: {
      ...DEFAULT_FURNITURE_DATA, action: "kitchen", width: 40,
      geometry: { aspectRatio: 0.05, visibleBounds: { x: 0, y: 0, width: 100, height: 100 }, footprint: { x: 0, y: 90, width: 100, height: 10 } },
    } }).where(eq(item.id, "home-cooking"));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const read = await recordQueries(() => api.getUserHome());
    expect(read.result?.layout).toContainEqual(essentialLayout[2]!);
    expect(read.result?.furniture.some(({ itemId }) => itemId === "home-kitchen-utensils")).toBe(false);
    expect(read.statements).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });

  it("returns coherent revision-zero layouts during concurrent reads without writes", async () => {
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const reads = await recordQueries(() => Promise.all([api.getUserHome(), api.getUserHome()]));
    expect(reads.result[0]).toEqual(reads.result[1]);
    expect(reads.result[0]?.furnitureRevision).toBe(0);
    expect(reads.statements).toHaveLength(2);
    expect(reads.statements.every((statement) => /^\s*select\b/i.test(statement))).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { isBanned: true }, { sector: 31 }, { villageId: null }, { status: "BATTLE" as const }, { status: "ASLEEP" as const },
  ])("reads an unfurnished home without changing account state %j", async (patch) => {
    const database = await getTestDatabase();
    await database.delete(userItem).where(eq(userItem.userId, userId));
    await database.update(userData).set(patch).where(eq(userData.userId, userId));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    const read = await recordQueries(() => api.getUserHome());
    expect(read.result?.furniture).toEqual([]);
    expect(read.result?.layout).toEqual([]);
    expect(read.statements).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });

  it("returns dynamic content and both owned copies while applying the active cosmetic variant", async () => {
    const database = await getTestDatabase();
    await database.insert(itemVariant).values({
      id: "red-cabinet", itemId: "cabinet", name: "Crimson Cabinet", image: "/crimson-cabinet.webp",
      description: "A cabinet with red lacquer", costType: "MONEY", cost: 0, order: 1,
    });
    await database.update(userItem).set({ activeVariantId: "red-cabinet" }).where(eq(userItem.id, "cabinet-a"));
    const api = await callerFor(homeRouter, userId);
    const home = await api.getUserHome();
    expect(home?.furniture).toHaveLength(6);
    expect(home?.furniture.find(({ id }) => id === "cabinet-a")).toMatchObject({
      itemId: "cabinet", name: "Crimson Cabinet", image: "/crimson-cabinet.webp",
      width: 28, groundAnchor: 92, quantity: 1, views: {},
    });
    expect(home?.furniture.find(({ id }) => id === "cabinet-b")?.image).toBe("/cabinet.webp");
    expect(home?.furniture.find(({ id }) => id === "rug-row")?.isFloor).toBe(true);
    expect(home?.furniture.find(({ id }) => id === "bed-row")?.action).toBe("sleep");
    expect(home?.layout).toHaveLength(5);
    expect(home?.furniture.some(({ id }) => id === "foreign-cabinet" || id === "material-row")).toBe(false);
  });

  it("publishes every position and its revision with one mutation statement", async () => {
    const api = await callerFor(homeRouter, userId);
    const queries = await recordQueries(() => api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() }));
    expect(queries.result.success).toBe(true);
    expect(queries.statements.filter((statement) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(statement))).toHaveLength(1);
    const home = await api.getUserHome();
    expectLayout(home?.layout, layout());
    const saved = await snapshot();
    expect(saved.owner.homeFurnitureRevision).toBe(1);
    expect(saved.owner.money).toBe(initialMoney);
    expect(saved.inventory.find(({ id }) => id === "material-row")?.homeX).toBeNull();
    expect(saved.inventory.find(({ id }) => id === "foreign-cabinet")?.homeX).toBeNull();
  });

  it("persists all four quarter turns while rejecting directions without published art", async () => {
    const api = await callerFor(homeRouter, userId);
    for (const rotation of [0, 1, 2, 3] as const) {
      const placements = [{ id: "cabinet-a", x: 30, y: 40, rotation }, ...essentialLayout];
      expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: rotation, placements })).success).toBe(true);
      expectLayout((await api.getUserHome())?.layout, placements);
    }
    const before = await snapshot();
    const result = await api.saveFurnitureLayout({ homeType: "NONE", revision: 4, placements: [{ id: "rug-row", x: 30, y: 40, rotation: 1 }] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("orientation");
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    [{ id: "cabinet-a", x: 0, y: 40, rotation: 0 }],
    [{ id: "cabinet-a", x: 50, y: 80, rotation: 0 }],
    [{ id: "cabinet-a", x: 50, y: 100, rotation: 0 }],
    [{ id: "cabinet-a", x: 50, y: 40, rotation: 0 }, { id: "cabinet-b", x: 50, y: 40, rotation: 0 }],
  ].map((placements) => ({ placements: placements as HomePlacement[] })))("rejects walls, curtains, outdoor furniture and overlapping footprints before writing %j", async ({ placements }) => {
    const api = await callerFor(homeRouter, userId);
    const before = await snapshot();
    const result = await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/floor|overlaps/);
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a rug beneath furniture without allowing the solid pieces to overlap", async () => {
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [
      { id: "cabinet-a", x: 50, y: 40, rotation: 0 },
      { id: "rug-row", x: 50, y: 40, rotation: 0 },
      ...essentialLayout,
    ] })).success).toBe(true);
  });

  it("requires the entire farm artwork to fit in outdoor ground using the joined content metadata", async () => {
    const database = await getTestDatabase();
    const geometry = {
      aspectRatio: 2,
      visibleBounds: { x: 10, y: 10, width: 80, height: 80 },
      footprint: { x: 20, y: 75, width: 60, height: 15 },
    };
    await database.update(item).set({ furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "farm", width: 12, geometry } }).where(eq(item.id, "rug"));
    const api = await callerFor(homeRouter, userId);
    const home = await api.getUserHome();
    const piece = home!.furniture.find(({ id }) => id === "rug-row")!;
    expect(piece.geometry).toEqual(geometry);
    const before = await snapshot();
    const rejected = await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: [{ id: piece.id, x: 50, y: 40, rotation: 0 }] });
    expect(rejected.success).toBe(false);
    expect(rejected.message).toContain("outside");
    expect(await snapshot()).toEqual(before);
    const outdoor = clampHomeFurniturePlacement({ id: piece.id, room: "yard", x: 50, y: 100, rotation: 0 }, piece, "NONE");
    expect(outdoor).not.toBeNull();
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: [outdoor!, ...essentialLayout] })).success).toBe(true);
  });

  it("validates saved directions against the selected skin instead of mixing base artwork", async () => {
    const database = await getTestDatabase();
    await database.insert(itemVariant).values({
      id: "red-cabinet", itemId: "cabinet", name: "Crimson Cabinet", image: "/crimson-cabinet.webp",
      costType: "MONEY", order: 1, furnitureData: { views: { "180": { image: "/red-180.webp", width: 18 } } },
    });
    await database.update(userItem).set({ activeVariantId: "red-cabinet" }).where(eq(userItem.id, "cabinet-a"));
    const api = await callerFor(homeRouter, userId);
    const home = await api.getUserHome();
    const piece = home?.furniture.find(({ id }) => id === "cabinet-a");
    expect(piece?.views).toEqual({ "180": { image: "/red-180.webp", width: 18 } });
    const before = await snapshot();
    const unsupported = await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: [{ id: "cabinet-a", x: 30, y: 40, rotation: 1 }] });
    expect(unsupported.success).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: [{ id: "cabinet-a", x: 30, y: 40, rotation: 2 }, ...essentialLayout] })).success).toBe(true);
  });

  it("serializes overlapping layouts without mixing their positions", async () => {
    const api = await callerFor(homeRouter, userId);
    const candidates = [layout(30), layout(60)];
    const results = await Promise.all(candidates.map((placements) => api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements })));
    expect(results.filter(({ success }) => success)).toHaveLength(1);
    const winner = results.findIndex(({ success }) => success);
    expectLayout((await api.getUserHome())?.layout, candidates[winner]!);
    expect((await snapshot()).owner.homeFurnitureRevision).toBe(1);
  });

  it("rejects a stale revision without changing saved coordinates", async () => {
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(true);
    const before = await snapshot();
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout(60) })).success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["sleep", "storage", "kitchen"] as const)("saves a layout without %s and leaves it stored on later reads", async (action) => {
    const api = await callerFor(homeRouter, userId);
    const rowId = { sleep: "bed-row", storage: "storage-row", kitchen: "kitchen-row" }[action];
    const placements = layout().filter(({ id }) => id !== rowId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements })).success).toBe(true);
    const before = await snapshot();
    expect(before.inventory.find(({ id }) => id === rowId)).toMatchObject({ storedAtHome: true, homeX: null, homeY: null });
    for (let i = 0; i < 2; i++) expectLayout((await api.getUserHome())?.layout, placements);
    expect(await snapshot()).toEqual(before);
  });

  it("stores every furnishing when saving an empty layout and preserves the empty room", async () => {
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [] })).success).toBe(true);
    const before = await snapshot();
    expect(before.inventory.filter(({ userId: owner }) => owner === userId).every(({ homeX, homeY, storedAtHome }) => homeX === null && homeY === null && storedAtHome)).toBe(true);
    for (let i = 0; i < 2; i++) expect((await api.getUserHome())?.layout).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("saves an unfurnished home without adding furniture on later reads", async () => {
    const database = await getTestDatabase();
    await database.delete(userItem).where(eq(userItem.userId, userId));
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [] })).success).toBe(true);
    const before = await snapshot();
    expect((await api.getUserHome())?.layout).toEqual([]);
    expect((await api.getUserHome())?.furniture).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each([...basicFurniture])("keeps a legacy revision-zero $action basic discarded before the first home read", async ({ itemId }) => {
    const database = await getTestDatabase();
    await database.delete(userItem).where(eq(userItem.userId, userId));
    await insertUserItems(basicFurniture.map((piece, index) => ({
      id: piece.itemId, userId, itemId: piece.itemId, storedAtHome: true,
      homeX: essentialLayout[index]!.x, homeY: essentialLayout[index]!.y,
    })));
    const inventory = await callerFor(itemRouter, userId);
    expect((await inventory.sellUserItem({ userItemId: itemId })).success).toBe(true);
    const before = await snapshot();
    expect(before.owner.homeFurnitureRevision).toBe(0);
    const api = await callerFor(homeRouter, userId);
    for (let i = 0; i < 2; i++) {
      const read = await recordQueries(() => api.getUserHome());
      expect(read.result?.furniture.map(({ itemId: id }) => id).sort()).toEqual(basicFurniture.filter((piece) => piece.itemId !== itemId).map((piece) => piece.itemId).sort());
      expect(read.result?.layout.some(({ id }) => id === itemId)).toBe(false);
      expect(read.result?.furnitureRevision).toBe(0);
      expect(read.statements).toHaveLength(1);
      expect(read.statements[0]).toMatch(/^\s*select\b/i);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("keeps all three legacy basics discarded with furniture storage at capacity", async () => {
    const database = await getTestDatabase();
    await database.delete(userItem).where(eq(userItem.userId, userId));
    await insertUserItems([
      ...basicFurniture.map(({ itemId }) => ({ id: itemId, userId, itemId, storedAtHome: true })),
      ...Array.from({ length: HOME_FURNITURE_STORAGE_CAPACITY - 3 }, (_, i) => ({ id: `stored-${i}`, userId, itemId: "rug", storedAtHome: true })),
    ]);
    const inventory = await callerFor(itemRouter, userId);
    for (const { itemId } of basicFurniture) {
      expect((await inventory.sellUserItem({ userItemId: itemId })).success).toBe(true);
    }
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    for (let i = 0; i < 2; i++) {
      const read = await recordQueries(() => api.getUserHome());
      expect(read.result?.furniture.every(({ action }) => action === null)).toBe(true);
      expect(read.result?.furniture).toHaveLength(HOME_FURNITURE_STORAGE_CAPACITY - 3);
      expect(read.result?.layout).toEqual([]);
      expect(read.statements).toHaveLength(1);
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(["bed-row", "storage-row", "kitchen-row"])("keeps existing revision-zero fixture %s discarded before the first home visit", async (id) => {
    const inventory = await callerFor(itemRouter, userId);
    expect((await inventory.sellUserItem({ userItemId: id })).success).toBe(true);
    const before = await snapshot();
    expect(before.owner.homeFurnitureRevision).toBe(0);
    const api = await callerFor(homeRouter, userId);
    for (let i = 0; i < 2; i++) {
      const read = await recordQueries(() => api.getUserHome());
      expect(read.result?.furniture.some((piece) => piece.id === id)).toBe(false);
      expect(read.result?.furniture).toHaveLength(5);
      expect(read.statements).toHaveLength(1);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("provides creation-time starter fixtures and preserves their removal before the first home visit", async () => {
    const database = await getTestDatabase();
    await database.delete(userItem).where(eq(userItem.userId, userId));
    await insertItems([
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-armory", name: "Armory", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "storage" }, cost: 0 },
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-kitchen", name: "Kitchen", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "kitchen" }, cost: 0 },
      { ...FURNITURE_ITEM_DEFAULTS, id: "home-garden", name: "Garden", itemType: "FURNITURE", furnitureData: { ...DEFAULT_FURNITURE_DATA, action: "farm" }, cost: 0 },
    ]);
    await database.insert(userItem).values(createStarterHomeItems(userId));
    const created = await snapshot();
    expect(created.owner.homeFurnitureRevision).toBe(0);
    expect(created.inventory.filter(({ userId: owner }) => owner === userId).map(({ itemId }) => itemId).sort()).toEqual(HOME_FURNITURE_STARTERS.map(({ itemId }) => itemId).sort());
    const inventory = await callerFor(itemRouter, userId);
    for (const piece of created.inventory.filter(({ userId: owner }) => owner === userId)) {
      expect((await inventory.sellUserItem({ userItemId: piece.id })).success).toBe(true);
    }
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    expect((await api.getUserHome())?.furniture).toEqual([]);
    expect((await api.getUserHome())?.layout).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["foreign-cabinet", "material-row", "unknown-row"])("rejects unavailable row %s without a partial room update", async (id) => {
    const api = await callerFor(homeRouter, userId);
    const before = await snapshot();
    const result = await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [...layout(), { id, x: 50, y: 50, rotation: 0 }] });
    expect(result.success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects duplicate instance IDs before any write", async () => {
    const api = await callerFor(homeRouter, userId);
    const before = await snapshot();
    await expect(api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: [layout()[0]!, layout()[0]!] })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { isInAuction: true }, { craftingFinishedAt: new Date(Date.now() + 60_000) }, { quantity: 0 },
  ])("excludes inaccessible ownership %j from reads and saves", async (patch) => {
    const database = await getTestDatabase();
    await database.update(userItem).set(patch).where(eq(userItem.id, "cabinet-a"));
    const api = await callerFor(homeRouter, userId);
    const home = await api.getUserHome();
    expect(home?.furniture.some(({ id }) => id === "cabinet-a")).toBe(false);
    const before = await snapshot();
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: layout() })).success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("excludes hidden furniture and accepts completed crafts", async () => {
    const database = await getTestDatabase();
    await Promise.all([
      database.update(item).set({ hidden: true }).where(eq(item.id, "rug")),
      database.update(userItem).set({ craftingFinishedAt: new Date(Date.now() - 60_000), storedAtHome: false }).where(eq(userItem.id, "cabinet-a")),
    ]);
    const api = await callerFor(homeRouter, userId);
    const home = await api.getUserHome();
    expect(home?.furniture.some(({ id }) => id === "rug-row")).toBe(false);
    expect(home?.furniture.some(({ id }) => id === "cabinet-a")).toBe(true);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: home!.furnitureRevision, placements: layout() })).success).toBe(true);
  });

  it("keeps the same owned-row arrangement after upgrading the residence", async () => {
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(true);
    expect((await api.upgradeHome({ homeType: "STUDIO_APARTMENT" })).success).toBe(true);
    const upgraded = await api.getUserHome();
    expect(upgraded?.homeType).toBe("STUDIO_APARTMENT");
    expectLayout(upgraded?.layout, layout());
  });

  it.each([
    { isBanned: true }, { sector: 31 }, { villageId: null },
    { status: "BATTLE" as const }, { isOutlaw: true, sector: 31 },
  ])("rejects unavailable account access %j without writing", async (patch) => {
    const database = await getTestDatabase();
    await database.update(userData).set(patch).where(eq(userData.userId, userId));
    const before = await snapshot();
    const api = await callerFor(homeRouter, userId);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it.each([{ homeType: "STUDIO_APARTMENT" as const }, { isBanned: true }, { homeFurnitureRevision: 1 }])("rechecks account changes immediately before publishing %j", async (patch) => {
    const database = await getTestDatabase();
    const client = beforeStatements(database, userData, [async () => database.update(userData).set(patch).where(eq(userData.userId, userId))]);
    const api = callerForDatabase(homeRouter, userId, client);
    expect((await api.saveFurnitureLayout({ homeType: "NONE", revision: 0, placements: layout() })).success).toBe(false);
    const home = await callerFor(homeRouter, userId);
    expectLayout((await home.getUserHome())?.layout, [
      { id: "cabinet-a", x: 25, y: 30, rotation: 0 },
      { id: "cabinet-b", x: 70, y: 60, rotation: 1 },
      ...essentialLayout,
    ]);
  });
});
