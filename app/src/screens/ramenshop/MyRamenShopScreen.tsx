"use client";

import RamenShop from "@/layout/RamenShop";

/** Render the ramenshop screen independently of its route adapter. */
export function MyRamenShopScreen() {
  return <RamenShop defaultBackHref="/village" showImage />;
}
