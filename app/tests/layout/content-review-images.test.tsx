import { cleanup, fireEvent, render as renderInteractive } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { ContentReviewDetail } from "@/layout/ContentReviewDetail";
import { sceneAssetIds } from "@/libs/contentReview/paths";
import { ensureDom } from "../setup-dom.mjs";

const state: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  applied: Record<string, unknown> | null;
  media: ReturnType<typeof sceneCandidate>[];
  payload: Record<string, unknown> | null;
} = { before: {}, after: {}, applied: null, media: [], payload: null };
let canReview = false;
let revision = new Date("2026-10-02T10:00:00.000Z");
const approve = vi.fn();

const sceneCandidate = (id: string, externalId: string | null = null, chosen = false) => ({
  id,
  path: "content.sceneCharacters.0",
  kind: "IMAGE",
  source: externalId ? "CATALOG" : "GENERATED",
  externalId,
  title: id,
  url: externalId ? "https://example.com/new.webp" : `https://example.com/${id}.webp`,
  lengthMs: null,
  chosen,
  currentValue: "old",
});

vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({}),
    contentReview: {
      getProposal: {
        useQuery: () => ({
          isPending: false,
          data: {
            id: "proposal",
            status: "PENDING",
            canReview,
            category: "VISUAL",
            title: "Update scene",
            rationale: "Show the cast",
            createdAt: new Date().toISOString(),
            statusChangedAt: revision,
            targets: [],
            basis: [],
            assets: {
              old: { name: "Old character", image: "https://example.com/old.webp" },
              next: { name: "New character", image: "https://example.com/new.webp" },
              background: { name: "Forest", image: "https://example.com/forest.webp" },
            },
            changes: [{
              id: "change",
              entityType: "QUEST",
              operation: "UPDATE",
              label: "Quest",
              name: "Scene quest",
              ...state,
            }],
          },
        }),
      },
      approve: { useMutation: () => ({ isPending: false, mutate: approve }) },
      reject: { useMutation: () => ({ isPending: false }) },
      revert: { useMutation: () => ({ isPending: false }) },
    },
  },
}));
vi.mock("@/layout/BattlefieldPreview", () => ({ BattlefieldPreview: () => null }));
vi.mock("@/layout/Logbook", () => ({
  QuestDialogScene: ({ background, characters }: { background: string; characters: string[] }) => (
    <div data-scene="true"><img src={background} alt="Background" />{characters.map((image) => <img key={image} src={image} alt="Character" />)}</div>
  ),
}));
vi.mock("@/layout/ItemWithEffects", () => ({ default: () => null }));
vi.mock("@/libs/toast", () => ({ showMutationToast: vi.fn() }));
vi.mock("@/layout/ContentImage", () => ({
  default: ({ image, alt }: { image: string; alt: string }) => (
    <img src={image} alt={alt} />
  ),
}));

const render = () => renderToStaticMarkup(
  <ContentReviewDetail
    id="proposal"
    position={{ index: 0, total: 1 }}
    onMove={vi.fn()}
    onDecided={vi.fn()}
  />,
);

