import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import {
  cloneElement,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import * as client from "@/app/_trpc/client";
import * as dialog from "@/components/ui/dialog";
import BountyBoard from "@/layout/BountyBoard";
import * as Image from "@/layout/Image";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

const bounty = (id: string, username: string) => ({
  id,
  status: "OPEN",
  amountRyo: 1000,
  huntersCount: 0,
  targetUserId: `${id}-target`,
  targetUser: { username, level: 10, rank: "GENIN", isOutlaw: false, avatar: null },
  creatorUserId: "creator",
  creatorUser: null,
  huntingUsers: null,
  isCreator: false,
  youSignedUp: false,
  collectedAt: null,
});
// Radix's controlled contract: the trigger asks to toggle, Escape asks to close.
const DialogState = createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>({
  open: false,
  onOpenChange: () => undefined,
});
const dialogStubs = {
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <DialogState.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogState.Provider>
  ),
  DialogTrigger: ({
    children,
  }: {
    children: ReactElement<{ onClick: () => void }>;
  }) => {
    const { open, onOpenChange } = useContext(DialogState);
    return cloneElement(children, {
      onClick: () => {
        children.props.onClick();
        onOpenChange(!open);
      },
    });
  },
  DialogContent: ({ children }: { children: ReactNode }) => {
    const { open, onOpenChange } = useContext(DialogState);
    if (!open) return null;
    return (
      <div role="dialog" onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}>
        {children}
      </div>
    );
  },
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
};
const updateUser = vi.fn(async () => undefined);
let addMoney: ReturnType<typeof vi.fn>;
let succeedAddMoney: (amountRyo: number) => Promise<void>;

beforeEach(() => {
  addMoney = vi.fn();
  const idle = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ bounty: { board: { invalidate: async () => undefined } } }),
    bounty: {
      board: {
        useInfiniteQuery: () => ({
          data: { pages: [{ data: [bounty("b1", "Alpha"), bounty("b2", "Beta")] }] },
          isLoading: false,
          hasNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
      create: idle,
      signup: idle,
      collect: idle,
      retract: idle,
      stopTracking: idle,
      removeAllTrackers: idle,
      addMoney: {
        useMutation: (options: {
          onSuccess: (data: object, variables: { amountRyo: number }) => Promise<void>;
        }) => {
          succeedAddMoney = (amountRyo) =>
            options.onSuccess({ success: true, message: "Added" }, { amountRyo });
          return { mutate: addMoney, isPending: false };
        },
      },
    },
  });
  updateUser.mockClear();
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ updateUser } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  for (const [name, stub] of Object.entries(dialogStubs)) {
    vi.spyOn(dialog, name as keyof typeof dialogStubs).mockImplementation(
      stub as never,
    );
  }
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(UserSearchSelect, "default").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderBoard = () =>
  render(<BountyBoard userData={{ role: "USER", money: 5000 } as never} />);
const addMoneyButton = (view: ReturnType<typeof renderBoard>, username: string) => {
  const row = view.getByText(username).closest("tr");
  return within(row as HTMLElement).getAllByRole("button")[0]!;
};

it("opens the add-money dialog for one bounty and resets it on cancel", () => {
  const view = renderBoard();
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(addMoneyButton(view, "Alpha"));
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.input(view.getByLabelText("Amount (Ryo)"), { target: { value: "250" } });
  expect((view.getByLabelText("Amount (Ryo)") as HTMLInputElement).value).toBe("250");
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(addMoneyButton(view, "Beta"));
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  expect((view.getByLabelText("Amount (Ryo)") as HTMLInputElement).value).toBe("0");
});

it("closes the dialog on dismissal and after a successful top-up", async () => {
  const view = renderBoard();
  fireEvent.click(addMoneyButton(view, "Alpha"));
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();

  fireEvent.click(addMoneyButton(view, "Alpha"));
  fireEvent.input(view.getByLabelText("Amount (Ryo)"), { target: { value: "300" } });
  fireEvent.click(view.getByRole("button", { name: "Add Money" }));
  expect(addMoney).toHaveBeenCalledWith({ bountyId: "b1", amountRyo: 300 });
  await act(() => succeedAddMoney(300));
  expect(view.queryByRole("dialog")).toBeNull();
  expect(updateUser).toHaveBeenCalledWith({ money: 4700 });
});
