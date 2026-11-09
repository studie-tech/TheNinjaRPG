import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as ConceptReactions from "@/layout/ConceptReactions";
import EmbeddedConceptArt from "@/layout/EmbeddedConceptArt";
import * as Image from "@/layout/Image";
import * as Link from "@/layout/Link";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

let settle: (value: { success: boolean; message: string }) => void = () => undefined;
const toggle = vi.fn(
  () =>
    new Promise<{ success: boolean; message: string }>((resolve) => {
      settle = resolve;
    }),
);
const invalidate = vi.fn(async () => undefined);

beforeEach(() => {
  toggle.mockClear();
  invalidate.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ conceptart: { get: { invalidate } } }),
    conceptart: {
      get: {
        useQuery: () => ({
          data: { id: "art", image: "/art.webp", mediaType: "image", prompt: "Art" },
          isLoading: false,
          isError: false,
        }),
      },
      toggleEmotion: { useMutation: () => ({ mutateAsync: toggle }) },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { userId: "viewer" } }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(Image, "default").mockImplementation((({ alt }: { alt: string }) => (
    <img alt={alt} />
  )) as never);
  vi.spyOn(Link, "default").mockImplementation((({
    children,
  }: {
    children: ReactNode;
  }) => <span>{children}</span>) as never);
  vi.spyOn(ConceptReactions, "ConceptReactions").mockImplementation((({
    pendingEmotion,
    disabled,
    onToggle,
  }: {
    pendingEmotion?: string | null;
    disabled?: boolean;
    onToggle: (type: "like") => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-pending={pendingEmotion ?? "none"}
      onClick={() => onToggle("like")}
    >
      Like
    </button>
  )) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("sends one reaction for a same-tick double activation and marks it pending until it settles", async () => {
  const view = render(<EmbeddedConceptArt imageId="art" />);
  const like = view.getByRole("button", { name: "Like" });
  expect(like.getAttribute("data-pending")).toBe("none");
  // Both activations land before React re-renders the disabled button.
  act(() => {
    fireEvent.click(like);
    fireEvent.click(like);
  });
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(toggle).toHaveBeenCalledWith({ imageId: "art", type: "like" });
  expect(like.getAttribute("data-pending")).toBe("like");
  expect((like as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByRole("status").textContent).toBe("Updating");
  await act(async () => settle({ success: true, message: "Reacted" }));
  await waitFor(() => expect(view.queryByRole("status")).toBeNull());
  expect(like.getAttribute("data-pending")).toBe("none");
  expect(invalidate).toHaveBeenCalledWith({ id: "art" });
});
