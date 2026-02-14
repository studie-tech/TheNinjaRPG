import { AlertTriangle } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";

interface WebGL2WarningProps {
  onProceed: () => void;
}

/**
 * Component that displays a warning when WebGL2 is not supported
 * Allows user to proceed anyway or refresh the page
 */
const WebGL2Warning: React.FC<WebGL2WarningProps> = ({ onProceed }) => {
  return (
    <ContentBox
      title="WebGL2 Not Supported"
      subtitle="Your browser does not support WebGL2"
      alreadyHasH1
      defaultBackHref="/"
    >
      <div className="flex flex-col items-center justify-center space-y-4 p-6">
        <AlertTriangle className="h-20 w-20 text-orange-500" />
        <div className="space-y-2 text-center">
          <p className="font-bold text-lg">Limited Functionality Warning</p>
          <p className="text-muted-foreground">
            WebGL2 is required for core game features. You will NOT be able to:
          </p>
          <ul className="inline-block space-y-1 text-left text-muted-foreground">
            <li>• Engage in combat</li>
            <li>• Travel on the map</li>
            <li>• View 3D graphics and animations</li>
          </ul>
          <p className="pt-2 text-muted-foreground">
            Please update your browser to the latest version for the full experience.
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

/**
 * Small banner component to show persistent warning after user proceeds
 */
export const WebGL2WarningBanner: React.FC = () => {
  return (
    <div className="mb-4 rounded-md border border-orange-500 bg-orange-500/10 p-4">
      <div className="flex items-center gap-2 text-orange-500">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">WebGL2 Not Available</span>
      </div>
      <p className="mt-1 text-muted-foreground text-sm">
        You will not be able to use combat or travel features.
      </p>
    </div>
  );
};

export default WebGL2Warning;
