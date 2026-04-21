"use client";

import BanInfo from "@/layout/BanInfo";
import Loader from "@/layout/Loader";
import Shop from "@/layout/Shop";
import { useRequireInVillage } from "@/utils/UserContext";

export default function ItemShop() {
  // Settings
  const { userData, access } = useRequireInVillage("/itemshop");

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
      defaultBackHref={"/village"}
      eventItems={false}
      subtitle="Browse gear and supplies — open a card to inspect and buy."
      useItemTypeTabs
    />
  );
}
