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
});
