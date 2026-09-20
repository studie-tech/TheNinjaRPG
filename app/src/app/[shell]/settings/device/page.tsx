import { headers } from "next/headers";
import { notFound } from "next/navigation";
import DeviceSettings from "@/components/native/DeviceSettings";
import ContentBox from "@/layout/ContentBox";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { noindexMetadata } from "@/libs/seo";

export const metadata = noindexMetadata("App settings");

export default async function DeviceSettingsPage() {
  if (!isNativeUserAgent((await headers()).get("user-agent"))) notFound();
  return (
    <ContentBox title="App settings" subtitle="Your app preferences">
      <DeviceSettings />
    </ContentBox>
  );
}
