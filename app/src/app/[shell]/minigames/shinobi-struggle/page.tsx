import type { Metadata } from "next";
import { Suspense } from "react";
import { noindexMetadata } from "@/libs/seo";
import { ShinobiStruggleRoute } from "./ShinobiStruggleClient";

export const metadata: Metadata = noindexMetadata("Shinobi Struggle");

export default function ShinobiStrugglePage() {
  return (
    <Suspense fallback={<p role="status">Loading Shinobi Struggle…</p>}>
      <ShinobiStruggleRoute />
    </Suspense>
  );
}
