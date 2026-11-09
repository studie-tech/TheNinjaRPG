import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SkillTree, SkillTreeFolder } from "@/drizzle/schema";
import * as Modal from "@/layout/Modal";
import { SkillTreeFolderModal } from "@/layout/SkillTreeFolderModal";

beforeEach(() => {
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, title, proceed_label, onAccept, children }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {proceed_label && (
            <button type="button" onClick={onAccept}>
              {proceed_label}
            </button>
          )}
          <span data-testid="accept">{onAccept ? "accept" : "none"}</span>
          {children}
        </div>
      ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const folder = (id: string, name: string) =>
  ({
    id,
    name,
    image: null,
    description: null,
    hidden: false,
  }) as unknown as SkillTreeFolder;
const skill = (
  id: string,
  tier: number,
  cost: number,
  requiredSkillIds: string[] = [],
  folderId = "f1",
) =>
  ({
    id,
    name: `Skill ${id}`,
    image: "https://example.com/skill.png",
    description: `About ${id}`,
    tier,
    costSkillPoints: cost,
    requiredSkillIds,
    folderId,
    hidden: false,
    skillType: "NORMAL",
    effects: [],
  }) as unknown as SkillTree;

const folders = [folder("f1", "Body"), folder("f2", "Mind")];
const skills = [
  skill("A", 1, 1),
  skill("B", 1, 2, ["A"]),
  skill("C", 2, 1, ["X"]),
  skill("D", 2, 99, ["A"]),
  skill("X", 1, 1, [], "f2"),
];

const mount = (onPurchaseSkill = vi.fn()) =>
  render(
    <SkillTreeFolderModal
      isOpen
      setIsOpen={vi.fn()}
      folder={folders[0]!}
      folders={folders}
      allSkills={skills}
      userSkills={[{ skillId: "A", skill: skills[0]! } as never]}
      activatedSkillIds={["A"]}
      userSkillPoints={5}
      onPurchaseSkill={onPurchaseSkill}
      onNavigateToFolder={vi.fn()}
      selectedEffects={[]}
    />,
  );

describe("skill tree folder modal", () => {
  it("labels each skill card by its status", () => {
    const view = mount();
    expect(
      view.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Skill A, Tier 1, Active",
      "Skill B, Tier 1, Available",
      "Skill C, Tier 2, Prerequisites required",
      "Skill D, Tier 2, Unavailable",
    ]);
    expect(view.getByTestId("accept").textContent).toBe("none");
  });

  it("offers a purchase only for an affordable skill with its prerequisites", () => {
    const purchase = vi.fn();
    const view = mount(purchase);
    fireEvent.click(view.getByRole("button", { name: "Skill B, Tier 1, Available" }));
    expect(view.getByRole("dialog").getAttribute("aria-label")).toBe("Skill B");
    fireEvent.click(view.getByRole("button", { name: "Purchase for 2 SP" }));
    expect(purchase).toHaveBeenCalledWith("B");
    expect(view.getByRole("dialog").getAttribute("aria-label")).toBe("Body");
  });

  it("explains missing prerequisites and links a prerequisite in another folder", () => {
    const view = mount();
    fireEvent.click(
      view.getByRole("button", { name: "Skill C, Tier 2, Prerequisites required" }),
    );
    expect(view.queryByRole("button", { name: /Purchase for/ })).toBeNull();
    expect(view.getByTestId("accept").textContent).toBe("none");
    expect(view.getByText("Prerequisites not met")).toBeTruthy();
    expect(view.getByRole("button", { name: "Mind" })).toBeTruthy();
  });

  it("explains missing skill points", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Skill D, Tier 2, Unavailable" }));
    expect(view.queryByRole("button", { name: /Purchase for/ })).toBeNull();
    expect(view.getByText("Not enough skill points (need 99, have 5)")).toBeTruthy();
  });

  it("shows an owned active skill without purchase or blockers", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Skill A, Tier 1, Active" }));
    expect(view.getByText("Activated")).toBeTruthy();
    expect(view.queryByRole("button", { name: /Purchase for/ })).toBeNull();
    expect(view.queryByText("Prerequisites not met")).toBeNull();
  });
});
