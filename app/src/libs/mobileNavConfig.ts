import {
  Banknote,
  Bed,
  Briefcase,
  CircleUserRound,
  Cog,
  Compass,
  Dumbbell,
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
}

// All available options (12 village pages + 6 existing defaults)
export const MOBILE_NAV_OPTIONS: MobileNavOption[] = [
  // Village pages (from requirements)
  { id: "traininggrounds", name: "Training", href: "/traininggrounds" },
  { id: "townhall", name: "Town Hall", href: "/townhall" },
  { id: "ramenshop", name: "Ramen Shop", href: "/ramenshop" },
  { id: "missionhall", name: "Mission Hall", href: "/missionhall" },
  { id: "itemshop", name: "Item Shop", href: "/itemshop" },
  { id: "hospital", name: "Hospital", href: "/hospital" },
  { id: "home", name: "Home", href: "/home" },
  { id: "clanhall", name: "Clan Hall", href: "/clanhall" },
  { id: "blackmarket", name: "Black Market", href: "/blackmarket" },
  { id: "battlearena", name: "Arena", href: "/battlearena" },
  { id: "bank", name: "Bank", href: "/bank" },
  { id: "anbu", name: "ANBU", href: "/anbu" },
  { id: "occupation", name: "Occupation", href: "/occupation" },
  // Current default pages (must be included)
  { id: "profile", name: "Profile", href: "/profile" },
  { id: "inbox", name: "Inbox", href: "/inbox" },
  { id: "travel", name: "Travel", href: "/travel" },
  { id: "tavern", name: "Tavern", href: "/tavern" },
  { id: "settings", name: "Settings", href: "/profile/edit" },
  { id: "items", name: "Items", href: "/items" },
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

// Icon mapping function - returns the appropriate icon component for each option ID
export const getMobileNavIcon = (id: string): LucideIcon => {
  const iconMap: Record<string, LucideIcon> = {
    traininggrounds: Dumbbell,
    townhall: Landmark,
    ramenshop: UtensilsCrossed,
    missionhall: ScrollText,
    itemshop: ShoppingBag,
    hospital: HeartPulse,
    home: Bed,
    clanhall: Users,
    blackmarket: Store,
    battlearena: Swords,
    bank: Banknote,
    anbu: Shield,
    occupation: Briefcase,
    profile: CircleUserRound,
    inbox: Inbox,
    travel: Compass,
    tavern: MessagesSquare,
    settings: Cog,
    items: Package,
  };
  return iconMap[id] ?? CircleUserRound;
};

// Validate and normalize config from localStorage
export const normalizeMobileNavConfig = (
  config: unknown,
  defaults: MobileNavConfig = DEFAULT_MOBILE_NAV_CONFIG,
): MobileNavConfig => {
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
