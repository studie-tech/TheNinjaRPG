import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Provider } from "jotai";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as nextLink from "next/link";
import * as nextNavigation from "next/navigation";
import {
  type ComponentProps,
  StrictMode,
  Suspense,
  use,
  useContext,
  useState,
} from "react";
import { useNavigationRouter } from "@/hooks/navigation";
import { NavigationProvider } from "@/layout/NavigationProvider";
import { actualLink as Link } from "../setup/preload";
import { deferred } from "../setup/deferred";

// Model the public Link event contract without importing Next's bundled RSC runtime.
const TestNextLink = ({
  prefetch,
  href,
  children,
  onClick,
  onNavigate,
  ...rest
}: ComponentProps<typeof Link>) => {
  const address =
    typeof href === "string"
      ? href
      : `${href.pathname}?${new URLSearchParams(href.query as Record<string, string>)}`;
  return (
    <a
      {...rest}
      href={address}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        onNavigate?.({ preventDefault: () => event.preventDefault() });
      }}
    >
      {children}
    </a>
  );
};
beforeEach(() => {
  vi.spyOn(nextLink, "default").mockImplementation(
    TestNextLink as typeof nextLink.default,
  );
  // Bun retains module mocks from other suites; read each test's router context explicitly.
  vi.spyOn(nextNavigation, "useRouter").mockImplementation(
    () => useContext(AppRouterContext)!,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("navigation feedback", () => {
  it("keeps a programmatic transition pending after its source unmounts until it commits", async () => {
    const { promise: gate, resolve: finish } = deferred<void>();
    const Destination = () => {
      use(gate);
      return <p>Destination</p>;
    };
    const Controls = ({ close }: { close: () => void }) => {
      const router = useNavigationRouter();
      return (
        <button
          type="button"
          onClick={() => {
            router.push("/combat");
            close();
          }}
        >
          Enter battle
        </button>
      );
    };
    const Frame = () => {
      const [navigating, setNavigating] = useState(false);
      const [isOpen, setIsOpen] = useState(true);
      const router = { push: () => setNavigating(true) };
      return (
        <AppRouterContext.Provider value={router as never}>
          <NavigationProvider>
            {isOpen && <Controls close={() => setIsOpen(false)} />}
            <Suspense fallback={<p>Fallback</p>}>
              {navigating ? <Destination /> : <p>Current page</p>}
            </Suspense>
          </NavigationProvider>
        </AppRouterContext.Provider>
      );
    };
    const view = render(
      <StrictMode>
        <Provider>
          <Frame />
        </Provider>
      </StrictMode>,
    );
    await act(async () => fireEvent.click(view.getByRole("button")));
    expect(view.getByText("Current page")).toBeTruthy();
    expect(view.getByRole("status")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    await act(async () => {
      finish();
      await gate;
    });
    expect(await view.findByText("Destination")).toBeTruthy();
    expect(view.queryByRole("status")).toBeNull();
  });

  it.each([false, true])(
    "preserves Next link navigation callbacks and scroll/replace (replace: %s)",
    async (replace) => {
      const router = { push: vi.fn(), replace: vi.fn() };
      const onClick = vi.fn();
      const onNavigate = vi.fn();
      const view = render(
        <Provider>
          <AppRouterContext.Provider value={router as never}>
            <NavigationProvider>
              <Link
                href={{ pathname: "/items", query: { tab: "equipped" } }}
                replace={replace}
                scroll={false}
                onClick={onClick}
                onNavigate={onNavigate}
              >
                Items
              </Link>
            </NavigationProvider>
          </AppRouterContext.Provider>
        </Provider>,
      );
      await act(async () => fireEvent.click(view.getByRole("link")));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(replace ? router.replace : router.push).toHaveBeenCalledWith(
        "http://localhost/items?tab=equipped",
        { scroll: false },
      );
      expect(replace ? router.push : router.replace).not.toHaveBeenCalled();
    },
  );

  it.each(["onClick", "onNavigate"] as const)(
    "honors %s prevention without starting navigation",
    async (handler) => {
      const router = { push: vi.fn(), replace: vi.fn() };
      const view = render(
        <Provider>
          <AppRouterContext.Provider value={router as never}>
            <NavigationProvider>
              <Link
                href="/items"
                {...{
                  [handler]: (event: { preventDefault: () => void }) =>
                    event.preventDefault(),
                }}
              >
                Items
              </Link>
            </NavigationProvider>
          </AppRouterContext.Provider>
        </Provider>,
      );
      await act(async () => fireEvent.click(view.getByRole("link")));
      expect(router.push).not.toHaveBeenCalled();
      expect(view.queryByRole("status")).toBeNull();
    },
  );
});

describe("intent prefetch", () => {
  const renderLink = (props: Partial<ComponentProps<typeof Link>> = {}) => {
    const view = render(
      <Provider>
        <Link href="/items" {...props}>
          <span>Items</span>
        </Link>
      </Provider>,
    );
    return { ...view, link: view.getByRole("link") };
  };
  const dwell = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 240));
    });

  it("starts disabled, cancels brief hovers, and enables only after a dwell", async () => {
    const { link } = renderLink();
    expect(link.getAttribute("data-prefetch")).toBe("false");
    expect(link.childElementCount).toBe(1);
    fireEvent.pointerEnter(link);
    fireEvent.pointerLeave(link);
    await dwell();
    expect(link.getAttribute("data-prefetch")).toBe("false");
    fireEvent.pointerEnter(link);
    await dwell();
    expect(link.getAttribute("data-prefetch")).toBe("null");
  });

  it.each(["focus", "touch"])("enables prefetch on %s intent", (intent) => {
    const { link } = renderLink();
    if (intent === "focus") fireEvent.focus(link);
    else fireEvent.touchStart(link);
    expect(link.getAttribute("data-prefetch")).toBe("null");
  });

  it.each([false, true, null] as const)(
    "honors explicit prefetch=%s",
    async (prefetch) => {
      const { link } = renderLink({ prefetch });
      fireEvent.focus(link);
      fireEvent.touchStart(link);
      fireEvent.pointerEnter(link);
      await dwell();
      expect(link.getAttribute("data-prefetch")).toBe(String(prefetch));
    },
  );

  it.each([
    { href: "#settings" },
    { href: "https://example.com/items" },
    { target: "_blank" },
    { download: true },
  ])("does not speculate on non-navigation links: %j", (props) => {
    const { link } = renderLink(props);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(link.getAttribute("data-prefetch")).toBe("false");
  });

  it("preserves event handlers and their prevention of prefetch", async () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const onPointerEnter = vi.fn((event) => event.preventDefault());
    const onFocus = vi.fn((event) => event.preventDefault());
    const { link } = renderLink({ onClick, onPointerEnter, onFocus });
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.click(link);
    await dwell();
    expect(link.getAttribute("data-prefetch")).toBe("false");
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
