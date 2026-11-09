import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { SkillTreeFolder } from "@/drizzle/schema";
import * as image from "@/layout/Image";
import SkillTreeFolderGrid from "@/layout/SkillTreeFolderGrid";
import { actualImage } from "../setup/preload";

// Other suites replace the layout Image module; this one renders the real wrapper.
beforeEach(() => {
  vi.spyOn(image, "default").mockImplementation(actualImage);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("serves legacy UploadThing folder art through the CDN host", () => {
  const folder = {
    id: "taijutsu",
    name: "Taijutsu",
    image: "https://utfs.io/f/folder-key.webp",
  } as SkillTreeFolder;
  const view = render(
    <SkillTreeFolderGrid
      folders={[folder]}
      folderStats={[
        {
          folderId: "taijutsu",
          folderName: "Taijutsu",
          folderImage: folder.image ?? "",
          totalSkills: 4,
          ownedSkills: 1,
        },
      ]}
      allSkills={[]}
      onFolderClick={() => undefined}
      selectedEffects={[]}
      onEffectsChange={() => undefined}
    />,
  );
  const image = view.getByAltText("Taijutsu") as HTMLImageElement;
  expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(
    "https://uploadthing.b-cdn.net/f/folder-key.webp",
  );
  expect(view.getByText("1/4 skills")).toBeTruthy();
});
