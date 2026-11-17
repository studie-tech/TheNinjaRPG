import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as activeBuffs from "@/layout/ActiveTimedBuffs";
import * as contentBox from "@/layout/ContentBox";
import * as contentImage from "@/layout/ContentImage";
import Kitchen from "@/layout/Kitchen";
import * as modal from "@/layout/Modal";
import * as timedQueue from "@/layout/TimedQueue";
import * as userContext from "@/utils/UserContext";
import { stubCraftingCache } from "./helpers/craftingCatalog";

describe("Kitchen recipe availability", () => {
  beforeEach(() => {
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: { status: "AWAKE", cookingExperience: 0, village: null },
    } as never);
    vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
      <div>{children}</div>
    ));
    vi.spyOn(contentImage, "default").mockImplementation(() => null);
    vi.spyOn(activeBuffs, "ActiveTimedBuffs").mockImplementation(() => null);
    vi.spyOn(timedQueue, "TimedQueue").mockImplementation(() => null);
    vi.spyOn(modal, "default").mockImplementation(
      ({ children, isOpen, proceed_label, proceedDisabled }) =>
        isOpen ? (
          <div>
            {children}
            <button type="button" disabled={proceedDisabled}>
              {proceed_label}
            </button>
          </div>
        ) : null,
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { requirements: false, owned: 0, label: "Recipe unavailable", disabled: true },
    { requirements: true, owned: 0, label: "Missing ingredients", disabled: true },
    { requirements: true, owned: 1, label: "Ready to cook", disabled: false },
  ])(
    "shows $label and gates the cooking action",
    ({ requirements, owned, label, disabled }) => {
      const recipe = {
        id: "rice-bowl",
        name: "Rice Bowl",
        description: "A warm bowl of rice.",
        rarity: "COMMON",
        cookingMinLevel: 1,
        cookingTimeSeconds: 60,
        cookingOutputQuantity: 1,
        cookingExperience: 10,
        mealDurationSeconds: 60,
        effects: [],
        craftingRequirements: requirements
          ? [
              {
                id: "rice",
                requirementItemId: "rice",
                quantity: 1,
                requirementItem: { name: "Rice" },
              },
            ]
          : [],
      } as unknown as RouterOutputs["occupation"]["getCookingRecipes"][number];
      const query = <T,>(data: T) => ({ data, isPending: false, isError: false });
      stubCraftingCache();
      Object.assign(vi.spyOn(client, "api" as never), {
        useUtils: () => ({}),
        occupation: {
          getCookingRecipes: { useQuery: () => query([recipe]) },
          getCraftingQueue: { useQuery: () => query({ waiting: [], capacity: 2 }) },
          craftItem: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          cancelQueuedCraft: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
        },
        item: {
          getUserItems: {
            useQuery: () => query([{ itemId: "rice", quantity: owned }]),
          },
        },
      });
      const view = render(<Kitchen />);
      const card = view.getByRole("button", { name: /Rice Bowl/ });
      expect(card.textContent).toContain(label);
      fireEvent.click(card);
      expect(
        (view.getByRole("button", { name: "Start cooking" }) as HTMLButtonElement)
          .disabled,
      ).toBe(disabled);
      if (disabled) expect(view.getAllByText(label)).toHaveLength(2);
    },
  );

  it.each([
    { case: "starts while open", startsIn: 20, readAgo: 0 },
    {
      case: "started while a cached queue was closed",
      startsIn: -60000,
      readAgo: 120000,
    },
    { case: "became due before its response arrived", startsIn: -500, readAgo: 0 },
  ])(
    "reads the queue when a waiting job $case, then the inventory it changed",
    async ({ startsIn, readAgo }) => {
      vi.useFakeTimers();
      setSystemTime(Date.UTC(2026, 9, 1, 12));
      const order: string[] = [];
      let finishQueueRead = () => {};
      const queueRead = new Promise<void>((resolve) => {
        finishQueueRead = resolve;
      });
      const invalidate = (name: string) => ({
        invalidate: vi.fn(async () => {
          order.push(name);
        }),
      });
      const startsAt = new Date(Date.now() + startsIn);
      const queue = {
        data: {
          capacity: 2,
          waiting: [
            {
              id: "job",
              quantity: 1,
              name: "Rice Bowl",
              startsAt,
              finishesAt: new Date(startsAt.getTime() + 60000),
            },
          ],
        },
        dataUpdatedAt: Date.now() - readAgo,
        isPending: false,
        isError: false,
        refetch: vi.fn(async () => {
          order.push("queue");
          await queueRead;
        }),
      };
      stubCraftingCache();
      Object.assign(vi.spyOn(client, "api" as never), {
        useUtils: () => ({
          item: {
            getUserItems: invalidate("items"),
            getUserItemsWithVariants: invalidate("variants"),
          },
          profile: { getSidebarTimers: invalidate("timers") },
        }),
        occupation: {
          getCookingRecipes: { useQuery: () => ({ data: [], isPending: false }) },
          getCraftingQueue: { useQuery: () => queue },
          craftItem: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          cancelQueuedCraft: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
        },
        item: { getUserItems: { useQuery: () => ({ data: [], isPending: false }) } },
      });
      const view = render(<Kitchen />);
      expect(queue.refetch).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(Math.max(0, startsIn) + 1000);
      });
      expect(order).toEqual(["queue"]);
      await act(async () => finishQueueRead());
      expect(order).toEqual(["queue", "items", "variants", "timers"]);
      expect(queue.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
      view.rerender(<Kitchen />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(queue.refetch).toHaveBeenCalledTimes(1);
    },
  );
});
