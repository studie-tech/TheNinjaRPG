import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";
import ShinobiStruggleClient from "./ShinobiStruggleClient";

export const metadata: Metadata = noindexMetadata("Shinobi Struggle");

export default async function ShinobiStrugglePage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const { match } = await searchParams;
  return <ShinobiStruggleClient initialMatchId={match} />;
}
