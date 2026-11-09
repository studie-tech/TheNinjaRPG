import * as useSize from "@radix-ui/react-use-size";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { WarRulesForm } from "@/layout/WarRulesForm";
import * as toast from "@/libs/toast";
import { defaultWarRules, type WarRules } from "@/validators/war";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

let rules: WarRules | undefined;
let isPending: boolean;
const save = vi.fn();
const refetch = vi.fn();
let onSuccess: (
  result: { success: boolean; message: string },
  values: WarRules,
) => void;

beforeEach(() => {
  installBrowserGlobals();
  rules = undefined;
  isPending = true;
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ war: { getRules: { invalidate: vi.fn() } } }),
    war: {
      getRules: {
        useQuery: () => ({ data: rules, isPending, isFetching: false, refetch }),
      },
      setRules: {
        useMutation: (options: { onSuccess: typeof onSuccess }) => {
          onSuccess = options.onSuccess;
          return { mutate: save, isPending: false };
        },
      },
    },
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("village war settings", () => {
  it("waits for saved rules and offers retry after a failed load", () => {
    const view = render(<WarRulesForm />);
    expect(view.getByText("Loading village war settings")).toBeDefined();
    expect(view.queryByRole("button", { name: "Save war settings" })).toBeNull();

    isPending = false;
    view.rerender(<WarRulesForm />);
    expect(view.getByRole("alert").textContent).toContain("Could not load");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    rules = { ...defaultWarRules, enabled: true };
    view.rerender(<WarRulesForm />);
    expect(
      view
        .getByRole("checkbox", { name: "Enable objective village wars" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("retains edited fields on refetch and saves them with refreshed untouched rules", async () => {
    rules = { ...defaultWarRules, enabled: true };
    isPending = false;
    const view = render(<WarRulesForm />);
    const townhall = view.getByRole("spinbutton", {
      name: "Town hall HP",
    }) as HTMLInputElement;
    fireEvent.input(townhall, { target: { value: "12345" } });

    rules = { ...rules, townhallHp: 9000, declarationCost: 600000 };
    view.rerender(<WarRulesForm />);
    expect(townhall.value).toBe("12345");
    expect(
      (
        view.getByRole("spinbutton", {
          name: "Declaration cost (tokens)",
        }) as HTMLInputElement
      ).value,
    ).toBe("600000");

    fireEvent.click(view.getByRole("button", { name: "Save war settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = { ...rules, townhallHp: 12345 };
    expect(save).toHaveBeenCalledWith(saved);
    await act(() => onSuccess({ success: true, message: "Saved" }, saved));
    expect(view.getByRole("status").textContent).toBe("Saved");
    expect(
      (view.getByRole("button", { name: "Save war settings" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("enables saving changed numeric and checkbox fields and disables it when reverted", () => {
    rules = { ...defaultWarRules, enabled: true };
    isPending = false;
    const view = render(<WarRulesForm />);
    const button = view.getByRole("button", {
      name: "Save war settings",
    }) as HTMLButtonElement;
    const notice = view.getByRole("spinbutton", { name: "Notice period (hours)" });
    const enabled = view.getByRole("checkbox", {
      name: "Enable objective village wars",
    });

    expect(button.disabled).toBe(true);
    fireEvent.input(notice, { target: { value: String(rules.noticeHours + 1) } });
    expect(button.disabled).toBe(false);
    fireEvent.input(notice, { target: { value: String(rules.noticeHours) } });
    expect(button.disabled).toBe(true);
    fireEvent.click(enabled);
    expect(button.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(button.disabled).toBe(true);
  });
});
