import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as controller from "@/hooks/useSharedCooldowns";
import { SharedCooldownForm } from "@/layout/SharedCooldownForm";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const save = vi.fn();
const remove = vi.fn();
const refetch = vi.fn();
let loading = false;
let failed = false;
let pending = false;

beforeEach(() => {
  installBrowserGlobals();
  loading = failed = pending = false;
  vi.clearAllMocks();
  vi.spyOn(controller, "useSharedCooldowns").mockImplementation(
    () =>
      ({
        query: {
          data: [{ tag: "clear", rounds: 3 }],
          isPending: loading,
          isError: failed,
          refetch,
        },
        save: { mutate: save, isPending: pending },
        remove: { mutate: remove, isPending: false },
      }) as unknown as ReturnType<typeof controller.useSharedCooldowns>,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("shared cooldown form", () => {
  it("shows loading and offers recovery when loading fails", () => {
    loading = true;
    const view = render(<SharedCooldownForm />);
    expect(view.getByText("Loading shared cooldowns")).toBeDefined();
    loading = false;
    failed = true;
    view.rerender(<SharedCooldownForm />);
    expect(view.getByRole("alert").textContent).toContain("Could not load");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("edits a saved duration, displays rejection and clears pending controls", async () => {
    const view = render(<SharedCooldownForm />);
    const editor = view.getByRole("form", { name: "Shared cooldown editor" });
    const scrollIntoView = vi.fn();
    editor.scrollIntoView = scrollIntoView;
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(editor);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    fireEvent.input(view.getByRole("spinbutton", { name: "GCD rounds" }), {
      target: { value: "5" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save Tag" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({ tag: "clear", rounds: 5 });
    pending = true;
    view.rerender(<SharedCooldownForm />);
    expect(
      (view.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled,
    ).toBe(true);
    pending = false;
    await act(() =>
      save.mock.calls[0]?.[1].onSuccess({ success: false, message: "Not allowed" }),
    );
    view.rerender(<SharedCooldownForm />);
    expect(view.getByRole("status").textContent).toBe("Not allowed");
    expect(
      (view.getByRole("button", { name: "Save Tag" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("removes a configured tag and shows mutation errors", async () => {
    const view = render(<SharedCooldownForm />);
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    expect(remove.mock.calls[0]?.[0]).toEqual({ tag: "clear" });
    await act(() => remove.mock.calls[0]?.[1].onError(new Error("Connection failed")));
    expect(view.getByRole("status").textContent).toBe("Connection failed");
  });
});
