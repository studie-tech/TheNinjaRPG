import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { SkillTreeFolder } from "@/drizzle/schema";
import SkillTreeFolderGrid from "@/layout/SkillTreeFolderGrid";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("serves legacy UploadThing folder art through the CDN host", () => {
  const folder = { id: "taijutsu", name: "Taijutsu", image: "https://utfs.io/f/folder-key.webp" } as SkillTreeFolder;
  const view = render(
    <SkillTreeFolderGrid
      folders={[folder]}
      folderStats={[{ folderId: "taijutsu", folderName: "Taijutsu", folderImage: folder.image ?? "", totalSkills: 4, ownedSkills: 1 }]}
      allSkills={[]}
      onFolderClick={() => undefined}
      selectedEffects={[]}
      onEffectsChange={() => undefined}
    />,
  );
  const image = view.getByAltText("Taijutsu") as HTMLImageElement;
  expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain("https://uploadthing.b-cdn.net/f/folder-key.webp");
  expect(view.getByText("1/4 skills")).toBeTruthy();
});
