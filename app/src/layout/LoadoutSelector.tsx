import React from "react";
import Loader from "@/layout/Loader";
import { api } from "@/app/_trpc/client";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { Folder } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import { usePathname } from "next/navigation";

interface LoadoutSelectorProps {
  size?: "small" | "large";
}

const LoadoutSelector: React.FC<LoadoutSelectorProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();
  const pathname = usePathname();
  const isRankedPage = pathname === "/ranked";

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = fedJutsuLoadouts(userData);

  // Get loadouts
  const { data, isFetching } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });

  // Mutations
  const { mutate: selectJutsuLoadout, isPending } =
    api.jutsu.selectJutsuLoadout.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.item.getUserItems.invalidate();
          await utils.jutsu.getUserJutsus.invalidate();
        }
      },
    });

  // Handle key-presses
  // This is too aggressive when input on a given page
  // const onDocumentKeyDown = (event: KeyboardEvent) => {
  //   switch (event.key) {
  //     case "1":
  //       if (data?.[0]) selectJutsuLoadout({ id: data[0].id });
  //       break;
  //     case "2":
  //       if (data?.[1]) selectJutsuLoadout({ id: data[1].id });
  //       break;
  //     case "3":
  //       if (data?.[2]) selectJutsuLoadout({ id: data[2].id });
  //       break;
  //   }
  // };
  // useEffect(() => {
  //   document.addEventListener("keydown", onDocumentKeyDown);
  //   return () => {
  //     document.removeEventListener("keydown", onDocumentKeyDown);
  //   };
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [data]);

  // Derived size vars
  const iconSize = props?.size === "small" ? "h-6 w-6" : "h-10 w-10";
  const textSize = props?.size === "small" ? "text-xs" : "text-sm mt-1";

  // Loaders
  if (!userData) return <Loader />;
  if (isFetching) return <Loader />;
  if (isPending) return <Loader />;

  if (maxLoadouts <= 0) return null;

  // Show loadout selectors
  return (
    <div className="flex flex-row gap-1">
      {data?.map((loadout, i) => {
        // On ranked page, only show loadout 4
        if (isRankedPage && i !== 3) return null;
        // On regular pages, only show loadouts 1-3
        if (!isRankedPage && i === 3) return null;
        
        return (
          <div className="relative" key={i}>
            <Folder
              className={`${iconSize} ${userData.jutsuLoadout === loadout.id ? "fill-orange-300" : "hover:cursor-pointer hover:fill-orange-300"}`}
              onClick={() => selectJutsuLoadout({ id: loadout.id })}
            />
            <div
              className={`absolute font-bold top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hover:cursor-pointer ${textSize}`}
              onClick={() => selectJutsuLoadout({ id: loadout.id })}
            >
              {i + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LoadoutSelector;
