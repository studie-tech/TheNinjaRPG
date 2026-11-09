import * as useSize from "@radix-ui/react-use-size";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as controller from "@/hooks/useJutsuEquipLimits";
import { JutsuEquipLimitsForm } from "@/layout/JutsuEquipLimitsForm";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const save = vi.fn();
const remove = vi.fn();
const refetch = vi.fn();
let loading = false;
let failed = false;
let pending = false;

beforeEach(() => {
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  installBrowserGlobals();
  loading = failed = pending = false;
  vi.clearAllMocks();
  vi.spyOn(controller, "useJutsuEquipLimits").mockImplementation(
    () =>
      ({
        query: {
          data: [{ category: "clear", unrankedMaxEquipped: 3, rankedMaxEquipped: 0 }],
          isPending: loading,
          isError: failed,
          refetch,
        },
        save: { mutate: save, isPending: pending },
        remove: { mutate: remove, isPending: false },
      }) as unknown as ReturnType<typeof controller.useJutsuEquipLimits>,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("jutsu equip limits form", () => {
  it("shows loading and offers recovery when loading fails", () => {
    loading = true;
    const view = render(<JutsuEquipLimitsForm />);
    expect(view.getByText("Loading equip limits")).toBeDefined();
    loading = false;
    failed = true;
    view.rerender(<JutsuEquipLimitsForm />);
    expect(view.getByRole("alert").textContent).toContain("Could not load");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("edits a saved duration, displays rejection and clears pending controls", async () => {
    const view = render(<JutsuEquipLimitsForm />);
    const editor = view.getByRole("form", { name: "Jutsu equip limit editor" });
    const scrollIntoView = vi.fn();
    editor.scrollIntoView = scrollIntoView;
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(editor);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    fireEvent.input(view.getByRole("spinbutton", { name: "Unranked limit" }), {
      target: { value: "5" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save Limits" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({
      category: "clear",
      unrankedMaxEquipped: 5,
      rankedMaxEquipped: 0,
    });
    pending = true;
    view.rerender(<JutsuEquipLimitsForm />);
    expect(
      (view.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled,
    ).toBe(true);
    pending = false;
    await act(() =>
      save.mock.calls[0]?.[1].onSuccess({ success: false, message: "Not allowed" }),
    );
    view.rerender(<JutsuEquipLimitsForm />);
    expect(view.getByRole("status").textContent).toBe("Not allowed");
    expect(
      (view.getByRole("button", { name: "Save Limits" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("removes a configured tag and shows mutation errors", async () => {
    const view = render(<JutsuEquipLimitsForm />);
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    expect(remove.mock.calls[0]?.[0]).toEqual({ category: "clear" });
    await act(() => remove.mock.calls[0]?.[1].onError(new Error("Connection failed")));
    expect(view.getByRole("status").textContent).toBe("Connection failed");
  });
});
