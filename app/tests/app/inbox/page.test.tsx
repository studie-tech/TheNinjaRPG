import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import Inbox from "@/app/[shell]/inbox/page";
import { clearInboxNotifications } from "@/deltas/chat";
import * as newConversation from "@/layout/NewConversationPrompt";
import * as blacklist from "@/layout/UserBlacklistControl";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

const updateNotifications = vi.fn();
const inboxNews = { href: "/inbox", name: "2 messages", notificationCount: 2 };
const otherNews = { href: "/hospital", name: "Hospitalized", notificationCount: 1 };

beforeEach(() => {
  installBrowserGlobals();
  updateNotifications.mockReset();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    comments: {
      // The listing resets the server's inbox counter whenever it loads.
      getUserConversations: {
        useQuery: () => ({
          data: [],
          refetch: vi.fn(),
          isPending: false,
          // Read after the inbox news arrived, so the server counter is already reset.
          dataUpdatedAt: Number.MAX_SAFE_INTEGER,
        }),
      },
      exitConversation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  mockUserContextValue({
    data: { userId: "reader" },
    notifications: [inboxNews, otherNews],
    updateNotifications,
  });
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace: vi.fn() } as never);
  vi.spyOn(newConversation, "NewConversationPrompt").mockImplementation(() => null);
  vi.spyOn(blacklist, "UserBlacklistPopover").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("clears the inbox notification once the conversation list loads", async () => {
  render(<Inbox />);
  await waitFor(() =>
    expect(updateNotifications).toHaveBeenCalledWith(clearInboxNotifications),
  );
});
