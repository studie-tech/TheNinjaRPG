import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import CannedResponsesManagement from "@/layout/CannedResponsesManagement";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let create: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  create = vi.fn(() => ({
    success: false,
    message: "You are not allowed to create canned responses",
  }));
  Object.assign(vi.spyOn(client, "api" as never), {
    support: testApi.support,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { userId: "staff", role: "MODERATOR" } }) as never,
  );
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
    if (path === "support.getCannedResponses") return [];
    if (path === "support.createCannedResponse") return create(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <CannedResponsesManagement isOpen setIsOpen={() => undefined} />
    </TrpcTestProviders>,
  );
};

it("keeps the editor and its draft open when the server rejects a new response", async () => {
  const view = mount();
  fireEvent.click(await view.findByRole("button", { name: "Add Response" }));
  const title = (await view.findByPlaceholderText(
    "Enter response title",
  )) as HTMLInputElement;
  const body = view.getByPlaceholderText(
    "Enter response content",
  ) as HTMLTextAreaElement;
  fireEvent.change(title, { target: { value: "Refund policy" } });
  fireEvent.change(body, { target: { value: "Refunds are handled by staff." } });
  fireEvent.click(view.getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      title: "Refund policy",
      description: "Refunds are handled by staff.",
    }),
  );
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    ),
  );
  expect(view.getByRole("dialog", { name: "Create Canned Response" })).toBeTruthy();
  expect(
    (view.getByPlaceholderText("Enter response title") as HTMLInputElement).value,
  ).toBe("Refund policy");
  expect(
    (view.getByPlaceholderText("Enter response content") as HTMLTextAreaElement).value,
  ).toBe("Refunds are handled by staff.");
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
});
