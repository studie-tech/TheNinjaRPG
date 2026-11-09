import {
  Banknote,
  Bed,
  Briefcase,
  CircleUserRound,
  Cog,
  Compass,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Inbox,
  Landmark,
  type LucideIcon,
  MessagesSquare,
  Package,
  ScrollText,
  Shield,
  ShoppingBag,
  Store,
  Swords,
  Users,
  UtensilsCrossed,
} from "lucide-react";

// Mobile navigation option definition
export interface MobileNavOption {
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
}

// All available options: village pages, then general pages
export const MOBILE_NAV_OPTIONS: MobileNavOption[] = [
  // Village pages
  { id: "academy", name: "Academy", href: "/academy", icon: GraduationCap },
  { id: "traininggrounds", name: "Training", href: "/traininggrounds", icon: Dumbbell },
  { id: "townhall", name: "Town Hall", href: "/townhall", icon: Landmark },
  { id: "ramenshop", name: "Ramen Shop", href: "/ramenshop", icon: UtensilsCrossed },
  { id: "missionhall", name: "Mission Hall", href: "/missionhall", icon: ScrollText },
  { id: "itemshop", name: "Item Shop", href: "/itemshop", icon: ShoppingBag },
  { id: "hospital", name: "Hospital", href: "/hospital", icon: HeartPulse },
  { id: "home", name: "Home", href: "/home", icon: Bed },
  { id: "clanhall", name: "Clan Hall", href: "/clanhall", icon: Users },
  { id: "blackmarket", name: "Black Market", href: "/blackmarket", icon: Store },
  { id: "battlearena", name: "Arena", href: "/battlearena", icon: Swords },
  { id: "bank", name: "Bank", href: "/bank", icon: Banknote },
  { id: "anbu", name: "ANBU", href: "/anbu", icon: Shield },
  { id: "occupation", name: "Occupation", href: "/occupation", icon: Briefcase },
  // General pages (DEFAULT_MOBILE_NAV_CONFIG ids must stay in this list)
  { id: "profile", name: "Profile", href: "/profile", icon: CircleUserRound },
  { id: "inbox", name: "Inbox", href: "/inbox", icon: Inbox },
  { id: "travel", name: "Travel", href: "/travel", icon: Compass },
  { id: "tavern", name: "Tavern", href: "/tavern", icon: MessagesSquare },
  { id: "settings", name: "Settings", href: "/profile/edit", icon: Cog },
  { id: "items", name: "Items", href: "/items", icon: Package },
];

export interface MobileNavConfig {
  left: string[]; // 2 item IDs
  right: string[]; // 3 item IDs
}

// Default configuration for mobile navigation slots.
// The center button dynamically shows Village (when in village) or Travel (when not).
// When outside village, any "travel" buttons in user config are hidden (but grid layout preserved).
export const DEFAULT_MOBILE_NAV_CONFIG: MobileNavConfig = {
  left: ["profile", "inbox"],
  right: ["items", "tavern", "settings"],
};

export const MOBILE_NAV_STORAGE_KEY = "mobile-nav-config";

export const getNavOptionById = (id: string): MobileNavOption | undefined => {
  return MOBILE_NAV_OPTIONS.find((opt) => opt.id === id);
};

/** Validate stored shortcuts and fall back to defaults for missing, unknown or duplicate IDs. */
export const normalizeMobileNavConfig = (config: unknown): MobileNavConfig => {
  const defaults = DEFAULT_MOBILE_NAV_CONFIG;
  if (!config || typeof config !== "object") return defaults;

  const c = config as Record<string, unknown>;
  const validIds = new Set(MOBILE_NAV_OPTIONS.map((o) => o.id));

  const validateArray = (
    arr: unknown,
    expectedLength: number,
    fallback: string[],
  ): string[] => {
    if (!Array.isArray(arr)) return fallback;
    const valid = arr.filter(
      (id): id is string => typeof id === "string" && validIds.has(id),
    );
    // Reject arrays with duplicate IDs
    if (new Set(valid).size !== valid.length) return fallback;
    if (valid.length !== expectedLength) return fallback;
    return valid;
  };

  const left = validateArray(c.left, 2, defaults.left);
  const right = validateArray(c.right, 3, defaults.right);

  // Reject config if there are duplicate IDs across left and right
  const allIds = [...left, ...right];
  if (new Set(allIds).size !== allIds.length) {
    return defaults;
  }

  return { left, right };
};
