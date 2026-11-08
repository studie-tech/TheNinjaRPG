import * as resolvers from "@hookform/resolvers/zod";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as carousel from "@/components/ui/carousel";
import * as characterPreview from "@/layout/CharacterPreview";
import { BOTID_BLOCKED_MESSAGE } from "@/libs/botid";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../../setup/browserGlobals";

const { default: RegisterPage } = await import("@/app/[shell]/register/page");

type Outcome = { success: boolean; message: string };

const clients: QueryClient[] = [];

/** jsdom has no layout, so the carousel's position cannot be read; the steps staying mounted preserves it. */
const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Mount the real page with the form valid, so a submit reaches `createCharacter`. */
const mount = (createCharacter: () => Promise<Outcome>) => {
  const globalOnError = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { onError: globalOnError } },
  });
  clients.push(queryClient);
  installBrowserGlobals({ events: [], resizeObserver: true });
  for (const part of ["Carousel", "CarouselContent", "CarouselItem"] as const) {
    vi.spyOn(carousel, part).mockImplementation(Passthrough as never);
  }
  for (const part of ["CarouselNext", "CarouselPrevious"] as const) {
    vi.spyOn(carousel, part).mockReturnValue(null as never);
  }
  const mutationToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  mutationToast.mockClear();
  vi.spyOn(resolvers, "zodResolver").mockReturnValue((async (values: object) => ({
    values,
    errors: {},
  })) as never);
  vi.spyOn(characterPreview, "CharacterPreview").mockReturnValue(null as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn(), replace: vi.fn() } as never);
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: undefined,
    status: "success",
    isClerkLoaded: true,
    isSignedIn: true,
    userId: "new-player",
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getUser: { invalidate: vi.fn(async () => undefined) } } }),
    avatar: { createAvatar: { useMutation: () => ({ mutate: vi.fn() }) } },
    profile: { getUsername: { useQuery: () => ({ data: undefined }) } },
    bloodline: { getAll: { useInfiniteQuery: () => ({ data: undefined }) } },
    register: {
      createCharacter: {
        useMutation: (options: object) => useMutation({ ...options, mutationFn: createCharacter }),
      },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RegisterPage />
    </QueryClientProvider>,
  );
  const createButton = view.container.querySelector("#create");
  if (!createButton?.closest("form")) throw new Error("The final step did not render");
  return { view, createButton, form: createButton.closest("form")!, globalOnError, mutationToast };
};

it("stays on the final step and keeps the server's reason after a rejected submission", async () => {
  const { view, form, createButton, mutationToast } = mount(async () => ({
    success: false,
    message: "Username already taken",
  }));

  fireEvent.submit(form);

  expect((await view.findByRole("alert")).textContent).toBe("Username already taken");
  expect(view.container.querySelector("#create")).toBe(createButton);
  expect(mutationToast).toHaveBeenCalledTimes(1);
});

it("keeps the steps mounted behind the loader while the character is created", async () => {
  let finish: (outcome: Outcome) => void = () => undefined;
  const { view, form, createButton } = mount(
    () => new Promise<Outcome>((resolve) => { finish = resolve; }),
  );

  fireEvent.submit(form);

  await view.findByText("Creating character...");
  expect(view.container.querySelector("#create")).toBe(createButton);
  expect(form.className).toContain("invisible");

  await act(async () => finish({ success: false, message: "Bloodline not found" }));
  await waitFor(() => expect(view.queryByText("Creating character...")).toBeNull());
  expect(form.className).not.toContain("invisible");
});

it("shows a rejected request on the final step without replacing the global error handler", async () => {
  const { view, form, createButton, globalOnError } = mount(async () => {
    throw new Error(BOTID_BLOCKED_MESSAGE);
  });

  fireEvent.submit(form);

  expect((await view.findByRole("alert")).textContent).toBe(BOTID_BLOCKED_MESSAGE);
  expect(view.container.querySelector("#create")).toBe(createButton);
  expect(globalOnError).toHaveBeenCalledTimes(1);
});

it("does not claim a failure when the outcome of the request is unknown", async () => {
  const { view, form } = mount(async () => {
    throw new TypeError("Failed to fetch");
  });

  fireEvent.submit(form);

  expect((await view.findByRole("alert")).textContent).toContain(
    "We could not confirm whether your character was created",
  );
});

it("clears the reason once a retry succeeds", async () => {
  const outcomes: Outcome[] = [
    { success: false, message: "Username already taken" },
    { success: true, message: "OK" },
  ];
  const { view, form } = mount(async () => outcomes.shift()!);

  fireEvent.submit(form);
  await view.findByRole("alert");

  fireEvent.submit(form);
  await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
});

it("renders one trait picker per attribute slot, each showing its own choice", () => {
  const { view } = mount(async () => ({ success: true, message: "OK" }));
  const pickers = [1, 2, 3].map((slot) => {
    const label = view.getByText(`Trait ${slot}`);
    const trigger = label.closest("[data-slot='form-item'], div")?.querySelector("button[role='combobox']");
    if (!trigger) throw new Error(`Trait ${slot} has no picker`);
    return trigger.textContent;
  });
  expect(pickers.every(Boolean)).toBe(true);
  expect(new Set(pickers).size).toBe(3);
});

it("offers hair, eye and skin colours before the three traits", () => {
  const { view } = mount(async () => ({ success: true, message: "Created" }));
  const labels = ["Hair color", "Eye color", "Skin color", "Trait 1", "Trait 2", "Trait 3"];
  const all = Array.from(view.container.querySelectorAll("label")).map((label) => label.textContent);
  expect(all.filter((label) => labels.includes(label ?? ""))).toEqual(labels);
  for (const label of labels) {
    expect(view.getByText(label).closest("div")?.querySelector("[role=combobox]")).toBeTruthy();
  }
});
