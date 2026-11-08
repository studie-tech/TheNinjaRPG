import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import RewardsPage from "@/app/[shell]/manual/rewards/page";
import * as ContentBox from "@/layout/ContentBox";
import * as EditContent from "@/layout/EditContent";
import * as UserContext from "@/utils/UserContext";
import { ObjectiveReward } from "@/validators/rewards";

const rewards = ObjectiveReward.parse({ reward_money: 50 });
const pack = { id: "pack-1", name: "Starter", description: "Some ryo", rewards };
const savePackage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(EditContent, "RewardFormWrapper").mockImplementation(() => null);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "staff", role: "CONTENT-ADMIN" },
  } as never);
  const mutation = (mutate = vi.fn()) => ({ useMutation: () => ({ mutate, isPending: false }) });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    rewardPackages: {
      getCatalog: {
        useQuery: () => ({
          data: { packages: [pack], nodes: [] },
          isPending: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      savePackage: mutation(savePackage),
      saveNode: mutation(),
      deletePackage: mutation(),
      deleteNode: mutation(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("edits a package in place and saves a copy as a new package", () => {
  const view = render(<RewardsPage />);
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  expect(view.getByRole("heading", { name: "Edit Reward Package" })).toBeDefined();
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Starter");
  expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Some ryo");
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  fireEvent.click(view.getByRole("button", { name: "Copy" }));
  expect(view.getByRole("heading", { name: "Create Reward Package" })).toBeDefined();
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Starter copy");
  expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Some ryo");
  fireEvent.click(view.getByRole("button", { name: "Save" }));

  expect(savePackage.mock.calls).toEqual([
    [{ id: "pack-1", data: { name: "Starter", description: "Some ryo", rewards } }],
    [{ id: undefined, data: { name: "Starter copy", description: "Some ryo", rewards } }],
  ]);
  const [edited, copied] = savePackage.mock.calls.map((call) => call[0].data.rewards);
  expect(edited).not.toBe(rewards);
  expect(copied).not.toBe(rewards);
  expect(Object.keys(savePackage.mock.calls[1]?.[0] ?? {})).toEqual(["id", "data"]);
});
