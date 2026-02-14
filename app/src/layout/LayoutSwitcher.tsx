"use client";

import type React from "react";
import LayoutCore4 from "@/components/layout/core4_default";

// Used for landing page layout A/B test (disabled for now)
// import { usePathname } from "next/navigation";
// import { useUser } from "@clerk/nextjs";
// import { useAbVariant } from "@/hooks/useAbVariant";
// import LayoutCore4New from "@/components/layout/core4_new";

interface LayoutSwitcherProps {
  children: React.ReactNode;
}

/**
 * LayoutSwitcher component for A/B testing different layouts
 * - Only applies to non-logged in users on the homepage
 * - Control group gets the default layout
 * - Treatment group gets the new layout
 */
const LayoutSwitcher: React.FC<LayoutSwitcherProps> = ({ children }) => {
  // Used for landing page layout A/B test (disabled for now)
  // const pathname = usePathname();
  // const { isSignedIn, isLoaded } = useUser();
  // const { isTreatment } = useAbVariant("ab_layout_new_3");
  // // Only apply A/B test on homepage for non-logged in users
  // const shouldApplyAbTest = pathname === "/" && !isSignedIn;
  // if (!isLoaded) return null;
  // // Treatment group gets the new layout (only on homepage for non-logged in users)
  // if (shouldApplyAbTest && isTreatment) {
  //   return <LayoutCore4New>{children}</LayoutCore4New>;
  // }

  // Default layout for everyone else
  return <LayoutCore4>{children}</LayoutCore4>;
};

export default LayoutSwitcher;
