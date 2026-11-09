import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import EmailReminderPage from "@/app/[shell]/emailsettings/page";
import * as ContentBox from "@/layout/ContentBox";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const remove = vi.fn();

beforeEach(() => {
  installBrowserGlobals();
  remove.mockClear();
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams({ email: "ninja@example.com", secret: "s3cret" }) as never,
  );
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    misc: {
      getEmailReminder: {
        useQuery: () => ({
          data: { disabled: false, createdAt: new Date(), latestRejoinRequest: null },
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      toggleEmailReminder: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      deleteEmailReminder: {
        useMutation: () => ({ mutate: remove, isPending: false }),
      },
    },
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("deletes the reminder only after the deletion is confirmed", async () => {
  const view = render(<EmailReminderPage />);
  fireEvent.click(view.getAllByRole("button", { name: "Delete" })[0]!);
  const prompt = await view.findByText(
    /Are you sure you want to delete this email reminder\?/,
  );
  const dialog = prompt.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')!;
  expect(dialog).not.toBeNull();
  expect(remove).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  });
  expect(remove).toHaveBeenCalledWith({ email: "ninja@example.com", secret: "s3cret" });
});
