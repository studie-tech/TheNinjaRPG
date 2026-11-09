import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import LoadoutSelector from "@/layout/LoadoutSelector";
import * as userContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(((
    select: (user: { itemLoadout: string }) => unknown,
  ) => ({ data: select({ itemLoadout: "l2" }) })) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const renderDropdown = (props: { renamable?: boolean } = {}) => {
  const rename = vi.fn();
  render(
    <LoadoutSelector
      variant="dropdown"
      {...props}
      config={{
        query: {
          data: [{ id: "l1", name: "PvE" }, { id: "l2" }],
          isFetching: false,
        },
        selectMutation: { mutate: vi.fn(), isPending: false },
        renameMutation: { mutate: rename, isPending: false },
        maxLoadoutsFn: () => 2,
        getSelectedId: (user) => user.itemLoadout,
      }}
    />,
  );
  return { rename };
};

it("renames the selected loadout from the pencil beside the dropdown", () => {
  const { rename } = renderDropdown({ renamable: true });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Rename Loadout 2" }));
  });
  const input = screen.getByRole("textbox", {
    name: "Rename Loadout 2",
  }) as HTMLInputElement;
  // An unnamed loadout shows the name it goes by.
  expect(input.placeholder).toBe("Loadout 2");
  act(() => {
    fireEvent.change(input, { target: { value: "  Arena  " } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(rename).toHaveBeenCalledWith({ id: "l2", name: "Arena" });
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps the name when the rename is cancelled with Escape", () => {
  const { rename } = renderDropdown({ renamable: true });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Rename Loadout 2" }));
  });
  const input = screen.getByRole("textbox", { name: "Rename Loadout 2" });
  act(() => {
    fireEvent.change(input, { target: { value: "Arena" } });
    fireEvent.keyDown(input, { key: "Escape" });
  });
  expect(rename).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("offers no rename on dropdowns that do not ask for it", () => {
  renderDropdown();
  expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
});
