import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import { ResetPetImageGeneration } from "@/layout/publicUser/ResetPetImageGeneration";
import { StaffPetPotential } from "@/layout/StaffPetPotential";
import * as toast from "@/libs/toast";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let reset: ReturnType<typeof vi.fn>;
let setPotential: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  setPotential = vi.fn(() => ({
    success: false,
    message: "Please retry this override.",
  }));
  reset = vi.fn((_input: RouterInputs["profile"]["resetPetImageGeneration"]) => ({
    success: false,
    message: "Generation is still running.",
  }));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Render the real staff dialog with a scoped tRPC link and controllable server outcomes. */
const mount = (potential = false) => {
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    pets: testApi.pets,
    useUtils: testApi.useUtils,
  });
  const trpcClient = fakeTrpcClient(async (path, input) => {
    if (path === "profile.getPetImageGenerationForStaff")
      return [
        {
          id: "first-pet",
          name: "Miso",
          generationAttempts: 2,
          generationStatus: "FAILED",
        },
        {
          id: "second-pet",
          name: "Tama",
          generationAttempts: 1,
          generationStatus: "FAILED",
        },
      ];
    if (path === "pets.getPotentialsForStaff")
      return [
        { id: "first-pet", name: "Miso", potentialValue: 3, potentialRevealed: true },
      ];
    if (path === "pets.setPotentialForStaff") return setPotential(input);
    if (path === "profile.resetPetImageGeneration") return reset(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {potential ? (
        <StaffPetPotential userId="player" username="Player" />
      ) : (
        <ResetPetImageGeneration userId="player" username="Player" />
      )}
    </TrpcTestProviders>,
  );
};

it("selects another companion with Enter and resets only that companion after confirmation", async () => {
  const view = mount();
  fireEvent.click(
    view.getByRole("button", { name: "Reset companion image attempts for Player" }),
  );
  const dialog = await view.findByRole("dialog", {
    name: "Reset companion image attempts",
  });
  const trigger = await within(dialog).findByRole("combobox", { name: "Companion" });
  fireEvent.click(trigger);
  fireEvent.click(
    await view.findByRole("option", { name: "Miso · 2/3 attempts used" }),
  );
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason *" }), {
    target: { value: " Image creation failed repeatedly " },
  });
  expect(
    within(dialog)
      .getByRole("button", { name: "Reset attempts" })
      .hasAttribute("disabled"),
  ).toBe(false);

  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = await view.findByRole("option", { name: "Miso · 2/3 attempts used" });
  await waitFor(() => expect(document.activeElement === first).toBe(true));
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const chosen = view.getByRole("option", { name: "Tama · 1/3 attempts used" });
  await waitFor(() => expect(document.activeElement === chosen).toBe(true));
  await act(async () => {
    fireEvent.keyDown(chosen, { key: "Enter" });
  });
  expect(reset).not.toHaveBeenCalled();
  expect(
    view.getByRole("dialog", { name: "Reset companion image attempts" }) === dialog,
  ).toBe(true);
  expect(trigger.textContent).toContain("Tama");

  fireEvent.click(within(dialog).getByRole("button", { name: "Reset attempts" }));
  await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  expect(reset).toHaveBeenCalledWith({
    userId: "player",
    petId: "second-pet",
    reason: "Image creation failed repeatedly",
  });
  expect(await within(dialog).findByRole("alert")).toHaveProperty(
    "textContent",
    "Generation is still running.",
  );
});

it.each(["Escape", "Close"])(
  "returns focus to the staff action after %s",
  async (dismiss) => {
    const view = mount();
    const opener = view.getByRole("button", {
      name: "Reset companion image attempts for Player",
    });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = await view.findByRole("dialog", {
      name: "Reset companion image attempts",
    });
    const reason = within(dialog).getByRole("textbox", { name: "Reason *" });
    act(() => reason.focus());
    if (dismiss === "Escape") fireEvent.keyDown(reason, { key: "Escape" });
    else fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() =>
      expect(
        view.queryByRole("dialog", { name: "Reset companion image attempts" }),
      ).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement === opener).toBe(true));
    expect(reset).not.toHaveBeenCalled();
  },
);

