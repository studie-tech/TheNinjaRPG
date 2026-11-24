import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NativeAccountDeletion } from "@/components/native/NativeAccountDeletion";
import { isNativeUserAgent } from "@/libs/native/userAgent";

/** Account deletion runs in the app; web visitors get the page explaining how to request it. */
export async function DeleteAccountScreen() {
  if (!isNativeUserAgent((await headers()).get("user-agent")))
    redirect("/account/deletion-info");
  return <NativeAccountDeletion />;
}
