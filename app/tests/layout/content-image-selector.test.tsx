import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as elementSize from "@radix-ui/react-use-size";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import type { ComponentProps } from "react";
import { Suspense, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useController } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import ActivityStreakEditPage from "@/app/[shell]/manual/activityStreak/edit/[configid]/page";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import * as EditContent from "@/layout/EditContent";
import { FurnitureViewsEditor } from "@/layout/FurnitureViewsEditor";
import * as Image from "@/layout/Image";
import * as HistoricalAiAvatarModule from "@/layout/HistoricalAiAvatar";
import * as RichInput from "@/layout/RichInput";
import { FURNITURE_IMAGE_PROMPT, furnitureViewPrompt } from "@/libs/imagePrompts";
import * as toast from "@/libs/toast";
import * as uploadthing from "@/utils/uploadthing";
import * as UserContext from "@/utils/UserContext";
import type { ActivityStreakFormType } from "@/validators/activityStreak";
import type { FurnitureViews } from "@/validators/itemFurniture";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

type SelectorProps = ComponentProps<typeof ContentImageSelector.default>;
type GenerationResult = { success: boolean; url?: string; message?: string };
type GenerationOptions = {
  onSuccess: (result: GenerationResult) => Promise<void>;
};
type UploadCallbacks = {
  onUploadBegin: () => void;
  onClientUploadComplete: (
    files: { serverData: { fileUrl?: string; error?: string } }[],
  ) => void;
};
let options: GenerationOptions;
let upload: UploadCallbacks;
let history: ComponentProps<typeof HistoricalAiAvatarModule.HistoricalAiAvatar>;
const requests: {
  input: Record<string, unknown>;
  complete: GenerationOptions["onSuccess"];
}[] = [];
const mutate = vi.fn((input: Record<string, unknown>) => {
  requests.push({ input, complete: options.onSuccess });
});
const invalidate = vi.fn(async () => {});
const onUploadComplete = vi.fn();
const showToast = vi.fn();
const ActualEditContent = EditContent.EditContent;
const original = "https://example.com/original.webp";
const current = "https://example.com/current-90.webp";
const props: SelectorProps = {
  label: "90° image",
  id: "table:furniture:90",
  imageUrl: current,
  referenceImageUrl: original,
  prompt: furnitureViewPrompt("Tea table", 1),
  preprompt: FURNITURE_IMAGE_PROMPT,
  provider: "OPENAI",
  allowImageUpload: true,
  type: "item",
  size: "portrait",
  maxDim: 768,
  onUploadComplete,
};

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  installBrowserGlobals({ animationFrame: true });
  Object.assign(vi.spyOn(client, "api" as never), {
    item: {
      getFurnitureImageGeometry: {
        useQuery: () => ({ data: undefined, isFetching: false }),
      },
    },
    useQueries: () => [0, 1, 2].map(() => ({ data: undefined, isFetching: false })),
    useUtils: () => ({ avatar: { getHistoricalAvatars: { invalidate } } }),
    generativeAi: {
      createImg: {
        useMutation: (next: GenerationOptions) => {
          options = next;
          return { mutate, isPending: false };
        },
      },
    },
  });
  // Isolate application mutation callbacks from image storage, history and rich-editor widgets.
  vi.spyOn(HistoricalAiAvatarModule, "HistoricalAiAvatar").mockImplementation(
    (next) => {
      history = next;
      return null;
    },
  );
  vi.spyOn(Avatar, "default").mockImplementation(({ href, alt }) => (
    // biome-ignore lint/performance/noImgElement: isolated content image preview stub
    <img src={href ?? undefined} alt={alt} />
  ));
  vi.spyOn(Image, "default").mockImplementation(({ src, alt }) => (
    // biome-ignore lint/performance/noImgElement: isolated furniture preview stub
    <img src={typeof src === "string" ? src : undefined} alt={alt} />
  ));
  vi.spyOn(RichInput, "default").mockImplementation(
    ({ id, label, control, disabled }) => {
      const { field } = useController({ name: id, control });
      return (
        <label>
          {label}
          <textarea {...field} disabled={disabled} />
        </label>
      );
    },
  );
  vi.spyOn(uploadthing, "UploadButton").mockImplementation(((next: UploadCallbacks) => {
    upload = next;
    return (
      <button type="button" onClick={next.onUploadBegin}>
        Upload image
      </button>
    );
  }) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(showToast);
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Open the actual selector dialog; generation itself stays an application-boundary stub. */
const open = (view: ReturnType<typeof render>) =>
  fireEvent.click(view.getByRole("button", { name: "Edit 90° image" }));
const generated = { success: true, url: "https://example.com/generated.webp" };

it("keeps a pending activity-streak image when the same config changes streak type", async () => {
  const config: NonNullable<RouterOutputs["activityStreak"]["getConfig"]> = {
    id: "event-config",
    name: "Event",
    description: "Daily activity rewards",
    image: original,
    totalDays: 14,
    streakType: "RECURRING",
    isActive: true,
    ryoCost: 0,
    repsCost: 0,
    seichiSilverCost: 0,
    startDate: null,
    endDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdByUserId: null,
    rewards: [],
  };
  let form: UseFormReturn<ActivityStreakFormType> | undefined;
  Object.assign(client.api, {
    activityStreak: {
      getConfig: { useQuery: () => ({ data: config, isPending: false }) },
      updateConfig: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    gameAsset: {
      getNameTags: { useQuery: () => ({ data: [] }) },
      getSceneAssets: { useQuery: () => ({ data: [] }) },
      getAll: { useInfiniteQuery: () => ({ data: { pages: [] } }) },
    },
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(elementSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { role: "CONTENT-ADMIN" },
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(EditContent, "EditContent").mockImplementation((props) => {
    form = props.form as unknown as UseFormReturn<ActivityStreakFormType>;
    return <ActualEditContent {...props} />;
  });
  const params = Promise.resolve({ configid: config.id });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={null}>
        <ActivityStreakEditPage params={params} />
      </Suspense>,
    );
  });
  fireEvent.click(view!.getByRole("button", { name: "Edit Image" }));
  fireEvent.click(view!.getByRole("button", { name: "Generate AI Image" }));
  expect(requests).toHaveLength(1);
  fireEvent.click(view!.getByRole("button", { name: "Close" }));
  act(() => form!.setValue("streakType", "EVENT_PASS"));
  expect(view!.getByText("Ryo Cost")).toBeTruthy();
  await act(() => requests[0]!.complete(generated));
  expect(showToast).toHaveBeenCalledWith(generated);
  expect(form!.getValues("image")).toBe(generated.url);
  expect(view!.getByRole("img").getAttribute("src")).toBe(generated.url);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(requests[0]!.input.relationId).toBe(config.id);
});

describe("content furniture image generation", () => {
  for (const [rotation, degrees] of [
    [1, 90],
    [2, 180],
    [3, 270],
  ] as const) {
    it(`recreates ${degrees}° from canonical art with its style and direction in the actual request`, () => {
      const prompt = furnitureViewPrompt("Tea table", rotation);
      const view = render(<ContentImageSelector.default {...props} prompt={prompt} />);
      open(view);
      expect(view.getByRole("tab", { name: "Recreate from original" })).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
      expect(requests[0]?.input).toMatchObject({
        preprompt: FURNITURE_IMAGE_PROMPT,
        provider: "OPENAI",
        prompt: `${FURNITURE_IMAGE_PROMPT}\n${prompt}`,
        previousImg: original,
        relationId: props.id,
        size: props.size,
        maxDim: props.maxDim,
        removeBg: true,
      });
      expect(String(requests[0]?.input.prompt)).toContain(
        `${degrees} degrees clockwise`,
      );
    });
  }

  it("edits the current painted direction instead of returning to the original", () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Edit current" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(view.getByRole("textbox", { name: "Edit Instructions" }), {
      target: { value: "Restore the two cups" },
    });
    fireEvent.click(view.getByRole("button", { name: "Edit Image" }));
    expect(requests[0]?.input).toMatchObject({
      provider: "OPENAI",
      previousImg: current,
      prompt: `${FURNITURE_IMAGE_PROMPT}\nKeep the camera and design consistent. Preserve the viewing direction unless the correction explicitly changes it. Restore the two cups`,
      removeBg: true,
    });
  });

  it("accepts the current generation and refreshes history only after a successful image", async () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    await act(() => requests[0]!.complete(generated));
    expect(onUploadComplete).toHaveBeenCalledWith(generated.url);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(
      view
        .getAllByRole("img")
        .some((image) => image.getAttribute("src") === generated.url),
    ).toBe(true);
  });

  it("accepts subsequent generations after its own successful parent image update", async () => {
    function UpdatingSelector() {
      const [imageUrl, setImageUrl] = useState(current);
      return (
        <ContentImageSelector.default
          {...props}
          imageUrl={imageUrl}
          onUploadComplete={(url) => {
            onUploadComplete(url);
            setImageUrl(url);
          }}
        />
      );
    }
    const view = render(<UpdatingSelector />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    await act(() => requests[0]!.complete(generated));
    expect(
      view
        .getAllByRole("img")
        .every((image) => image.getAttribute("src") === generated.url),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    const next = { success: true, url: "https://example.com/next-generation.webp" };
    await act(() => requests[1]!.complete(next));
    expect(onUploadComplete).toHaveBeenLastCalledWith(next.url);
    expect(onUploadComplete).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(
      view.getAllByRole("img").every((image) => image.getAttribute("src") === next.url),
    ).toBe(true);
  });

  it("does not restore a removed furniture view when a pending generation completes", async () => {
    const onViewsChange = vi.fn();
    function UpdatingFurnitureViews() {
      const [views, setViews] = useState<FurnitureViews>({ "90": { image: current } });
      return (
        <FurnitureViewsEditor
          id="table"
          name="Tea table"
          description="Two cups"
          image={original}
          width={30}
          groundAnchor={90}
          geometry={{
            aspectRatio: 4 / 3,
            visibleBounds: { x: 0, y: 0, width: 100, height: 100 },
            footprint: { x: 10, y: 85, width: 80, height: 15 },
          }}
          views={views}
          canEdit
          onBaseChange={onUploadComplete}
          onViewsChange={(next) => {
            onViewsChange(next);
            setViews(next);
          }}
        />
      );
    }
    const view = render(<UpdatingFurnitureViews />);
    fireEvent.mouseDown(view.getByRole("tab", { name: "90°" }), {
      button: 0,
      ctrlKey: false,
    });
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    fireEvent.click(view.getByRole("button", { name: "Remove this view" }));
    expect(onViewsChange).toHaveBeenLastCalledWith({});
    await act(() => requests[0]!.complete(generated));
    expect(onViewsChange).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("button", { name: "Remove this view" })).toBeNull();
    expect(view.getByText("Generate or upload this view.")).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("shows missing-view guidance in the picker and dialog instead of a character avatar", () => {
    const view = render(
      <ContentImageSelector.default
        {...props}
        imageUrl=""
        emptyImageLabel="Generate or upload this view"
      />,
    );
    expect(view.getByText("Generate or upload this view")).toBeTruthy();
    expect(view.queryByRole("img")).toBeNull();
    open(view);
    expect(view.getAllByText("Generate or upload this view")).toHaveLength(2);
    expect(view.queryByRole("img")).toBeNull();
  });

  it.each(["id", "referenceImageUrl", "imageUrl"] as const)(
    "rejects a delayed generation when the form's %s changes",
    async (field) => {
      const view = render(<ContentImageSelector.default {...props} />);
      open(view);
      fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
      const replacement = vi.fn();
      view.rerender(
        <ContentImageSelector.default
          {...props}
          {...{
            [field]:
              field === "id"
                ? "other-item:furniture:90"
                : "https://example.com/replacement.webp",
          }}
          onUploadComplete={replacement}
        />,
      );
      await act(() => requests[0]!.complete(generated));
      expect(onUploadComplete).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it("rejects a delayed generation after the editor was disabled and made available again", async () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    view.rerender(<ContentImageSelector.default {...props} disabled />);
    expect(view.queryByRole("dialog")).toBeNull();
    view.rerender(<ContentImageSelector.default {...props} />);
    await act(() => requests[0]!.complete(generated));
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("rejects a completion from an unmounted editor without writing into its replacement", async () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    view.unmount();
    const replacement = vi.fn();
    render(
      <ContentImageSelector.default
        {...props}
        id="replacement"
        onUploadComplete={replacement}
      />,
    );
    await act(() => requests[0]!.complete(generated));
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps upload callbacks from an old item from replacing another item's image", () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Upload image" }));
    const previousUpload = upload;
    const replacement = vi.fn();
    view.rerender(
      <ContentImageSelector.default
        {...props}
        id="other-item"
        onUploadComplete={replacement}
      />,
    );
    act(() =>
      previousUpload.onClientUploadComplete([
        { serverData: { fileUrl: generated.url } },
      ]),
    );
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("accepts historical art selected for the current editor", () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    act(() => history.onUpdate?.(generated.url));
    expect(onUploadComplete).toHaveBeenCalledWith(generated.url);
  });

  it("rejects a delayed historical selection after the editor is unmounted", () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    const previousSelection = history.onUpdate;
    view.unmount();
    const replacement = vi.fn();
    render(
      <ContentImageSelector.default
        {...props}
        id="replacement"
        onUploadComplete={replacement}
      />,
    );
    act(() => previousSelection?.(generated.url));
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("shows expected generation failures without changing the current art", async () => {
    const view = render(<ContentImageSelector.default {...props} />);
    open(view);
    fireEvent.click(view.getByRole("button", { name: "Generate AI Image" }));
    const rejection = {
      success: false,
      message: "Image generation failed. Try again.",
    };
    await act(() => requests[0]!.complete(rejection));
    expect(showToast).toHaveBeenCalledWith(rejection);
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
