import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import type { ComponentProps, ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { CRAFTING_TIMES_MINS, SHRINE_BOOST_BASE_PERC } from "@/drizzle/constants";
import {
  craftingRequirement,
  item,
  sector,
  userData,
  userItem,
  userQueue,
  village,
} from "@/drizzle/schema";
import * as combatActions from "@/layout/CombatActions";
import { CraftingCatalog } from "@/layout/CraftingCatalog";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import * as modal from "@/layout/Modal";
import { getCraftingRank } from "@/libs/crafting";
import { fetchUserItems } from "@/routers/item";
import { occupationRouter } from "@/routers/occupation";
import { fetchUpdatedUser } from "@/routers/profile";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import * as userContext from "@/utils/UserContext";
import { DecreaseCookingTime, DecreaseCraftingTime } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";
import { ensureDom } from "../setup/dom.mjs";

describeWithDatabase("CraftingCatalog shrine duration preview", () => {
  beforeEach(async () => {
    ensureDom();
    // Profile data comes from fixture props; the catalog only needs the context clock.
    vi.spyOn(userContext, "useUserData").mockReturnValue({ timeDiff: 0 } as never);
    await resetTables(
      craftingRequirement,
      userQueue,
      userItem,
      item,
      userData,
      sector,
      village,
    );
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      occupation: {
        craftItem: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    });
    vi.spyOn(modal, "default").mockImplementation(
      ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
        isOpen ? <div>{children}</div> : null,
    );
    vi.spyOn(combatActions, "ActionSelector").mockImplementation(
      ({
        items,
        onClick,
      }: ComponentProps<typeof combatActions.ActionSelector>) => (
        <>
          {items?.map((entry) => (
            <button key={entry.id} type="button" onClick={() => onClick(entry.id)}>
              {entry.name}
            </button>
          ))}
        </>
      ),
    );
    vi.spyOn(itemWithEffects, "default").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    { name: "locked reserve shrine", shrineLevel: 3, lockDays: 7, hasBoost: false },
    { name: "destroyed shrine", shrineLevel: 0, lockDays: 0, hasBoost: false },
    { name: "expired reserve lock", shrineLevel: 3, lockDays: -1, hasBoost: true },
  ])("matches the persisted craft duration with $name", async (fixture) => {
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "craft-village",
      name: "Craft village",
      sector: 100,
      kageId: "crafter",
      shrineSettings: {
        unlockedAiIds: [],
        activeBoosts: { Crafting: new Date(Date.now() + 86400000).toISOString() },
        activeAiIds: [],
      },
    });
    await db.insert(sector).values({
      sector: 100,
      villageId: "craft-village",
      shrineLevel: fixture.shrineLevel,
      boostLockedUntil:
        fixture.lockDays === 0
          ? null
          : new Date(Date.now() + fixture.lockDays * 86400000),
    });
    await insertUsers([
      {
        userId: "crafter",
        username: "Crafter",
        villageId: "craft-village",
        occupation: "CRAFTING",
        craftingExperience: 0,
        status: "AWAKE",
      },
    ]);
    await insertItems([
      { id: "material", name: "Material" },
      {
        id: "craft-gear",
        itemType: "ARMOR",
        maxDurability: 100,
        effects: [
          DecreaseCraftingTime.parse({ power: 10 }),
          DecreaseCookingTime.parse({ power: 60 }),
        ],
      },
      {
        id: "output",
        name: "Crafted blade",
        itemType: "WEAPON",
        canBeCrafted: true,
        stackSize: 1,
        rarity: "COMMON",
      },
    ]);
    await db.insert(craftingRequirement).values({
      id: "requirement",
      craftItemId: "output",
      requirementItemId: "material",
      quantity: 1,
    });
    await insertUserItems([
      { id: "owned-material", userId: "crafter", itemId: "material", quantity: 10 },
      {
        id: "owned-craft-gear",
        userId: "crafter",
        itemId: "craft-gear",
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    const [{ user }, output, inventory] = await Promise.all([
      fetchUpdatedUser({ client: db, userId: "crafter" }),
      db.query.item.findFirst({
        where: eq(item.id, "output"),
        with: { craftingRequirements: { with: { requirementItem: true } } },
      }),
      fetchUserItems(db, "crafter"),
    ]);
    if (!user || !output) throw new Error("Missing crafting fixture");
    const view = render(
      <CraftingCatalog
        craftableItems={[output]}
        userItems={inventory}
        userData={user}
        isBusy={false}
        isQueueFull={false}
      />,
    );
    fireEvent.click(view.getByText("Weapons"));
    fireEvent.click(view.getByRole("button", { name: "Crafted blade" }));

    const startedAt = Date.now();
    const result = await callerForDatabase(occupationRouter, "crafter", db).craftItem({
      itemId: "output",
      quantity: 1,
    });
    const completedAt = Date.now();
    expect(result.success).toBe(true);
    const saved = await db.query.userItem.findFirst({
      where: eq(userItem.itemId, "output"),
    });
    if (!saved?.craftingFinishedAt) throw new Error("Craft was not persisted");
    const baseSeconds = CRAFTING_TIMES_MINS[getCraftingRank(0)].COMMON * 60;
    const seconds = Math.ceil(
      Math.round(
        baseSeconds * (fixture.hasBoost ? 1 - SHRINE_BOOST_BASE_PERC / 100 : 1),
      ) * 0.9,
    );
    expect(saved.craftingFinishedAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + seconds * 1000,
    );
    expect(saved.craftingFinishedAt.getTime()).toBeLessThanOrEqual(
      completedAt + seconds * 1000,
    );
    expect(view.getByText("Total Crafting Time:").parentElement?.textContent).toBe(
      `Total Crafting Time:${formatSecondsToTimeDisplay(seconds)}`,
    );
  });
});
