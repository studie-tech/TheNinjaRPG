import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import SplashEditorPage from "@/app/[shell]/manual/splash/page";
import * as navigation from "@/hooks/navigation";
import * as splash from "@/hooks/useSplash";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import * as Image from "@/layout/Image";
import * as SuggestChange from "@/layout/SuggestChange";
import { getPrePrompts, REMOVE_BG_TYPES } from "@/libs/imagePrompts";
import * as userContext from "@/utils/UserContext";
import { activityPanel } from "../setup/activityStreakPanel";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { splashEntry } from "../setup/splash";

let selector: ComponentProps<typeof ContentImageSelector.default>;
let entries = [splashEntry()];
let pending = false;
const create = vi.fn();
const update = vi.fn();

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: vi.fn(),
    back: vi.fn(),
  } as never);
  pending = false;
  entries = [splashEntry()];
  create.mockClear();
  update.mockClear();
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: { role: "CONTENT-ADMIN" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    splash: { getForEdit: { useQuery: () => ({ data: entries }) } },
  });
  vi.spyOn(splash, "useSplashMutations").mockImplementation(
    () =>
      ({
        create: { mutate: create, isPending: pending },
        update: { mutate: update, isPending: false },
        setEnabled: { mutate: vi.fn(), isPending: false },
      }) as never,
  );
  vi.spyOn(ContentImageSelector, "default").mockImplementation((props) => {
    selector = props;
    return <button type="button">Edit {props.label}</button>;
  });
  vi.spyOn(Image, "default").mockReturnValue(null);
  vi.spyOn(SuggestChange, "SuggestChange").mockReturnValue(null);
  activityPanel.mockImplementation(() => <p>Live daily reward panel</p>);
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("toggles the player dialog with rewards and only live entries without persisting dismissal", async () => {
  entries.push(
    splashEntry({ id: "hidden", topicKey: "hidden", name: "Hidden", enabled: false }),
  );
  const beforeDismissal = localStorage.getItem("streakPopupDismissedDateX");
  const view = render(<SplashEditorPage />);
  const toggle = view.getByRole("switch", { name: "Preview splash screen (1/10)" });
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(toggle);
  const dialog = await view.findByRole("dialog", { name: "Village dispatch" });
  expect(dialog.textContent).toContain("Daily activity rewards");
  fireEvent.click(view.getByText("Daily activity rewards"));
  expect(await view.findByText("Live daily reward panel")).toBeTruthy();
  expect(dialog.textContent).toContain("Defend the village");
  expect(dialog.textContent).not.toContain("Hidden");
  fireEvent.click(view.getByRole("button", { name: "Dismiss for today" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(localStorage.getItem("streakPopupDismissedDateX")).toBe(beforeDismissal);
  fireEvent.click(toggle);
  expect(await view.findByRole("dialog", { name: "Village dispatch" })).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: /^Close$/ })[0]!);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

it("keeps generated draft artwork and its history identity when creating an announcement", async () => {
  const view = render(<SplashEditorPage />);
  fireEvent.click(view.getByRole("button", { name: "Create announcement" }));
  const id = selector.id;
  expect(id).toHaveLength(21);
  expect(selector).toMatchObject({ type: "splash", size: "portrait", maxDim: 512 });
  expect(REMOVE_BG_TYPES).not.toContain("splash");
  expect(getPrePrompts("splash")).toContain("scene background");
  fireEvent.change(view.getByLabelText("Title"), { target: { value: "Scouting" } });
  fireEvent.change(view.getByLabelText("Topic key"), {
    target: { value: "scout-post" },
  });
  fireEvent.change(view.getByLabelText("Text"), {
    target: { value: "Visit the Scout Post." },
  });
  expect(selector.id).toBe(id);
  expect(selector.prompt).toContain("Scouting. Visit the Scout Post.");
  const image = "https://uploadthing.b-cdn.net/f/scout.webp";
  await act(async () => {
    selector.onUploadComplete(image);
  });
  expect(
    (view.getByLabelText("Image URL (optional, game CDN)") as HTMLInputElement).value,
  ).toBe(image);
  fireEvent.click(view.getByRole("button", { name: "Save announcement" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0]?.[0]).toMatchObject({ id, data: { image } });
});

it("uses the saved announcement's image history and removes artwork without deleting it", async () => {
  const view = render(<SplashEditorPage />);
  fireEvent.click(view.getByRole("button", { name: /^Edit$/ }));
  expect(selector.id).toBe(entries[0]!.id);
  expect(selector.imageUrl).toBe(entries[0]!.image);
  fireEvent.click(view.getByRole("button", { name: "Remove image" }));
  expect(selector.imageUrl).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Save announcement" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0]?.[0]).toMatchObject({
    id: entries[0]!.id,
    data: { image: "" },
  });
});

it("disables image operations while an announcement save is pending", () => {
  const view = render(<SplashEditorPage />);
  fireEvent.click(view.getByRole("button", { name: "Create announcement" }));
  pending = true;
  view.rerender(<SplashEditorPage />);
  expect(selector.disabled).toBe(true);
});
