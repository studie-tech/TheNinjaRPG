import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { AdjustSeichiSilver } from "@/layout/publicUser/AdjustSeichiSilver";
import * as toast from "@/libs/toast";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let adjust: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  adjust = vi.fn(() => ({ success: false, message: "Insufficient Seichi Silver" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = () => {
  const trpcClient = fakeTrpcClient(async (path, input) => {
    if (path === "profile.getSeichiSilverForStaff") return 12;
    if (path === "profile.adjustSeichiSilver") return adjust(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  const view = render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <AdjustSeichiSilver userId="player" username="Player" />
    </TrpcTestProviders>,
  );
  fireEvent.click(view.getByRole("button", { name: "Adjust Seichi Silver" }));
  return view;
};

const fill = async (view: ReturnType<typeof mount>) => {
  const dialog = await view.findByRole("dialog", { name: "Adjust Seichi Silver" });
  fireEvent.input(within(dialog).getByLabelText("Amount (+/-)"), {
    target: { value: "-5" },
  });
  fireEvent.change(within(dialog).getByLabelText("Reason *"), {
    target: { value: "Refund for a duplicated purchase" },
  });
  return dialog;
};

it("keeps a rejected adjustment open with the entered amount and reason", async () => {
  const view = mount();
  const dialog = await fill(view);
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(adjust).toHaveBeenCalledWith({
      userId: "player",
      delta: -5,
      reason: "Refund for a duplicated purchase",
    }),
  );
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    ),
  );
  expect(view.getByRole("dialog", { name: "Adjust Seichi Silver" })).toBe(dialog);
  expect(
    (within(dialog).getByLabelText("Amount (+/-)") as HTMLInputElement).value,
  ).toBe("-5");
  expect((within(dialog).getByLabelText("Reason *") as HTMLInputElement).value).toBe(
    "Refund for a duplicated purchase",
  );
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("blocks dismissal while the adjustment is saving", async () => {
  const pending = deferred<{ success: boolean; message: string }>();
  adjust.mockImplementation(() => pending.promise);
  const view = mount();
  const dialog = await fill(view);
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  const saving = await within(dialog).findByRole("button", { name: "Saving" });
  expect((saving as HTMLButtonElement).disabled).toBe(true);
  for (const close of within(dialog).getAllByRole("button", { name: "Close" }))
    expect((close as HTMLButtonElement).disabled).toBe(true);
  pending.resolve({ success: true, message: "Adjusted" });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});
