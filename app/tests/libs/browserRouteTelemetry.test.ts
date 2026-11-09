import { describe, expect, it, vi } from "bun:test";
import { readdir } from "node:fs/promises";
import {
  BrowserClient,
  browserTracingIntegration,
  type Event,
  getActiveSpan,
  resolveCurrentRoute,
  resolveRoute,
  spanToJSON,
  startBrowserTracingNavigationSpan,
  withScope,
} from "@sentry/browser";
import type { StartSpanOptions } from "@sentry/core";
import {
  createPublicBrowserRouteProvider,
  PUBLIC_PAGE_ROUTES,
  publicBfcacheRouteIntegration,
  toPublicRouteTemplate,
} from "@/libs/browserRouteTelemetry";

const origin = "https://www.theninja-rpg.com";

describe("public browser route labels", () => {
  it("covers every page and has no obsolete routes", async () => {
    const root = new URL("../../src/app/[shell]", import.meta.url);
    const files = await readdir(root, { recursive: true });
    const routes = files
      .filter((file) => file === "page.tsx" || file.endsWith("/page.tsx"))
      .map((file) => "/" + file.replace(/(^|\/)page\.tsx$/, ""));
    expect<string[]>([...PUBLIC_PAGE_ROUTES].sort()).toEqual(routes.sort());
    for (const route of routes) {
      const sample = route
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, "one/two")
        .replace(/\[\.\.\.[^\]]+\]/g, "one/two")
        .replace(/\[[^\]]+\]/g, "private-value");
      expect(toPublicRouteTemplate(sample)).toBe(route);
    }
  });

  it.each([
    ["/profile", "/profile"],
    ["/profile/experience", "/profile/experience"],
    ["/username/Player", "/username/[username]"],
    ["/userid/user_123", "/userid/[userid]"],
    ["/battlelog/abc", "/battlelog/[battleid]"],
    ["/forum/board/thread", "/forum/[boardid]/[threadid]"],
    ["/users/ipsearch/1.2.3.4", "/users/ipsearch/[ip]"],
    ["/support/create", "/support/create"],
    ["/support/private-ticket", "/support/[ticketId]"],
    ["/manual/item/balance", "/manual/item/balance"],
    ["/manual/ai/edit/placements", "/manual/ai/edit/[aiid]"],
    ["/manual/item/private-item", "/manual/item/[itemid]"],
    ["/manual/damage_calcs", "/manual/damage_calcs/[[...damageSimulationId]]"],
    [
      "/manual/damage_calcs/private/id",
      "/manual/damage_calcs/[[...damageSimulationId]]",
    ],
    ["/login", "/login/[[...rest]]"],
    ["/login/factor-one/token", "/login/[[...rest]]"],
    ["/username/Player%2FName/?token=secret#secret", "/username/[username]"],
    ["/web-pixel-in/profile/", "/profile"],
    ["https://www.theninja-rpg.com/profile?user=private#private", "/profile"],
    ["/unrecognized/private", "/[unmatched]"],
    ["/private-username", "/[unmatched]"],
    ["http://[invalid", "/[unmatched]"],
  ])("maps %s to %s", (href, expected) => {
    expect(toPublicRouteTemplate(href)).toBe(expected);
  });
});

describe("Sentry public route provider", () => {
  const setup = () => {
    let location = origin + "/home";
    const client = new BrowserClient({
      dsn: "https://public@example.com/1",
      integrations: [],
      stackParser: () => [],
      transport: () => ({
        send: () => Promise.resolve({}),
        flush: () => Promise.resolve(true),
      }),
      routeProvider: createPublicBrowserRouteProvider(() => location),
    });
    return {
      client,
      setLocation: (href: string) => {
        location = origin + href;
      },
    };
  };

  it("resolves a navigation destination while the browser still shows its source", () => {
    const { client } = setup();
    expect(resolveCurrentRoute(client)).toBe("/home");
    expect(resolveRoute(origin + "/profile?private=value", client)).toBe("/profile");
    expect(resolveCurrentRoute(client)).toBe("/home");
  });

  it("resolves previously captured URLs after a later navigation", () => {
    const { client, setLocation } = setup();
    const captured = new URL(origin + "/username/Private?token=secret");
    setLocation("/bank");
    expect(resolveRoute(captured, client)).toBe("/username/[username]");
    expect(resolveCurrentRoute(client)).toBe("/bank");
  });

  it("handles successive targets and committed back/forward locations without pending state", () => {
    const { client, setLocation } = setup();
    expect(resolveRoute(origin + "/combat", client)).toBe("/combat");
    expect(resolveRoute(origin + "/hospital", client)).toBe("/hospital");
    expect(resolveCurrentRoute(client)).toBe("/home");
    setLocation("/profile");
    expect(resolveCurrentRoute(client)).toBe("/profile");
    setLocation("/home");
    expect(resolveCurrentRoute(client)).toBe("/home");
  });

  it("keeps unmatched paths in a bounded label through the SDK", () => {
    const { client, setLocation } = setup();
    expect(resolveRoute(origin + "/unknown/private-id", client)).toBe("/[unmatched]");
    setLocation("/unknown-user");
    expect(resolveCurrentRoute(client)).toBe("/[unmatched]");
  });
});

