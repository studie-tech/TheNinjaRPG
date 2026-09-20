import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NativeAccountDeletion } from "@/components/native/NativeAccountDeletion";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { noindexMetadata } from "@/libs/seo";

export const metadata = noindexMetadata("Delete account");

export default async function DeleteAccountPage() {
  if (!isNativeUserAgent((await headers()).get("user-agent"))) notFound();
  return <NativeAccountDeletion />;
}
