import { Globe, RefreshCw } from "lucide-react";
import type React from "react";

const MapError: React.FC = () => {
  return (
    <div className="flex min-h-96 w-full flex-col items-center justify-center">
      <Globe className="m-3 h-40 w-40 animate-pulse rounded-full bg-popover p-3" />
      <p className="font-bold text-red-500">Network error loading the map data.</p>
      <p className="text-muted-foreground">Please try reloading the page.</p>
      <button
        type="button"
        className="mt-2 animate-pulse hover:cursor-pointer hover:text-orange-500"
        onClick={() => location.reload()}
      >
        Refresh <RefreshCw className="inline h-5 w-5" />
      </button>
    </div>
  );
};

export default MapError;
