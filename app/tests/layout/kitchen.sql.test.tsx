import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import * as client from "@/app/_trpc/client";
import { SHRINE_BOOST_BASE_PERC } from "@/drizzle/constants";
import {
  craftingRequirement,
  item,
  sector,
  userCookingJob,
  userData,
  userItem,
  userQueue,
  village,
} from "@/drizzle/schema";
import * as activeBuffs from "@/layout/ActiveTimedBuffs";
import * as contentBox from "@/layout/ContentBox";
import * as contentImage from "@/layout/ContentImage";
import Kitchen from "@/layout/Kitchen";
import * as modal from "@/layout/Modal";
import * as timedQueue from "@/layout/TimedQueue";
import { fetchUserItems } from "@/routers/item";
import { occupationRouter } from "@/routers/occupation";
import { fetchUpdatedUser } from "@/routers/profile";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import * as userContext from "@/utils/UserContext";
import {
  DecreaseCookingTime,
  DecreaseCraftingTime,
  IncreaseRegenerationTag,
} from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { insertItems, insertUserItems, insertUsers } from "../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("Kitchen shrine duration preview", () => {
  beforeEach(async () => {
    await resetTables(
      craftingRequirement,
      userCookingJob,
      userQueue,
      userItem,
      item,
      userData,
      sector,
      village,
    );
    vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
      <div>{children}</div>
    ));
    vi.spyOn(contentImage, "default").mockImplementation(() => null);
    vi.spyOn(activeBuffs, "ActiveTimedBuffs").mockImplementation(() => null);
    vi.spyOn(timedQueue, "TimedQueue").mockImplementation(() => null);
    vi.spyOn(modal, "default").mockImplementation(({ children, isOpen }) =>
      isOpen ? <div>{children}</div> : null,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    { name: "locked reserve shrine", shrineLevel: 3, lockDays: 7, hasBoost: false },
    { name: "destroyed shrine", shrineLevel: 0, lockDays: 0, hasBoost: false },
    { name: "expired reserve lock", shrineLevel: 3, lockDays: -1, hasBoost: true },
  ])("matches the persisted Cooking duration with $name", async (fixture) => {
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "kitchen-village",
      name: "Kitchen village",
      sector: 100,
      kageId: "kitchen-cook",
      shrineSettings: {
        unlockedAiIds: [],
        activeBoosts: { Crafting: new Date(Date.now() + 86400000).toISOString() },
        activeAiIds: [],
      },
    });
    await db.insert(sector).values({
      sector: 100,
      villageId: "kitchen-village",
      shrineLevel: fixture.shrineLevel,
      boostLockedUntil:
        fixture.lockDays === 0
          ? null
          : new Date(Date.now() + fixture.lockDays * 86400000),
    });
    await insertUsers([
      {
        userId: "kitchen-cook",
        username: "Cook",
        villageId: "kitchen-village",
        occupation: null,
        status: "AWAKE",
        regenAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await insertItems([
      { id: "rice", name: "Rice", canStack: true, stackSize: 100 },
      {
        id: "cook-gear",
        itemType: "ARMOR",
        maxDurability: 100,
        effects: [
          DecreaseCookingTime.parse({ power: 10 }),
          DecreaseCraftingTime.parse({ power: 60 }),
        ],
      },
      {
        id: "meal",
        name: "Rice Bowl",
        ...MEAL_ITEM_DEFAULTS,
        itemType: "MEAL",
        canBeCrafted: true,
        stackSize: 100,
        cookingTimeSeconds: 60,
        cookingOutputQuantity: 1,
        cookingExperience: 10,
        effects: [IncreaseRegenerationTag.parse({ power: 10 })],
      },
    ]);
    await db.insert(craftingRequirement).values({
      id: "recipe",
      craftItemId: "meal",
      requirementItemId: "rice",
      quantity: 1,
    });
    await insertUserItems([
      { id: "owned-rice", userId: "kitchen-cook", itemId: "rice", quantity: 10 },
      {
        id: "owned-cook-gear",
        userId: "kitchen-cook",
        itemId: "cook-gear",
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    const [{ user }, recipe, inventory] = await Promise.all([
      fetchUpdatedUser({ client: db, userId: "kitchen-cook" }),
      db.query.item.findFirst({
        where: eq(item.id, "meal"),
        with: { craftingRequirements: { with: { requirementItem: true } } },
      }),
      fetchUserItems(db, "kitchen-cook"),
    ]);
    if (!user || !recipe) throw new Error("Missing cooking fixture");
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: user,
    } as never);
    const query = <T,>(data: T) => ({ data, isPending: false, isError: false });
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      occupation: {
        getCookingRecipes: { useQuery: () => query([recipe]) },
        getCraftingQueue: { useQuery: () => query({ waiting: [], capacity: 2 }) },
        craftItem: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        cancelQueuedCraft: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
      item: { getUserItems: { useQuery: () => query(inventory) } },
    });
    const view = render(<Kitchen />);
    const recipeCard = view.getByRole("button", { name: /Rice Bowl/ });
    fireEvent.click(recipeCard);

    const startedAt = Date.now();
    const result = await callerForDatabase(
      occupationRouter,
      "kitchen-cook",
      db,
    ).craftItem({
      itemId: "meal",
      quantity: 1,
    });
    const completedAt = Date.now();
    expect(result.success).toBe(true);
    const saved = await db.query.userItem.findFirst({
      where: eq(userItem.itemId, "meal"),
    });
    if (!saved?.craftingFinishedAt) throw new Error("Cooking output was not persisted");
    const seconds = Math.ceil(
      Math.round(
        recipe.cookingTimeSeconds *
          (fixture.hasBoost ? 1 + SHRINE_BOOST_BASE_PERC / 100 : 1),
      ) * 0.9,
    );
    expect(saved.craftingFinishedAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + seconds * 1000,
    );
    expect(saved.craftingFinishedAt.getTime()).toBeLessThanOrEqual(
      completedAt + seconds * 1000,
    );
    const duration = `· ${formatSecondsToTimeDisplay(seconds)} ·`;
    expect({
      recipeCard: recipeCard.textContent,
      batchOutput: view.getByText(/^Output:/).textContent,
    }).toEqual({
      recipeCard: expect.stringContaining(duration),
      batchOutput: expect.stringContaining(duration),
    });
  });
});
