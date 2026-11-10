import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import ManualQuestBalance from "@/app/[shell]/manual/quest/balance/page";
import * as ContentBox from "@/layout/ContentBox";
import * as QuestRewardBalanceFiltering from "@/layout/QuestRewardBalanceFiltering";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
  localStorage.clear();
  vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ));
  vi.spyOn(QuestRewardBalanceFiltering, "default").mockImplementation(() => null);
  Object.assign(vi.spyOn(client, "api" as never), {
    data: {
      getQuestRewardStatistics: { useQuery: () => ({ data: [], isPending: true }) },
    },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("opens the rewards tab when the URL fragment names no tab", () => {
  window.history.replaceState({}, "", "/manual/quest/balance#unknown");
  const view = render(<ManualQuestBalance />);
  expect(view.getByRole("heading", { name: "Quest Balance" })).toBeDefined();
});
