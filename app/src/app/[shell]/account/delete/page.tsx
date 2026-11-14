import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NativeAccountDeletion } from "@/components/native/NativeAccountDeletion";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { noindexMetadata } from "@/libs/seo";

export const metadata = noindexMetadata("Delete account");

/** Account deletion runs in the app; web visitors get the page explaining how to request it. */
export default async function DeleteAccountPage() {
  if (!isNativeUserAgent((await headers()).get("user-agent")))
    redirect("/account/deletion-info");
  return <NativeAccountDeletion />;
}
