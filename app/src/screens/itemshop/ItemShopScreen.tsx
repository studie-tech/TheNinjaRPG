"use client";

import BanInfo from "@/layout/BanInfo";
import Loader from "@/layout/Loader";
import Shop from "@/layout/Shop";
import { useScreenNavigation } from "@/screens/ScreenNavigationContext";
import { useRequireInVillage } from "@/utils/UserContext";

/** Render the village item catalog with its access checks in any screen host. */
export function ItemShopScreen() {
  const navigation = useScreenNavigation("/village");
  // Settings
  const { userData, access } = useRequireInVillage("/itemshop", {
    onAccessDenied: navigation.onBack,
  });

  // Checks
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Item Shop" />;
  if (userData.isBanned) return <BanInfo />;

  // Show items for sale with a cost of min 1 ryo
  return (
    <Shop
      userData={userData}
      minCost={1}
      defaultType="WEAPON"
      {...navigation}
      tutorialPage="/itemshop"
      eventItems={false}
      subtitle="Browse gear and supplies — open a card to inspect and buy."
    />
  );
}
