import type { Integration } from "@sentry/core";
import { publicPathForShellPath } from "@/libs/shell";

// Public pages only: unknown URLs share a label rather than exposing arbitrary path data.
// The route-coverage test keeps this allowlist in sync with app/[shell].
export const PUBLIC_PAGE_ROUTES = [
  "/",
  "/academy",
  "/account/delete",
  "/account/deletion-info",
  "/adminbuilding",
  "/anbu",
  "/anbu/[anbuid]",
  "/auctionhouse",
  "/bank",
  "/battlearena",
  "/battlelog/[battleid]",
  "/blackmarket",
  "/clanhall",
  "/clanhall/[clanid]",
  "/colosseum",
  "/combat",
  "/conceptart",
  "/conceptart/[imageid]",
  "/consent",
  "/credits",
  "/discord/link",
  "/dungeon",
  "/emailsettings",
  "/event",
  "/farm",
  "/forum",
  "/forum/manage",
  "/forum/[boardid]",
  "/forum/[boardid]/[threadid]",
  "/globalanbuhq",
  "/guide",
  "/guide/[slug]",
  "/guide/edit/[id]",
  "/help",
  "/historybuilding",
  "/home",
  "/home/visit/[userId]",
  "/hospital",
  "/inbox",
  "/items",
  "/itemshop",
  "/jutsus",
  "/layouts",
  "/login/[[...rest]]",
  "/manual",
  "/manual/activityStreak",
  "/manual/activityStreak/edit/[configid]",
  "/manual/ai",
  "/manual/ai/[aiid]/placements",
  "/manual/ai/balance",
  "/manual/ai/edit/[aiid]",
  "/manual/ai/statistics/[aiid]",
  "/manual/asset",
  "/manual/asset/[folder]",
  "/manual/asset/edit/[assetid]",
  "/manual/awards",
  "/manual/badge",
  "/manual/badge/edit/[badgeid]",
  "/manual/balance",
  "/manual/bloodline",
  "/manual/bloodline/[bloodlineid]",
  "/manual/bloodline/balance",
  "/manual/bloodline/completeness",
  "/manual/bloodline/edit/[bloodlineid]",
  "/manual/bloodline/mass_edit",
  "/manual/bloodline/reskins",
  "/manual/bloodline/reskins/edit/[reskinId]",
  "/manual/bloodline/statistics/[bloodlineid]",
  "/manual/bloodright",
  "/manual/combat",
  "/manual/companions",
  "/manual/companions/edit/[speciesid]",
  "/manual/content_backups",
  "/manual/crafting_recipes",
  "/manual/damage_calcs/[[...damageSimulationId]]",
  "/manual/dungeon",
  "/manual/hunting",
  "/manual/item",
  "/manual/item/[itemid]",
  "/manual/item/balance",
  "/manual/item/completeness",
  "/manual/item/edit/[itemid]",
  "/manual/item/mass_edit",
  "/manual/item/statistics/[itemid]",
  "/manual/jutsu",
  "/manual/jutsu/[jutsuid]",
  "/manual/jutsu/balance",
  "/manual/jutsu/completeness",
  "/manual/jutsu/edit/[jutsuid]",
  "/manual/jutsu/mass_edit",
  "/manual/jutsu/reskins",
  "/manual/jutsu/reskins/edit/[reskinId]",
  "/manual/jutsu/statistics/[jutsuid]",
  "/manual/logs",
  "/manual/opinions",
  "/manual/polls",
  "/manual/pvp_rank",
  "/manual/quest",
  "/manual/quest/balance",
  "/manual/quest/edit/[questid]",
  "/manual/recruitment",
  "/manual/review",
  "/manual/review/battlefield",
  "/manual/rewards",
  "/manual/sageMode",
  "/manual/sageMode/edit/[sagemodeid]",
  "/manual/skillTree",
  "/manual/skillTree/balance",
  "/manual/skillTree/edit/[skillid]",
  "/manual/skillTreeFolder",
  "/manual/staff",
  "/manual/staff/applications",
  "/manual/staff/applications/[applicationId]",
  "/manual/title",
  "/manual/title/edit/[titleid]",
  "/manual/tournaments",
  "/manual/tournaments/[id]",
  "/manual/towerDefense",
  "/manual/towerDefense/characters",
  "/manual/towerDefense/characters/edit/[characterid]",
  "/manual/towerDefense/leaderboard",
  "/manual/towerDefense/upgrades",
  "/manual/towerDefense/upgrades/edit/[upgradeid]",
  "/manual/world",
  "/manual/world/sector-maps",
  "/manual/world/tilesets",
  "/manual/world/tilesets/edit/[assetid]",
  "/manual/world/tilesets/terrain/edit/[terrainid]",
  "/merch",
  "/merch/[handle]",
  "/merch/cart",
  "/minigames",
  "/missionhall",
  "/native-sign-in",
  "/news",
  "/occupation",
  "/pets",
  "/points",
  "/profile",
  "/profile/edit",
  "/profile/experience",
  "/profile/pet",
  "/profile/recruit",
  "/questteams",
  "/ramenshop",
  "/register",
  "/reports",
  "/reports/[reportid]",
  "/reports/bot-performance",
  "/reports/discord",
  "/reports/statistics",
  "/rules",
  "/science",
  "/settings/device",
  "/shrine",
  "/signup/[[...rest]]",
  "/souvenirs",
  "/support",
  "/support/[ticketId]",
  "/support/create",
  "/tavern",
  "/territory-war",
  "/tournaments",
  "/tournaments/[id]",
  "/towerDefense",
  "/townhall",
  "/traininggrounds",
  "/travel",
  "/userid/[userid]",
  "/username/[username]",
  "/users",
  "/users/[userid]",
  "/users/ipsearch/[ip]",
  "/users/village/[villageid]",
  "/village",
] as const;

