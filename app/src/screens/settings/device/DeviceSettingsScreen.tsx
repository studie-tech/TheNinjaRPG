import { headers } from "next/headers";
import { notFound } from "next/navigation";
import DeviceSettings from "@/components/native/DeviceSettings";
import ContentBox from "@/layout/ContentBox";
import { isNativeUserAgent } from "@/libs/native/userAgent";

/** Render the settings device screen independently of its route adapter. */
export async function DeviceSettingsScreen() {
  if (!isNativeUserAgent((await headers()).get("user-agent"))) notFound();
  return (
    <ContentBox title="App settings" subtitle="Your app preferences">
      <DeviceSettings />
    </ContentBox>
  );
}
