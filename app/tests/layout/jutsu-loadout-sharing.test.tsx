import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { JutsuLoadoutSharingDialog } from "@/layout/JutsuLoadoutSharing";
import { exportJutsuLoadout } from "@/libs/loadout";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

type Props = ComponentProps<typeof JutsuLoadoutSharingDialog>;
const preview = {
  token: "a".repeat(64),
  jutsuIds: ["strike"],
  entries: [
    {
      jutsuId: "strike",
      name: "Swift strike",
      accepted: true,
      reason: null,
      message: "Ready to import",
    },
  ],
};

/** Render the real dialog with controlled server outcomes for draft, replacement and focus tests. */
const setup = (overrides: Partial<Props> = {}) => {
  const props = {
    loadouts: [{ id: "one", name: "My name", jutsuIds: ["old"] }],
    activeId: "one",
    onPreview: vi.fn(async () => ({ success: true as const, preview })),
    onReplace: vi.fn(async () => ({ success: true, message: "Replaced" })),
    onImported: vi.fn(async () => {}),
    ...overrides,
  };
  const view = render(<JutsuLoadoutSharingDialog {...props} />);
  /** Reach the preview step without confirming a replacement. */
  const pasteAndPreview = async () => {
    fireEvent.click(view.getByRole("button", { name: "Import" }));
    fireEvent.change(view.getByLabelText("Loadout text"), {
      target: { value: exportJutsuLoadout(["strike"]) },
    });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(view.getByText("Swift strike")).toBeDefined());
  };
  return { view, props, pasteAndPreview };
};

beforeEach(() => {
  installBrowserGlobals();
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("jutsu loadout sharing dialogs", () => {
  it.each(["Export", "Import"])(
    "returns focus to the %s opener after cancellation",
    async (mode) => {
      const { view } = setup();
      const opener = view.getByRole("button", { name: mode });
      opener.focus();
      fireEvent.click(opener);
      await waitFor(() =>
        expect(view.getByRole("dialog").contains(document.activeElement)).toBe(true),
      );
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    },
  );

  it("supports a single slot and cancellation after preview never replaces it", async () => {
    const { view, props, pasteAndPreview } = setup();
    await pasteAndPreview();
    expect(props.onReplace).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(props.onReplace).not.toHaveBeenCalled();
    expect(props.onImported).not.toHaveBeenCalled();
  });

  it("requires explicit replacement and refreshes data on success", async () => {
    const { view, props, pasteAndPreview } = setup();
    await pasteAndPreview();
    fireEvent.click(view.getByRole("button", { name: "Replace loadout" }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1));
    expect(props.onReplace).toHaveBeenCalledWith({
      loadoutId: "one",
      text: exportJutsuLoadout(["strike"]),
      previewToken: preview.token,
    });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Import" })),
    );
  });

  it("keeps selectable text when clipboard access fails", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("Denied");
        }),
      },
    });
    try {
      const { view } = setup();
      fireEvent.click(view.getByRole("button", { name: "Export" }));
      fireEvent.click(view.getByRole("button", { name: "Copy" }));
      await waitFor(() =>
        expect(view.getByRole("status").textContent).toContain("copy it manually"),
      );
      const area = view.getByLabelText("Loadout text") as HTMLTextAreaElement;
      expect(area.readOnly).toBe(true);
      expect(area.value).toBe(exportJutsuLoadout(["old"]));
      expect(area.selectionStart).toBe(0);
      expect(area.selectionEnd).toBe(area.value.length);
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("sends one preview for a same-tick double activation and keeps the dialog open until it settles", async () => {
    let settle: (value: Awaited<ReturnType<Props["onPreview"]>>) => void = () =>
      undefined;
    const onPreview = vi.fn<Props["onPreview"]>(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { view } = setup({ onPreview });
    fireEvent.click(view.getByRole("button", { name: "Import" }));
    fireEvent.change(view.getByLabelText("Loadout text"), {
      target: { value: exportJutsuLoadout(["strike"]) },
    });
    const previewButton = view.getByRole("button", { name: "Preview" });
    // Both activations land before React re-renders the disabled button.
    act(() => {
      fireEvent.click(previewButton);
      fireEvent.click(previewButton);
    });
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(
      (view.getByRole("button", { name: "Please wait…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(view.getByRole("dialog")).toBeDefined();
    settle({ success: true, preview });
    await waitFor(() => expect(view.getByText("Swift strike")).toBeDefined());
    expect(
      (view.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows recoverable mutation errors, clears pending state and requires another preview", async () => {
    const onReplace = vi.fn(async () => ({
      success: false,
      message: "Loadout changed. Preview again.",
    }));
    const { view, props, pasteAndPreview } = setup({ onReplace });
    await pasteAndPreview();
    fireEvent.click(view.getByRole("button", { name: "Replace loadout" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Preview again"),
    );
    expect(
      (view.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (view.getByRole("button", { name: "Replace loadout" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(props.onImported).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Replace loadout" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("recovers from a failed preview and invalidates a preview after editing text", async () => {
    const onPreview = vi
      .fn<Props["onPreview"]>()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValue({ success: true, preview });
    const { view } = setup({ onPreview });
    fireEvent.click(view.getByRole("button", { name: "Import" }));
    fireEvent.change(view.getByLabelText("Loadout text"), {
      target: { value: "pasted" },
    });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Connection lost"),
    );
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(view.getByText("Swift strike")).toBeDefined());
    fireEvent.change(view.getByLabelText("Loadout text"), {
      target: { value: "changed" },
    });
    expect(view.queryByText("Swift strike")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Replace loadout" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables replacement for an empty usable result", async () => {
    const { view } = setup({
      onPreview: async () => ({
        success: true,
        preview: { ...preview, entries: [], jutsuIds: [] },
      }),
    });
    fireEvent.click(view.getByRole("button", { name: "Import" }));
    fireEvent.change(view.getByLabelText("Loadout text"), {
      target: { value: "pasted" },
    });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(
        view.getByText("No usable jutsu. The destination will stay unchanged."),
      ).toBeDefined(),
    );
    expect(
      (view.getByRole("button", { name: "Replace loadout" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
