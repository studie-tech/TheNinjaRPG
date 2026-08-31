import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const readRepoFile = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

describe("native release configuration", () => {
  it("keeps the iOS app target aligned with Capacitor 8", () => {
    const configuration = readRepoFile("mobile/scripts/configure-xcode.rb");
    const project = readRepoFile("mobile/ios/App/App.xcodeproj/project.pbxproj");

    expect(configuration).toContain('APP_DEPLOYMENT_TARGET = "16.0"');
    expect(project).not.toContain("IPHONEOS_DEPLOYMENT_TARGET = 15.0;");
  });

  it("does not back up device credentials", () => {
    const manifest = readRepoFile("mobile/android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it("stops the audio service after a rebuilt Activity is finally destroyed", () => {
    const plugin = readRepoFile(
      "mobile/android/app/src/main/java/com/theninjarpg/app/TNRAudioSessionPlugin.java",
    );
    expect(plugin).toContain("if (!rebuilding)");
    expect(plugin).not.toContain("if (running && !rebuilding)");
  });

  it("mounts native audio and device controls in the live settings module", () => {
    const settings = readRepoFile("app/src/layout/GameSettings.tsx");
    const controller = readRepoFile(
      "app/src/components/layout/shared/GameLayoutController.tsx",
    );

    expect(controller).toContain('from "@/layout/GameSettings"');
    expect(settings).toContain('import DeviceSettings from "@/components/native/DeviceSettings"');
    expect(settings).toContain('import { audioSession } from "@/libs/native"');
    expect(settings).toContain("<DeviceSettings />");
    expect(settings).toContain("audioSession.onRemoteCommand");
  });

  it("propagates the configured app id through both native projects", () => {
    const android = readRepoFile("mobile/android/app/build.gradle");
    const configureIos = readRepoFile("mobile/scripts/configure-xcode.rb");
    const appEntitlements = readRepoFile("mobile/ios/App/App/App.entitlements");
    const widgetEntitlements = readRepoFile(
      "mobile/ios/App/TNRWidgets/TNRWidgets.entitlements",
    );
    const snapshot = readRepoFile("mobile/ios/App/TNRShared/TNRSnapshot.swift");

    expect(android).toContain("System.getenv('TNR_APP_ID')");
    expect(android).toContain("applicationId tnrAppId");
    expect(configureIos).toContain('set_setting(app, "TNR_APP_GROUP", APP_GROUP)');
    expect(configureIos).toContain('set_setting(widget, "TNR_APP_GROUP", APP_GROUP)');
    expect(appEntitlements).toContain("$(TNR_APP_GROUP)");
    expect(widgetEntitlements).toContain("$(TNR_APP_GROUP)");
    expect(snapshot).toContain('object(forInfoDictionaryKey: "TNRAppGroup")');
  });
});
