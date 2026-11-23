import { lpcDesignCoverage } from "@/libs/lpc/designs";
import type { LpcBody, LpcMaterialColors } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Make absent poses visible before a staff member saves an outfit or assigns it to an item. */
export const LpcAnimationCoverage = ({
  config,
  body,
  color,
  eyes,
  materialColors,
}: {
  config: LpcConfig;
  body: LpcBody;
  color?: string;
  eyes?: string;
  materialColors?: LpcMaterialColors;
}) => {
  const coverage = lpcDesignCoverage(config, body, color, eyes, materialColors);
  const supplied = coverage
    .filter((pose) => pose.supplied)
    .map((pose) => pose.animation);
  const held = coverage.filter((pose) => !pose.supplied).map((pose) => pose.animation);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Animation coverage</summary>
      <p className="mt-2">Authored: {supplied.join(", ") || "none"}.</p>
      {!!held.length && (
        <p className="text-muted-foreground">
          Held-pose fallback: {held.join(", ")}. Missing breathing poses keep the outfit
          still.
        </p>
      )}
    </details>
  );
};
