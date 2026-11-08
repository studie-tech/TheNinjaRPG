import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import ManualSkillTreeFolder from "@/app/[shell]/manual/skillTreeFolder/page";
import type { SkillTreeFolder } from "@/drizzle/schema";
import * as requireRole from "@/hooks/useRequireRole";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import * as Image from "@/layout/Image";
import { flushRadixFocus, installBrowserGlobals, restoreBrowserGlobals } from "../../setup/browserGlobals";

const folder = (id: string, order: number, extra: Partial<SkillTreeFolder> = {}) =>
  ({ id, name: `Folder ${id}`, image: "", description: null, hidden: false, order, ...extra }) as SkillTreeFolder;
const folders = [
  folder("a", 10),
  folder("b", 20, { description: "Second", hidden: true, image: "https://img/b.webp" }),
  folder("c", 30),
];
const reorderFolders = vi.fn();
const updateFolder = vi.fn();

beforeEach(() => {
  installBrowserGlobals();
  vi.clearAllMocks();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(ContentImageSelector, "default").mockImplementation(() => null);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(requireRole, "useRequireRole").mockReturnValue({
    userData: { role: "CONTENT-ADMIN" },
    hasAccess: true,
  } as never);
  const mutation = (mutate = vi.fn()) => ({ useMutation: () => ({ mutate, isPending: false }) });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    skillTree: {
      getAllFolders: { useQuery: () => ({ data: folders, isPending: false }) },
      getAll: { useQuery: () => ({ data: { data: [] } }) },
      createFolder: mutation(),
      updateFolder: mutation(updateFolder),
      deleteFolder: mutation(),
      reorderFolders: mutation(reorderFolders),
    },
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const actions = (view: ReturnType<typeof render>, name: string) =>
  within(view.getByRole("heading", { name }).closest(".rounded-lg") as HTMLElement).getAllByRole("button");

it("moves a folder past its neighbour and keeps the outer moves disabled", () => {
  const view = render(<ManualSkillTreeFolder />);
  const [firstUp] = actions(view, "Folder a");
  const [, lastDown] = actions(view, "Folder c");
  expect((firstUp as HTMLButtonElement).disabled).toBe(true);
  expect((lastDown as HTMLButtonElement).disabled).toBe(true);
  const [up, down] = actions(view, "Folder b");
  fireEvent.click(up!);
  fireEvent.click(down!);
  expect(reorderFolders.mock.calls).toEqual([
    [{ folderOrders: [{ id: "a", order: 10 }, { id: "b", order: 9 }, { id: "c", order: 30 }] }],
    [{ folderOrders: [{ id: "a", order: 10 }, { id: "b", order: 31 }, { id: "c", order: 30 }] }],
  ]);
});

it("opens the edit dialog filled with the folder and saves its values", async () => {
  const view = render(<ManualSkillTreeFolder />);
  await act(async () => {
    fireEvent.click(actions(view, "Folder b")[2]!);
  });
  const dialog = view.getByRole("dialog");
  expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Folder b");
  expect((within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Second");
  expect(within(dialog).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(updateFolder).toHaveBeenCalledWith({
    id: "b",
    data: { name: "Folder b", image: "https://img/b.webp", description: "Second", hidden: true, order: 20 },
  });
});