it("shows a failed request in the staff dialog and preserves the inputs for retry", async () => {
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  reset.mockRejectedValueOnce(new TRPCClientError("Failed to fetch"));
  const view = mount();
  fireEvent.click(
    view.getByRole("button", { name: "Reset companion image attempts for Player" }),
  );
  const dialog = await view.findByRole("dialog", {
    name: "Reset companion image attempts",
  });
  const trigger = await within(dialog).findByRole("combobox", { name: "Companion" });
  fireEvent.click(trigger);
  fireEvent.click(
    await view.findByRole("option", { name: "Miso · 2/3 attempts used" }),
  );
  const reason = within(dialog).getByRole("textbox", { name: "Reason *" });
  fireEvent.change(reason, { target: { value: "Image creation failed repeatedly" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset attempts" }));

  expect(await within(dialog).findByRole("alert")).toHaveProperty(
    "textContent",
    "Failed to fetch",
  );
  expect(trigger.textContent).toContain("Miso");
  expect(reason).toHaveProperty("value", "Image creation failed repeatedly");
  await waitFor(() =>
    expect(
      within(dialog)
        .getByRole("button", { name: "Reset attempts" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(
    view.getByRole("dialog", { name: "Reset companion image attempts" }) === dialog,
  ).toBe(true);

  reset.mockReturnValue({ success: true, message: "Companion image attempts reset." });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset attempts" }));
  await waitFor(() =>
    expect(
      view.queryByRole("dialog", { name: "Reset companion image attempts" }),
    ).toBeNull(),
  );
  expect(reset).toHaveBeenCalledWith({
    userId: "player",
    petId: "first-pet",
    reason: "Image creation failed repeatedly",
  });
});

it.each(["Companion", "Potential"])(
  "keeps native %s Enter from submitting an override",
  async (label) => {
    const view = mount(true);
    fireEvent.click(view.getByRole("button", { name: "Edit companion potential" }));
    const dialog = await view.findByRole("dialog", {
      name: "Companion potential · Player",
    });
    const companion = await within(dialog).findByRole("combobox", {
      name: "Companion",
    });
    fireEvent.change(companion, { target: { value: "first-pet" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Potential" }), {
      target: { value: "4" },
    });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Investigated companion caps" },
    });
    const select = within(dialog).getByRole("combobox", { name: label });
    act(() => select.focus());
    expect(select.tagName).toBe("SELECT");
    expect(fireEvent.keyDown(select, { key: "Enter" })).toBe(true);
    await act(async () => undefined);
    expect(setPotential).not.toHaveBeenCalled();
    expect(view.getByRole("dialog") === dialog).toBe(true);
    expect(within(dialog).getByRole("combobox", { name: "Potential" })).toHaveProperty(
      "value",
      "4",
    );
  },
);

it("keeps Enter in an override reason from saving and preserves multiline reasons for explicit Save", async () => {
  const view = mount(true);
  fireEvent.click(view.getByRole("button", { name: "Edit companion potential" }));
  const dialog = await view.findByRole("dialog", {
    name: "Companion potential · Player",
  });
  const companion = await within(dialog).findByRole("combobox", { name: "Companion" });
  fireEvent.change(companion, { target: { value: "first-pet" } });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Potential" }), {
    target: { value: "4" },
  });
  const reason = within(dialog).getByRole("textbox", {
    name: "Reason (at least 10 characters)",
  });
  fireEvent.change(reason, { target: { value: "Investigated companion caps" } });
  act(() => reason.focus());
  expect(fireEvent.keyDown(reason, { key: "Enter" })).toBe(true);
  expect(setPotential).not.toHaveBeenCalled();
  expect(view.getByRole("dialog") === dialog).toBe(true);
  fireEvent.change(reason, {
    target: { value: "Investigated companion caps\nApproved correction" },
  });
  const save = within(dialog).getByRole("button", { name: "Save potential" });
  act(() => save.focus());
  expect(fireEvent.keyDown(save, { key: "Enter" })).toBe(true);
  expect(setPotential).not.toHaveBeenCalled();
  // Happy DOM does not synthesize the native button click produced by Enter.
  fireEvent.click(save, { detail: 0 });
  await waitFor(() => expect(setPotential).toHaveBeenCalledTimes(1));
  expect(setPotential).toHaveBeenCalledWith({
    userId: "player",
    petId: "first-pet",
    value: 4,
    reason: "Investigated companion caps\nApproved correction",
  });
  expect(await within(dialog).findByRole("alert")).toHaveProperty(
    "textContent",
    "Please retry this override.",
  );
  expect(reason).toHaveProperty(
    "value",
    "Investigated companion caps\nApproved correction",
  );
});

it.each([0, 1])(
  "keeps Close button %s keyboard activation separate from saving an override",
  async (index) => {
    const view = mount(true);
    const opener = view.getByRole("button", { name: "Edit companion potential" });
    fireEvent.click(opener);
    const dialog = await view.findByRole("dialog", {
      name: "Companion potential · Player",
    });
    const companion = await within(dialog).findByRole("combobox", {
      name: "Companion",
    });
    fireEvent.change(companion, { target: { value: "first-pet" } });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Investigated companion caps" },
    });
    const close = within(dialog).getAllByRole("button", { name: "Close" })[index]!;
    act(() => close.focus());
    expect(fireEvent.keyDown(close, { key: "Enter" })).toBe(true);
    expect(setPotential).not.toHaveBeenCalled();
    // Happy DOM does not synthesize the native button click produced by Enter.
    fireEvent.click(close, { detail: 0 });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement === opener).toBe(true));
    expect(setPotential).not.toHaveBeenCalled();
  },
);