describe("proposal scene images", () => {
  afterEach(cleanup);
  beforeEach(() => {
    ensureDom();
    state.before = {};
    state.after = {};
    state.applied = null;
    state.media = [];
    state.payload = null;
    canReview = false;
    revision = new Date("2026-10-02T10:00:00.000Z");
    approve.mockClear();
  });

  it("shows both character images when a quest scene changes", () => {
    state.before = { content: { sceneCharacters: ["old"] } };
    state.after = { content: { sceneCharacters: ["next"] } };
    const html = render();
    expect(html).toContain('src="https://example.com/old.webp"');
    expect(html).toContain('src="https://example.com/new.webp"');
    expect(html).toContain("Current");
    expect(html).toContain("Proposed");
  });

  it("shows additions and removals in nested objective scenes", () => {
    state.before = { content: { objectives: [{ sceneCharacters: ["old"] }] } };
    state.after = { content: { objectives: [{ sceneCharacters: [], sceneBackground: "background" }] } };
    const html = render();
    expect(html).toContain('src="https://example.com/old.webp"');
    expect(html).toContain('src="https://example.com/forest.webp"');
    expect(html).toContain("No image");
  });

  it("resolves top-level backgrounds and the fields actually applied", () => {
    state.before = { sceneBackground: "old" };
    state.after = { sceneBackground: "next" };
    state.applied = { sceneBackground: "background" };
    const html = render();
    expect(html).toContain('src="https://example.com/forest.webp"');
    expect(html).not.toContain('src="https://example.com/new.webp"');
  });

  it("keeps a readable fallback for missing catalog assets", () => {
    state.after = { content: { sceneCharacters: ["missing-asset"] } };
    const html = render();
    expect(html).toContain("Image unavailable");
    expect(html).toContain("missing-asset");
    expect(html).not.toContain('src="missing-asset"');
  });

  it("previews nested image URLs while keeping unrelated IDs as text", () => {
    state.after = { content: { objectives: [{ image: "https://example.com/image.webp", targetId: "next" }] } };
    const html = render();
    expect(html).toContain('src="https://example.com/image.webp"');
    expect(html).not.toContain('src="https://example.com/new.webp"');
  });

  it("renders the proposed scene below the quest diff", () => {
    state.before = { content: { sceneCharacters: ["old"] } };
    state.after = { content: { sceneBackground: "background", sceneCharacters: ["next"] } };
    const html = render();
    expect(html).toContain("Quest scene");
    expect(html).toContain('data-scene="true"');
  });

  it("collects only nonempty scene references at any nesting level", () => {
    expect(sceneAssetIds({
      content: {
        sceneBackground: "background",
        sceneCharacters: ["old", ""],
        objectives: [{ sceneCharacters: ["next"], targetId: "unrelated" }],
        image: "https://example.com/image.webp",
      },
    })).toEqual(["background", "old", "next"]);
    expect(sceneAssetIds(null)).toEqual([]);
  });

  it("previews the chosen generated character and the current catalog cast", () => {
    canReview = true;
    state.payload = { content: { sceneCharacters: ["old"] } };
    state.after = { content: { sceneCharacters: ["media:first"] } };
    state.media = [sceneCandidate("first"), sceneCandidate("second", null, true)];
    const view = renderInteractive(<ContentReviewDetail id="proposal" position={{ index: 0, total: 1 }} onMove={vi.fn()} onDecided={vi.fn()} />);
    const scene = () => view.container.querySelector('[data-scene="true"]');
    expect(scene()?.innerHTML).toContain("https://example.com/second.webp");
    fireEvent.click(view.getAllByRole("radio")[0]!);
    expect(scene()?.innerHTML).toContain("https://example.com/first.webp");
    fireEvent.click(view.getByRole("button", { name: "Current" }));
    expect(scene()?.innerHTML).toContain("https://example.com/old.webp");
    expect(scene()?.innerHTML).not.toContain("https://example.com/first.webp");
  });

  it("clears media picks, exclusions and approval confirmation on a refined revision", () => {
    canReview = true;
    state.after = { description: "Proposed description", content: { sceneCharacters: ["media:first"] } };
    state.media = [sceneCandidate("first"), sceneCandidate("second")];
    const detail = <ContentReviewDetail id="proposal" position={{ index: 0, total: 1 }} onMove={vi.fn()} onDecided={vi.fn()} />;
    const view = renderInteractive(detail);
    fireEvent.click(view.getByRole("button", { name: /Edit/ }));
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Staff wording" } });
    fireEvent.click(view.getAllByRole("radio")[1]!);
    fireEvent.click(view.getAllByRole("checkbox")[1]!);
    fireEvent.keyDown(document.body, { key: "a" });
    expect(view.getByText("Press A again to apply")).toBeTruthy();

    revision = new Date("2026-10-02T10:01:00.000Z");
    view.rerender(<ContentReviewDetail id="proposal" position={{ index: 0, total: 1 }} onMove={vi.fn()} onDecided={vi.fn()} />);
    expect(view.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);
    expect((view.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
    expect(view.queryByText("Press A again to apply")).toBeNull();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(approve).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ expectedStatusChangedAt: revision.toISOString(), exclude: [], edits: [], media: [] }));
  });
});