const routeSpecificity = (template: string) =>
  template
    .split("/")
    .map((segment) => (segment.startsWith("[") ? "1" : "0"))
    .join("");

const routePatterns = [...PUBLIC_PAGE_ROUTES]
  .sort((a, b) => routeSpecificity(a).localeCompare(routeSpecificity(b)))
  .map((template) => ({
    template,
    pattern: new RegExp(
      "^" +
        (template
          .split("/")
          .map((segment) => {
            if (segment.startsWith("[[...")) return "(?:/[^/]+)*";
            if (segment.startsWith("[...")) return "(?:/[^/]+)+";
            if (segment.startsWith("[")) return "/[^/]+";
            return segment ? `/${segment}` : "";
          })
          .join("") || "/") +
        "$",
    ),
  }));

export const toPublicRouteTemplate = (href: string, base = "https://tnr.invalid/") => {
  try {
    const pathname = new URL(href, base).pathname;
    const publicPath = publicPathForShellPath(pathname) ?? pathname;
    const path = publicPath.replace(/\/+$/, "") || "/";
    return (
      routePatterns.find(({ pattern }) => pattern.test(path))?.template ??
      "/[unmatched]"
    );
  } catch {
    return "/[unmatched]";
  }
};

/** Resolve captured targets independently of the page that is currently committed. */
export const createPublicBrowserRouteProvider = (getLocation: () => string) => ({
  resolveRoute: ({ pathname }: Pick<URL, "pathname">) =>
    toPublicRouteTemplate(pathname),
  resolveCurrentRoute: () => toPublicRouteTemplate(getLocation()),
});

// The SDK's bfcache path bypasses routeProvider. Change the captured options before
// it creates the span and copies its name into the scope used by subsequent errors.
export const publicBfcacheRouteIntegration = (): Integration => ({
  name: "PublicBfcacheRoute",
  setup(client) {
    client.on("beforeStartNavigationSpan", (options, navigation) => {
      if (options.attributes?.["sentry.origin"] !== "auto.navigation.browser.bfcache")
        return;
      const template = toPublicRouteTemplate(navigation?.url ?? "/[unmatched]");
      options.name = template;
      options.attributes = {
        ...options.attributes,
        "sentry.segment.name.source": "route",
        "url.template": template,
      };
    });
  },
});
