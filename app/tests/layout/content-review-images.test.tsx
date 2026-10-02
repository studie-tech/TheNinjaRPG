import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentReviewDetail } from "@/layout/ContentReviewDetail";
import { sceneAssetIds } from "@/libs/contentReview/paths";

const state: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  applied: Record<string, unknown> | null;
} = { before: {}, after: {}, applied: null };

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
            canReview: false,
            category: "VISUAL",
            title: "Update scene",
            rationale: "Show the cast",
            createdAt: new Date().toISOString(),
            statusChangedAt: new Date().toISOString(),
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
              payload: null,
              media: [],
              ...state,
            }],
          },
        }),
      },
      approve: { useMutation: () => ({ isPending: false }) },
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
  beforeEach(() => {
    state.before = {};
    state.after = {};
    state.applied = null;
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
});
