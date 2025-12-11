import React from "react";
import { MapPin } from "lucide-react";
import { RefreshCw } from "lucide-react";

const MapLoadError: React.FC = () => {
  return (
    <div className="w-full min-h-96 flex flex-col items-center justify-center">
      <MapPin className="w-40 h-40 p-3 m-3 bg-popover rounded-full animate-pulse" />
      <p>Error loading map data.</p>
      <p className="text-red-500 font-bold">
        The map could not be loaded. Please try again.
      </p>
      <p
        className="hover:text-orange-500 hover:cursor-pointer animate-pulse"
        onClick={() => location.reload()}
      >
        Reload Page <RefreshCw className="w-5 h-5 inline" />
      </p>
    </div>
  );
};

export default MapLoadError;
