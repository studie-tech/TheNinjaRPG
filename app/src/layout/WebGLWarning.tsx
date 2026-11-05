import { AlertTriangle } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";

interface WebGLWarningProps {
  onProceed: () => void;
}

/**
 * Component that displays a warning when WebGL is unavailable
 * Allows user to proceed anyway or refresh the page
 */
const WebGLWarning: React.FC<WebGLWarningProps> = ({ onProceed }) => {
  return (
    <ContentBox
      title="WebGL Not Available"
      subtitle="This browser cannot start WebGL"
      alreadyHasH1
      defaultBackHref="/"
    >
      <div className="flex flex-col items-center justify-center space-y-4 p-6">
        <AlertTriangle className="h-20 w-20 text-orange-500" />
        <div className="space-y-2 text-center">
          <p className="font-bold text-lg">Limited Functionality Warning</p>
          <p className="text-muted-foreground">
            WebGL is required for core game features. You will NOT be able to:
          </p>
          <ul className="inline-block space-y-1 text-left text-muted-foreground">
            <li>• Engage in combat</li>
            <li>• Travel on the map</li>
            <li>• View the game&apos;s scenes and animations</li>
          </ul>
          <p className="pt-2 text-muted-foreground">
            Turn on hardware acceleration or try another browser for the full
            experience.
          </p>
        </div>
        <div className="flex flex-col gap-3 pt-4 sm:flex-row">
          <Button variant="default" onClick={() => window.location.reload()}>
            Refresh Page
          </Button>
          <Button variant="destructive" onClick={onProceed}>
            Proceed Anyway
          </Button>
        </div>
      </div>
    </ContentBox>
  );
};

/** Explains why a browser without WebGL cannot create an account. */
export const WebGLUnsupported: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 p-6 text-center">
      <AlertTriangle className="h-20 w-20 text-orange-500" />
      <p className="font-bold text-lg">This browser cannot run the game</p>
      <p className="text-muted-foreground">
        WebGL is unavailable, so combat and travel would not work. Turn on hardware
        acceleration or try another browser, then create your account there.
      </p>
      <Button variant="default" onClick={() => window.location.reload()}>
        Refresh Page
      </Button>
    </div>
  );
};

/**
 * Small banner component to show persistent warning after user proceeds
 */
export const WebGLWarningBanner: React.FC = () => {
  return (
    <div className="mb-4 rounded-md border border-orange-500 bg-orange-500/10 p-4">
      <div className="flex items-center gap-2 text-orange-500">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">WebGL Not Available</span>
      </div>
      <p className="mt-1 text-muted-foreground text-sm">
        You will not be able to use combat or travel features.
      </p>
    </div>
  );
};

export default WebGLWarning;
