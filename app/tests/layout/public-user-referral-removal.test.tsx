import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as client from "@/app/_trpc/client";
import { RemoveReferralButton } from "@/layout/publicUser/RecruitedUsersTab";
import * as toast from "@/libs/toast";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

let queryClient: QueryClient;
let remove: ReturnType<typeof vi.fn>;
let onRemoved: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  remove = vi.fn(() => ({ success: false, message: "Recruit has no recruiter" }));
  onRemoved = vi.fn();
  Object.assign(vi.spyOn(client, "api" as never), {
    staff: testApi.staff,
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
    if (path === "staff.deleteReferral") return remove(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <RemoveReferralButton
        recruit={{
          userId: "recruit",
          username: "Recruit",
          rank: "GENIN",
          isOutlaw: false,
          level: 10,
          avatar: null,
        }}
        recruiterId="recruiter"
        recruiterUsername="Recruiter"
        recruiterCount={3}
        onRemoved={onRemoved}
      />
    </TrpcTestProviders>,
  );
};

it("keeps a rejected referral removal retryable without an unconfirmed-outcome warning", async () => {
  const view = mount();
  fireEvent.click(view.getByLabelText("Remove Recruit as a referral"));
  const dialog = await view.findByRole("dialog", {
    name: "Remove referral relationship?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove referral" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith({ userId: "recruit" }));
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    ),
  );
  await waitFor(() =>
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Remove referral",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(dialog.textContent).not.toContain("The previous response was not confirmed");
  expect(onRemoved).not.toHaveBeenCalled();
});