describe("Sentry restored-page route labels", () => {
  it.each([0.001, 1])(
    "names restored spans and subsequent errors at sample rate %s",
    async (tracesSampleRate) => {
      await withScope(async (scope) => {
        const errors: Event[] = [];
        const spans: StartSpanOptions[] = [];
        const pageshow: EventListenerOrEventListenerObject[] = [];
        const addListener = vi
          .spyOn(globalThis, "addEventListener")
          .mockImplementation(
            (type: string, listener: EventListenerOrEventListenerObject | null) => {
              if (type === "pageshow" && listener) pageshow.push(listener);
            },
          );
        const originalUrl = window.location.href;
        const client = new BrowserClient({
          dsn: "https://public@example.com/1",
          tracesSampleRate,
          integrations: [
            browserTracingIntegration({
              instrumentPageLoad: false,
              instrumentNavigation: false,
              enableLongTask: false,
              enableLongAnimationFrame: false,
              markBackgroundSpan: false,
              detectRedirects: false,
              linkPreviousTrace: "off",
              traceFetch: false,
              traceXHR: false,
              webVitals: { ignore: ["cls", "lcp", "inp"], bfcacheNavigations: false },
            }),
            publicBfcacheRouteIntegration(),
          ],
          stackParser: () => [],
          transport: () => ({
            send: () => Promise.resolve({}),
            flush: () => Promise.resolve(true),
          }),
          routeProvider: createPublicBrowserRouteProvider(() => window.location.href),
          beforeSend: (event) => {
            errors.push(event);
            return event;
          },
        });
        scope.setClient(client);
        client.on("startNavigationSpan", (options) => spans.push(options));
        const showPage = (persisted: boolean) => {
          const event = new window.PageTransitionEvent("pageshow", { persisted });
          for (const listener of pageshow) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
          }
        };
        try {
          client.init();
          expect(client.getOptions().traceLifecycle).toBe("stream");
          expect(pageshow.length).toBeGreaterThan(0);
          showPage(false);
          expect(spans).toHaveLength(0);
          for (const [path, template] of [
            ["/username/RestoredPrivate?token=secret#private", "/username/[username]"],
            ["/web-pixel-in/battlelog/private-battle", "/battlelog/[battleid]"],
            ["/unrecognized/private-id", "/[unmatched]"],
            ["/bank", "/bank"],
          ] as const) {
            window.history.replaceState({}, "", path);
            showPage(true);
            scope.captureMessage("after restored navigation");
            await client.flush();
            expect(errors.at(-1)?.transaction).toBe(template);
            expect(spans.at(-1)).toMatchObject({
              name: template,
              attributes: {
                "sentry.segment.name.source": "route",
                "url.template": template,
                "sentry.origin": "auto.navigation.browser.bfcache",
                "browser.navigation.type": "back-forward-cache",
              },
            });
            expect(scope.getScopeData().transactionName).toBe(template);
            if (tracesSampleRate === 1) {
              const span = getActiveSpan();
              expect(span).toBeDefined();
              if (span)
                expect(spanToJSON(span)).toMatchObject({
                  name: template,
                  attributes: {
                    "sentry.segment.name.source": "route",
                    "url.template": template,
                  },
                });
            }
          }

          // A captured restore target must win over the currently committed /bank URL.
          const restored = {
            name: "Navigation",
            attributes: {
              "sentry.origin": "auto.navigation.browser.bfcache",
            },
          };
          startBrowserTracingNavigationSpan(client, restored, {
            url: origin + "/username/CapturedPrivate",
          });
          expect(restored.name).toBe("/username/[username]");
          expect(scope.getScopeData().transactionName).toBe("/username/[username]");

          const routerNavigation: StartSpanOptions = {
            name: "/profile",
            attributes: {
              "sentry.origin": "auto.navigation.nextjs",
              "sentry.segment.name.source": "route",
            },
          };
          startBrowserTracingNavigationSpan(client, routerNavigation, {
            url: origin + "/profile",
          });
          expect(routerNavigation).toEqual({
            name: "/profile",
            attributes: {
              "sentry.origin": "auto.navigation.nextjs",
              "sentry.segment.name.source": "route",
            },
          });
        } finally {
          getActiveSpan()?.end();
          await client.close();
          addListener.mockRestore();
          window.history.replaceState({}, "", originalUrl);
        }
      });
    },
  );
});
