import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as tutorial from "@/hooks/tutorial";
import * as questStartCache from "@/hooks/useQuestStartCacheUpdate";
import * as Accordion from "@/layout/Accordion";
import * as ContentBox from "@/layout/ContentBox";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import QuestPicker from "@/layout/QuestPicker";
import { mockUserContextValue } from "../setup/userContext";

const quest = (id: string) => ({
  id,
  name: `Quest ${id}`,
  questType: "story",
  entryRequirements: [],
  content: {},
});

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    quests: {
      specificQuests: {
        useQuery: () => ({ data: [quest("chapter"), quest("lead")] }),
      },
      startQuest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    item: { getAllNames: { useQuery: () => ({ data: undefined }) } },
  });
  vi.spyOn(questStartCache, "useQuestStartCacheUpdate").mockReturnValue({
    prepareQuestStartUpdate: vi.fn(),
    updateQuestStart: vi.fn(),
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({ currentStep: 0 } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
  );
  vi.spyOn(Accordion, "default").mockImplementation((({
    title,
    selectedTitle,
  }: {
    title: string;
    selectedTitle: string;
  }) => (
    <p>
      {title}
      {title === selectedTitle ? " (open)" : ""}
    </p>
  )) as never);
  vi.spyOn(ItemWithEffects, "default").mockImplementation((() => null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens a shown quest when the active quest of that type is filtered out", () => {
  mockUserContextValue({
    data: {
      level: 5,
      sector: 1,
      questData: [],
      userQuests: [
        {
          questId: "lead",
          endAt: null,
          quest: { id: "lead", name: "Quest lead", questType: "story" },
        },
      ],
    },
  });
  render(
    <QuestPicker
      questType="story"
      title="Story"
      filterQuest={(entry) => entry.id !== "lead"}
    />,
  );
  expect(screen.getByText("Quest chapter (open)")).toBeDefined();
  expect(screen.queryByText(/Quest lead/)).toBeNull();
});

it("leaves every quest folded when auto-open is off and none is in progress", () => {
  mockUserContextValue({
    data: { level: 5, sector: 1, questData: [], userQuests: [] },
  });
  render(<QuestPicker questType="story" title="Leads" autoOpenFirst={false} />);
  expect(screen.getByText("Quest chapter")).toBeDefined();
  expect(screen.queryByText(/\(open\)/)).toBeNull();
});

it("shows its loader rather than an empty list while the quests are loading", () => {
  Object.assign(vi.spyOn(client, "api" as never), {
    quests: {
      specificQuests: { useQuery: () => ({ data: undefined }) },
      startQuest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    item: { getAllNames: { useQuery: () => ({ data: undefined }) } },
  });
  mockUserContextValue({
    data: { level: 1, sector: 1, questData: [], userQuests: [] },
  });
  render(
    <QuestPicker
      questType="starter"
      title="Lessons"
      unavailableText="No lessons available right now."
    />,
  );
  expect(screen.queryByText("No lessons available right now.")).toBeNull();
  expect(screen.getByText("Loading...")).toBeDefined();
});
